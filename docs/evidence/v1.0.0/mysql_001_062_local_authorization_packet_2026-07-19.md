# myRoot v1.0.0 migrations 001–062 本机一次性 MySQL 授权执行包

状态：`PREPARED_NOT_AUTHORIZED_NOT_EXECUTED`

本执行包只把下一次本机实证所需的输入、命令顺序、验收条件和清理条件冻结下来。它不是执行授权，也不连接 Candidate/生产。此前针对 001–057 的一次性授权已经执行并完成清理，不自动覆盖当前 058–062。

## 1. 目的与输入绑定

- 运行/包版本保持 `0.5.13`。
- migration 范围：`001_store_snapshot.sql` 至 `062_settlement_source_authority.sql`，共 62 个。
- 预期 migration-set digest：`e8dbf82b5bc5cf4a3f29efaa98323287079834aebeab80b29f0c47d3231e3c43`。
- 固定镜像：`mysql:8.0.43@sha256:3e646bcda0d9448ffa3d2024eef04e1bca95528ec19b9e8b76749da9d97d4a10`。
- 监听只允许随机 `127.0.0.1` 临时端口。
- 所有测试数据库必须是测试自行生成并再次校验的随机 disposable 名称；测试前必须存在 `myroot_schema_snapshot_sandbox_marker`。

## 2. 明确不授权的动作

- 不连接 Candidate 或生产 MySQL。
- 不创建 Candidate，不部署，不上传小程序，不发送微信提醒或告警。
- 不 commit、不 push、不创建 PR、不修改 GitHub ruleset。
- 不创建、注入、轮换或删除真实密钥。
- 不把本机 PASS 解释为 Candidate/生产 Gate 关闭。

## 3. 获得新的单次授权后才可执行的顺序

1. 生成仅本次使用的随机容器名与随机高熵测试密码；密码只存在于进程环境，不写入仓库、日志或证据文件。
2. 以固定 digest 启动 MySQL 8.0.43，发布到随机 `127.0.0.1` host port，并创建 sandbox marker database。
3. 轮询 MySQL health；不得用固定长时间 sleep 代替 readiness 条件。
4. 设置以下连接变量：

   ```text
   SCHEMA_SNAPSHOT_MYSQL_HOST=127.0.0.1
   SCHEMA_SNAPSHOT_MYSQL_PORT=<docker 分配的临时端口>
   SCHEMA_SNAPSHOT_MYSQL_USER=root
   SCHEMA_SNAPSHOT_MYSQL_PASSWORD=<仅本次进程环境中的测试密码>
   ```

5. 先运行四组真实引擎测试：

   ```sh
   env \
     IDENTITY_NOTIFICATION_BINDING_MYSQL_INTEGRATION_ENABLED=true \
     NOTIFICATION_PROVIDER_FENCE_MYSQL_INTEGRATION_ENABLED=true \
     V1_RUNTIME_ALERT_DELIVERY_MYSQL_INTEGRATION_ENABLED=true \
     SETTLEMENT_SOURCE_AUTHORITY_MYSQL_INTEGRATION_ENABLED=true \
     npm run v1:mysql-post057-integration:check
   ```

6. 使用同一固定镜像生成当前 001–062 `backend/db/schema.sql`，随后在另一个随机 disposable database 中独立 verify；禁止手工编辑 schema snapshot。
7. 运行 `npm run verify -- --json`，目标必须为 `18/18 PASS`。
8. 保存脱敏证据：MySQL 精确版本、镜像 digest、migration 计数/latest/digest、测试计数、schema/body digest、verify 结果及 cleanup 结果。不得保存密码、OpenID、receiver endpoint/secret、HMAC key 或 receipt 原文。
9. 无论成功或失败，都必须删除测试数据库、停止并删除容器，并证明随机监听端口已消失。任何 cleanup 失败都使本次实证失败。

## 4. 四组最小验收范围

### 058–060 Notification provider-call fencing

- 058 stage 列形状与 missing-marker reconcile。
- 059 历史 REQUESTED/terminal backfill 及 old-writer race 收敛。
- 060 preflight 无部分 ALTER、真实 CHECK 正负例、索引/默认值/NOT NULL。
- 双 pool claim/start/complete、LEASED 到期 takeover、STARTED no-takeover、双实例 recover、claim 后 identity drift fence，以及真实 COMMIT 成功后的 ACK 丢失/新连接权威 readback 已进入待执行 harness。
- identity drift 目前覆盖 claim→START 之间的事实变化，未在 START 内部 SELECT→UPDATE 之间注入确定性竞态；真实微信 Provider Seam 不在该测试范围，必须保持 OPEN。

### 061 Runtime alert delivery

- FK、UNIQUE、CHECK 与七状态形状的真实 MySQL执行。
- DRY_RUN 不可被 CONTROLLED worker claim；Provider Seam 前调用计数为 0。
- 双 pool 注册/claim 与 terminal no-resend。
- migration CHECK 不能证明 `registration_mode` 不可变；Candidate/生产仍需最小 grants 或等价受控写 Interface 的实证。
- 正式 `DB_WRITE_AUTHORITY` 要求 MIGRATOR、REGISTRAR、WORKER、INSPECTOR 独立 principal；推荐 REGISTRAR/WORKER 只有窄存储过程 EXECUTE、INSPECTOR 只有聚合只读 Interface，procedure definer 不可登录。列级 UPDATE 或 trigger 单独存在都不足以阻止合法形状的越级迁移。

### 062 Settlement source authority

- authority 复合主键、FK/UNIQUE/index 的真实结构。
- 两连接同 scope authority row 锁及至少一个可观测 lock wait。
- Resolve exact replay、冲突与 audit insert 失败后的整事务回滚。
- 生产 Read Adapter 已构造完整 Activity→Enrollment→Task→Source invalidation→Published rule→Candidate 证据链；目标 scope 130 条、旁路 scope 1 条，必须得到 `64+64+2`、无重复遗漏/跨 scope 泄漏，并在 `performance_schema.data_lock_waits` 观察到 Writer 被 authority row 阻塞。
- 完整 Handler-first/Store-first 两种业务 TOCTOU 和大表 `EXPLAIN FORMAT=JSON` 仍是 Candidate 前 P1；不得用上述 Reader/Writer 编排冒充完整业务事务证明。

### 049–057 回归

- 现有 identity/recipient-binding 集成测试必须在仓库已有 62 个 migration 时仍能精确构造 through-048…057 子集，不得再用旧总数 60 隐藏失败。

## 5. 裁决

全部通过后最多可以把状态提升为：

`LOCAL_MYSQL_001_062_ENGINE_PROOF_COMPLETE / CANDIDATE_AND_PRODUCTION_OPEN`

以下仍不会关闭：Candidate/生产 DDL 与 parity、容量与故障实验、timer-only IAM、真实告警、真实微信身份/订阅送达、内容/隐私/UED/摄影授权以及正式发布 Gate。
