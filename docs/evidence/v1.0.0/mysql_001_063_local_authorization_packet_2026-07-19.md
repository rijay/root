# myRoot v1.0.0 migrations 001–063 本机一次性 MySQL 授权执行包

状态：`SUPERSEDED_NOT_AUTHORIZED_NOT_EXECUTED`

本历史包已由 `mysql_001_065_local_authorization_packet_2026-07-19.json` 取代，**不得再用于授权或执行**。后者冻结当前 001～065 迁移集和“迁移创建者在迁移后成为锁定、最小权限 Definer”的有效方案；下文保留仅用于审计旧决策，不代表当前执行步骤。

本包冻结下一次本机真实引擎实证的输入、顺序、裁决与清理条件。它不是执行授权；不连接 Candidate/生产，也不授权提交、推送、部署或真实发送。此前 001–057 的单次授权已经使用并完成清理，不能自动覆盖本包。

## 1. 冻结输入

- 运行包版本：`0.5.13`。
- migration：`001_store_snapshot.sql` 至 `063_v1_runtime_alert_database_authority_stage.sql`，共 63 个。
- 063 checksum：`2cad7a116e725d1463312b619eb5f34312b653b364964a5b208fbe42e4c61b36`。
- migration-set digest：`212de66fb1fb7575c1870b29d95bc63d651eb59d8f55a0d04a599a65a0f53693`。
- 固定镜像：`mysql:8.0.43@sha256:3e646bcda0d9448ffa3d2024eef04e1bca95528ec19b9e8b76749da9d97d4a10`。
- 只允许随机 `127.0.0.1` 临时端口、随机 disposable database 和 `myroot_schema_snapshot_sandbox_marker`。

## 2. 获得新的单次授权后才可执行

1. 生成一次性容器名、随机测试密码和随机数据库名；秘密只存在于进程环境。
2. 以固定 digest 启动 MySQL 8.0.43，绑定随机 localhost 端口，以条件轮询等待 ready。
3. 执行四组 post-057 真实引擎测试；全部 enabled 用例必须 PASS。
4. 对 063 额外回读：authority 表约束与空初态、12 个 procedure、`SQL SECURITY DEFINER`、参数和 routine definition digest。
5. 创建仅本次使用的 REGISTRAR(DRY_RUN/CONTROLLED)、WORKER、INSPECTOR、DEFINER、MIGRATOR principal，按 [mysqlRuntimeAlertAuthorityPolicy.js](../../../backend/src/mysqlRuntimeAlertAuthorityPolicy.js) 的精确矩阵授权并回读 `SHOW GRANTS`。
6. 做正负向证明：两种 Registrar 只能执行各自 registration procedure；Worker 可读必要事实并执行九个窄写 procedure，但直接 INSERT/UPDATE/DELETE 被拒；Inspector 只能执行聚合 inspect procedure；无 authority row 时注册 fail-close。
7. 单独证明 routine 实际 definer 是专用、不可登录的 DEFINER，而不是迁移账号；迁移账号仅发布窗口可用。当前 063 省略显式 `DEFINER`，因此本步骤需要环境 bootstrap 重新创建并绑定 routine，未完成前 `DB_WRITE_AUTHORITY` 仍为 OPEN。
8. 生成 001–063 `backend/db/schema.sql`，在第二个随机数据库独立 verify，禁止手改快照。
9. 运行 `npm run verify -- --json`，目标 `18/18 PASS`。
10. 无论成功失败，删除临时 principal、数据库和容器，并证明临时端口已消失。清理失败即本次实证失败。

真实引擎入口保持：

```text
IDENTITY_NOTIFICATION_BINDING_MYSQL_INTEGRATION_ENABLED=true
NOTIFICATION_PROVIDER_FENCE_MYSQL_INTEGRATION_ENABLED=true
V1_RUNTIME_ALERT_DELIVERY_MYSQL_INTEGRATION_ENABLED=true
SETTLEMENT_SOURCE_AUTHORITY_MYSQL_INTEGRATION_ENABLED=true
npm run v1:mysql-post057-integration:check
```

## 3. 063 本地实现裁决

- Authority 表默认空，任何注册先 fail-close。
- DRY_RUN 与 CONTROLLED 是两个固定 registration procedure，调用者不能传入 mode 或 receiver binding。
- Adapter 所有 delivery 写路径已改为 `CALL`；直接 DML 不再存在于其实现。
- procedure 使用调用者外层事务，不执行 `COMMIT`、`ROLLBACK` 或 `SET AUTOCOMMIT`。
- `affected_rows` 在 DML 后立即保存，并通过唯一业务结果集返回；mysql2 completion header 不作为业务成功依据。
- 每个 versioned procedure 前有同名 `DROP PROCEDURE IF EXISTS`，以便未记账重放和中途失败收敛；authority 未启用前不会产生运行时写入。
- 本地静态/模拟 PASS 不证明 MySQL parser、实际 routine definer、真实 grants 或 direct-DML deny，必须由上述一次性引擎实证补齐。

## 4. 裁决上限

全部本机步骤通过后，状态最多提升为：

`LOCAL_MYSQL_001_063_ENGINE_AND_AUTHORITY_PROOF_COMPLETE / CANDIDATE_AND_PRODUCTION_OPEN`

它仍不关闭 Candidate/生产 MySQL、容量、timer-only IAM、真实告警、密钥轮换、真实微信身份/订阅送达、健康/隐私/活动/UED/摄影授权或正式发布 Gate。
