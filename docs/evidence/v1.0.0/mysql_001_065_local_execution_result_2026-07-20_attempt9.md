# MySQL 001-065 本机执行结果（Attempt 9）

- 时间：2026-07-20 00:48:26 +08:00
- 授权包：`mysql_001_065_local_authorization_packet_2026-07-20_r9.json`
- 授权包 SHA-256：`2dc3d74eb33af4e641eb09e935cddf9c6e2035ac1c7b7d84c23c1007c8e797db`
- 单次 nonce：`7f2aca54-87ea-4c48-bf8c-096dcbbcdd4a`（已消费，不得复用）
- 范围：仅本机 `127.0.0.1` 随机临时端口；未连接 Candidate/生产；未部署、提交或推送
- 结果：`FAIL_FROZEN_REAL_ENGINE_CHECK_CLEANED`

## 实际结果

固定 MySQL 8.0.43 镜像通过认证型 readiness。冻结命令完成 13 项真实引擎测试，结果为 12 PASS、1 FAIL、0 SKIP，退出码 1；测试耗时 27487.503666 ms。

结构化脱敏诊断定位到第 7 项：`mysql_runtime_principal_bootstrap.integration.test.js` 第 277 行调用受控告警投递注册过程时触发 `ER_CHECK_CONSTRAINT_VIOLATED`，具体约束为 `chk_v1_runtime_alert_delivery_slo`。本轮未进行修正；根因状态为 `PENDING_READ_ONLY_AUDIT`。

## 停止与清理

- 首次非零结果后立即停止，没有自动重试。
- `db:schema-snapshot:write`、独立 snapshot verify、最终 repository verify 均未运行。
- 执行器报告 `containerRemoved=true`；受管容器及同名前缀容器均为 0 个残留，随机监听端口随容器删除。
- 退出后未观察到其他 MySQL 8.0.43 容器。
- `backend/db/schema.sql` 仍为 SHA-256 `e84fe654b674981917c472cc73593657dd6a9189dd32b736ff1bae895be7a7c3`，修改时间仍为 2026-07-18 19:30:22 +08:00。

## Gate 结论

Attempt 9 不关闭本地 MySQL 实证、schema snapshot provenance、Candidate/生产 MySQL、容量或真实送达 Gate。R9 nonce 已消费。若审计后需要再次执行，必须冻结新的包并取得新的单次明确授权。
