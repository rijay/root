# myRoot v1.0.0 migrations 001–065 本机一次性 MySQL 授权执行包 · R2

状态：`PREPARED_NOT_AUTHORIZED_NOT_EXECUTED`

R2 只修复 Attempt 1 已证明的 harness 编排问题，不复用已失败授权。原包 SHA-256=`85a3fe25b73799be52bb5ccf983cb122acc218bfa3d174094a580c9e1428bd6e`；Attempt 1 结果见 `mysql_001_065_local_execution_result_2026-07-19_attempt1.json`。

机器可读冻结输入：`mysql_001_065_local_authorization_packet_2026-07-19_r2.json`，SHA-256=`d40bc98c265a5b53ffc4dba93a58f560248e8729706db00d1ae0933a9d2c8708`。

## R2 修正

1. 六个测试文件以 `--test-concurrency=1` 串行执行，避免一个测试的随机库触发另一个测试的 exact-marker guard。
2. Principal harness 从 MySQL `USER()` 读取本次客户端地址，仅接受 loopback 或 RFC1918 私有 Docker bridge IPv4；拒绝 `%`、`0.0.0.0`、公网地址和任意 hostname。
3. R2 同时冻结六个真实引擎测试、Principal bootstrap Implementation、对应单元测试和 `package.json` SHA。

## 范围与裁决

- 仅允许随机 `127.0.0.1` 临时端口的一次性 MySQL 8.0.43 容器。
- 不连接 Candidate/生产，不提交、不推送、不部署、不发送外部消息。
- 目标仍为：12/12 真实引擎测试、001–065 schema 写入与独立 verify、最终仓库 18/18、容器/监听/数据库/主体全部清理。
- 任一步失败立即停止并清理；本机 PASS 仍不关闭 Candidate、生产、容量、真实告警或微信送达 Gate。

本包不构成授权。必须针对 R2 的新 SHA 再次取得明确单次授权。
