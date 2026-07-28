# MySQL 001-065 本机单次授权包（R6）

- 状态：`PREPARED_NOT_AUTHORIZED_NOT_EXECUTED`
- JSON SHA-256：`58f04a58a10c50acd7942bfe94a901416ccde49625079685b219b09e93cb0b83`
- 单次 nonce：`91a87317-7cf5-4eeb-ade7-47e684a8bb7b`
- 运行/包版本：`0.5.13`
- 范围：只允许一次性 MySQL 8.0.43 容器、随机 `127.0.0.1` 临时端口；禁止 Candidate/生产、部署、commit 与 push

## R6 绑定的根因修复

Attempt 5 已通过认证型 readiness，但冻结的 13 项真实引擎检查得到 10 PASS / 3 FAIL / 0 SKIP。R6 只冻结以下源头修复，不修改任何既有 migration：

1. Provider-call fence 的 `information_schema.columns` 查询显式固定字段别名，并兼容 MySQL 8.0 返回的大写字段标签。
2. Runtime alert delivery 的约束查询显式固定 `CONSTRAINT_NAME` 别名，并在读取处归一化。
3. MIGRATOR 精确 schema 权限加入迁移 010 等实际需要的 `CREATE TEMPORARY TABLES`；迁移完成后仍执行全部权限撤销、运行期最小授权及 definer 账号锁定。

R6 绑定 Attempt 1～5 的不可变执行证据、7 个真实引擎测试文件、权限策略、principal bootstrap、runner 和 schema snapshot Module。要求仍为 13/13 PASS、0 FAIL、0 SKIP；成功后才可继续 schema snapshot write、独立 verify 和 18/18 final verification。

## 执行入口

仅在另一次明确授权同时指明本 JSON SHA 与单次 nonce 后，才可通过 runner 执行：

```text
npm run v1:mysql-local-authorized:run -- --packet docs/evidence/v1.0.0/mysql_001_065_local_authorization_packet_2026-07-19_r6.json
```

本包不构成授权，也不关闭本地、Candidate、生产、容量、真实送达或正式上线 Gate。未授权时 runner 必须在 Docker 启动前拒绝执行。
