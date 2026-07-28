# MySQL 001-065 本机执行结果（Attempt 3）

- 时间：2026-07-19 19:39:06 +08:00
- 授权包：`mysql_001_065_local_authorization_packet_2026-07-19_r3.json`
- 授权包 SHA-256：`8c46d1b15b8e858bc8b2ea00ddc8d9f4068c93eee4fb63a4efc8c2a0df1004e8`
- 范围：仅本机 `127.0.0.1` 随机临时端口；未连接 Candidate/生产；未部署、提交或推送
- 结果：`FAIL_AUTHENTICATED_READINESS_QUERY_PARSE_ERROR_CLEANED`

## 实际发生

固定的 MySQL 8.0.43 镜像已启动。runner 使用本次随机 root 凭据从宿主机执行认证型就绪查询时，MySQL 持续返回 `ER_PARSE_ERROR`，最终触发 `MYSQL_LOCAL_RUNNER_AUTHENTICATED_READINESS_TIMEOUT`。

失败发生在冻结业务测试之前，因此 `npm run v1:mysql-001-065-authorized:check`、六组集成测试、schema snapshot write/verify 与最终 repository verify 均未执行。`backend/db/schema.sql` 的修改时间仍为 2026-07-18 19:30:22 +08:00，失败后 SHA-256 为 `e84fe654b674981917c472cc73593657dd6a9189dd32b736ff1bae895be7a7c3`。

## 根因边界

已确认：认证型就绪 SQL 本身产生解析错误。静态检查显示 `CURRENT_USER() AS current_user` 的未加引号别名是首要怀疑点；但当前 runner 只保留了错误码，没有保留脱敏后的 parser message，所以本次证据不能把具体 token 宣称为已证实根因。

再次尝试前必须修正 SQL、保留脱敏诊断并补真实 MySQL 8.0.43 回归测试；随后冻结新的 runner、测试、package 与授权包字节，并取得新的单次授权。

## 停止与清理

- 首次执行在认证型就绪阶段失败后停止，没有自动重试。
- runner 报告 `containerRemoved=true`。
- 退出后按 `com.myroot.local-mysql-proof` ownership label 复核，残留容器数为 0。
- 本次 nonce 已消费，不得复用。

## Gate 结论

本次没有关闭本地 MySQL engine proof 或 schema provenance，更不关闭 Candidate/生产 MySQL、容量、真实送达等正式 Gate。
