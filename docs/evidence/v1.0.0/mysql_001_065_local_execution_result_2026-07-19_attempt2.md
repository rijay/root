# MySQL 001-065 本机执行结果（Attempt 2）

- 时间：2026-07-19 15:59:37 +08:00
- 授权包：`mysql_001_065_local_authorization_packet_2026-07-19_r2.json`
- 授权包 SHA-256：`d40bc98c265a5b53ffc4dba93a58f560248e8729706db00d1ae0933a9d2c8708`
- 范围：仅本机 `127.0.0.1` 随机临时端口；未连接 Candidate/生产；未部署、提交或推送
- 结果：`FAIL_STARTUP_READINESS_FALSE_POSITIVE_CLEANED`

## 实际发生

一次性 MySQL 8.0.43 容器启动后，旧的就绪检查使用 `mysqladmin ping`。该命令在镜像仍处于初始化收敛阶段时已经报告服务可达，但随后用同一 root 凭据创建隔离标记库时返回 MySQL `1045 Access denied`。

因此冻结的 `npm run v1:mysql-001-065-authorized:check` 尚未启动，6 组集成测试、schema snapshot 与 final repository verify 均未执行。本次结果不代表迁移或业务逻辑失败。

## 停止与清理

- 首次真实 SQL 认证失败后立即停止。
- 退出陷阱已删除本次一次性容器。
- 以本次容器名称前缀复核，残留容器数为 0。
- 未自动重试。

## 下一次执行前必须修正

将就绪条件改为：使用同一 root 凭据成功执行 `SELECT 1` 后，才创建隔离标记库并启动冻结命令。任何再次启动容器都需要新的明确授权。

## Gate 结论

本次没有关闭本地 MySQL engine proof，更不关闭 Candidate/生产 MySQL、容量、真实送达等正式 Gate。
