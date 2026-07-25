# MySQL 001-065 本机执行结果（Attempt 8）

- 时间：2026-07-20 00:06:34 +08:00
- 授权包：`mysql_001_065_local_authorization_packet_2026-07-19_r8.json`
- 授权包 SHA-256：`07cf65ac3a869ff555af5b840b5cdd5ea241b68ae1203946ae41e15334560d23`
- 单次 nonce：`c1d43f6b-0a42-415c-9f21-cd4dfa67794f`（已消费，不得复用）
- 范围：仅本机 `127.0.0.1` 随机临时端口；未连接 Candidate/生产；未部署、提交或推送
- 结果：`FAIL_FROZEN_REAL_ENGINE_CHECK_CLEANED`

## 实际结果

固定 MySQL 8.0.43 镜像通过认证型 readiness。冻结命令随后完成 13 项真实引擎测试，结果为 12 PASS、1 FAIL、0 SKIP，退出码 1；测试耗时 22094.469458 ms。

结构化脱敏诊断完整定位到第 7 项：`mysql_runtime_principal_bootstrap.integration.test.js` 第 220 行插入运行时告警注册 authority 夹具时触发 `ER_CHECK_CONSTRAINT_VIOLATED`。只读审计确认，夹具写死了过期值 `myroot.runtime-alert.receiver-binding.v1`，而 migration 063 与运行时 Module 的唯一合法值均为 `runtime-alert-receiver-authority:v1`。这是测试夹具漂移，不是本次执行对 migration 001～065 的失败证明。

## 停止与清理

- 首次非零结果后立即停止，没有自动重试。
- `db:schema-snapshot:write`、独立 snapshot verify、最终 repository verify 均未运行。
- 执行器报告 `containerRemoved=true`；受管容器名称复核为 0 个残留，随机监听端口随容器删除。
- 本机原有 2 个无关 MySQL 容器未被修改。
- `backend/db/schema.sql` 仍为 SHA-256 `e84fe654b674981917c472cc73593657dd6a9189dd32b736ff1bae895be7a7c3`，修改时间仍为 2026-07-18 19:30:22 +08:00。

## Gate 结论

Attempt 8 不关闭本地 MySQL 实证、schema snapshot provenance、Candidate/生产 MySQL、容量或真实送达 Gate。R8 nonce 已消费。夹具修正后如需再次执行，必须冻结新的包并取得新的单次明确授权。
