# MySQL 001-065 本机一次性执行授权包 R4

状态：`PREPARED_NOT_AUTHORIZED_NOT_EXECUTED`。

本包不构成授权。它冻结 Attempt 3 修复后的 runner、精确 readiness SQL、七组真实引擎测试、一次性 nonce 与成功后的 schema provenance 验证。机器可读包：`mysql_001_065_local_authorization_packet_2026-07-19_r4.json`；SHA-256：`33eee9694f17fbae7a699671e4a72b5a61d80c3a9d8ea2d8f6f2160ce58dd24e`。

## R4 修正

- readiness SQL 使用反引号包裹的非关键字字段：`readiness_ok`、`mysql_version`、`authenticated_account`、`instance_uuid`。
- 精确 SQL SHA-256 固定为 `33dc8683efdf1fc97ed8e63c3593bf59ed8ad5e35f3d19747b12ad5d635ab220`。
- 新增默认关闭的真实 MySQL 8.0.43 parser regression；它必须与另外六组真实引擎测试一起得到 `13/13 PASS / 0 FAIL / 0 SKIP`。
- `ER_PARSE_ERROR`、marker 不变量失败及其他确定性错误立即失败，不再重试到 90 秒 timeout；证据只保留限长且脱敏的 code、errno、SQL state 与 message。
- 重复测试 summary 或正文出现 `# SKIP` 均不能被解释为成功。
- 保留 R3 的固定镜像、随机 loopback 端口、精确 ownership container ID 清理、两次冻结 SHA 校验、密码不进 argv 和单次 nonce。

## 授权范围

未来如获得精确绑定本包 SHA 与 nonce `3c08ffa9-4c95-4774-bae5-9c326933d5db` 的新授权，唯一入口仍为本地 runner。任一步失败都必须停止后续步骤并清理本次容器。

R4 只可能推进本地 MySQL engine/schema proof。它不连接 Candidate/生产，不授权部署、提交或推送，也不关闭容量、IAM、告警、密钥、真实微信身份/送达及内容验收 Gate。
