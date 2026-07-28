# MySQL 001-065 本机执行结果（Attempt 7）

- 时间：2026-07-19 23:15:53 +08:00
- 授权包：`mysql_001_065_local_authorization_packet_2026-07-19_r7.json`
- 授权包 SHA-256：`168bb5bd43be21513b8367f60c44296f3b7eeb64628e8255107985a45ffeb062`
- 单次 nonce：`f3203727-8afa-40b1-a8ed-b40e6fc919d2`（已消费，不得复用）
- 范围：仅本机 `127.0.0.1` 随机临时端口；未连接 Candidate/生产；未部署、提交或推送
- 结果：`FAIL_FROZEN_REAL_ENGINE_CHECK_CLEANED`

## 实际结果

固定的 MySQL 8.0.43 镜像通过宿主机认证型 readiness。冻结命令 `npm run v1:mysql-001-065-authorized:check` 随后执行，结果为 13 项中 11 PASS、2 FAIL、0 SKIP，退出码 1，测试总耗时 19865.13825 ms。

本次有界、脱敏诊断确认：

1. `mysql_runtime_principal_bootstrap.integration.test.js` 的真实引擎测试在第 184 行失败：`Create Procedure` DDL 未匹配 `/SQL SECURITY DEFINER/i`。tail 证明匹配失败，但 DDL 头部已被截断，不能仅凭本次证据断言 MySQL 为何省略或重排该子句。
2. 另有一项真实引擎子测试失败，但其标签和断言位于 4096-byte retained tail 之前。为了不把推测写成事实，本证据不为其指定文件或根因。

完整脱敏 stdout 的 SHA-256 为 `b63db0ff7ca331fa81a56ee1732bff42790389732a6cac417a9e2ffa6eebbaeb`；runner 仅保留限长 tail，没有记录密码或随机端口。

## 停止与清理

- 冻结检查首次返回非零后立即停止，没有自动重试。
- `db:schema-snapshot:write`、独立 snapshot verify 和最终 repository verify 均未运行。
- runner 报告 `containerRemoved=true`；按受管容器名称复核，残留容器数为 0。
- 本机原有 3 个无关运行中容器未被修改。
- `backend/db/schema.sql` 保持 SHA-256 `e84fe654b674981917c472cc73593657dd6a9189dd32b736ff1bae895be7a7c3`，修改时间仍为 2026-07-18 19:30:22 +08:00。

## Gate 结论

本次失败不关闭本地 MySQL 实证、schema snapshot provenance、Candidate/生产 MySQL、容量或真实送达 Gate。后续若要重试，必须先定位两项失败、冻结新包并取得新的单次明确授权；R7 nonce 不得复用。
