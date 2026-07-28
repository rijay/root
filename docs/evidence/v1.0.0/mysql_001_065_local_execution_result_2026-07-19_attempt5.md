# MySQL 001-065 本机执行结果（Attempt 5）

- 时间：2026-07-19 21:26:24 +08:00
- 授权包：`mysql_001_065_local_authorization_packet_2026-07-19_r5.json`
- 授权包 SHA-256：`fbebc88c7cae403f7a8a37ecb13ae1961217c527a459b3aad5edeb97140baf9a`
- 单次 nonce：`b6424a60-aea0-401d-9688-f1aa21eec614`（已消费，不得复用）
- 范围：仅本机 `127.0.0.1` 随机临时端口；未连接 Candidate/生产；未部署、提交或推送
- 结果：`FAIL_FROZEN_REAL_ENGINE_CHECK_CLEANED`

## 实际结果

固定的 MySQL 8.0.43 镜像通过宿主机认证型 readiness。冻结命令 `npm run v1:mysql-001-065-authorized:check` 随后执行，结果为 13 项中 10 PASS、3 FAIL、0 SKIP，退出码 1，总耗时 17951.381542 ms。

本次有界、脱敏诊断确认三处失败：

1. `mysql_notification_provider_call_fence.integration.test.js`：`assertStageColumns` 的必需列查找返回 `-1`；由于保留的是 4096-byte tail，缺失列名未被保留，不能超出证据推断。
2. `mysql_runtime_principal_bootstrap.integration.test.js`：迁移 definer 在一次性测试数据库执行 `applyMysqlMigrations` 时收到 `ER_DBACCESS_DENIED_ERROR`。
3. `mysql_v1_runtime_alert_delivery.integration.test.js`：真实 MySQL 约束检查报告 `missing real MySQL constraint PRIMARY`。

完整脱敏 stdout 的 SHA-256 为 `3249bca262dc27d0b72e8e0bc452d80547961367224b04c86e9136786ba10ab2`；runner 仅保留了限长 tail，没有记录密码或随机端口。

## 停止与清理

- 冻结检查首次返回非零后立即停止，没有自动重试。
- `db:schema-snapshot:write`、独立 snapshot verify 和最终 repository verify 均未运行。
- runner 报告 `containerRemoved=true`；按专属名称前缀与 ownership label 复核，残留容器数均为 0。
- 本机原有 3 个无关运行中容器未被修改。
- `backend/db/schema.sql` 保持 SHA-256 `e84fe654b674981917c472cc73593657dd6a9189dd32b736ff1bae895be7a7c3`，修改时间仍为 2026-07-18 19:30:22 +08:00。

## Gate 结论

本次失败不关闭本地 MySQL 实证、schema snapshot provenance、Candidate/生产 MySQL、容量或真实送达 Gate。后续必须先修复并冻结新包，再取得新的单次明确授权；当前 nonce 不得复用。
