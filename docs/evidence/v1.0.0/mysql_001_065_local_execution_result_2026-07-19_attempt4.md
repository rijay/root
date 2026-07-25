# MySQL 001-065 本机执行结果（Attempt 4）

- 时间：2026-07-19 20:23:05 +08:00
- 授权包：`mysql_001_065_local_authorization_packet_2026-07-19_r4.json`
- 授权包 SHA-256：`33eee9694f17fbae7a699671e4a72b5a61d80c3a9d8ea2d8f6f2160ce58dd24e`
- 范围：仅本机 `127.0.0.1` 随机临时端口；未连接 Candidate/生产；未部署、提交或推送
- 结果：`FAIL_FROZEN_REAL_ENGINE_CHECK_CLEANED`

## 实际发生

固定的 MySQL 8.0.43 镜像已启动，宿主机认证型 readiness 通过，随后精确冻结命令 `npm run v1:mysql-001-065-authorized:check` 启动并以退出码 1 结束。执行器随即停止，没有自动重试，也没有运行 schema snapshot write/verify 或最终 repository verify。

当前执行器会先缓冲子测试输出，只在子进程成功退出后回传；因此本次失败只保留了 `MYSQL_LOCAL_RUNNER_COMMAND_FAILED:npm run v1:mysql-001-065-authorized:check:EXIT_1`，没有可用于可靠定位的测试组名称或 TAP 计数。不能据此推断是哪一个 migration 或业务测试失败。

`backend/db/schema.sql` 在失败后仍保持 SHA-256 `e84fe654b674981917c472cc73593657dd6a9189dd32b736ff1bae895be7a7c3`，修改时间仍为 2026-07-18 19:30:22 +08:00。

## 停止与清理

- 冻结检查首次返回非零后立即停止，没有第二次执行。
- runner 报告 `containerRemoved=true`。
- 退出后分别按容器名称前缀和 `com.myroot.local-mysql-proof` ownership label 复核，残留容器数均为 0。
- 本次 nonce 已消费，不得复用。

## 后续要求

必须先让执行器在失败路径保留有界、脱敏的子测试诊断，再基于新字节冻结下一份授权包。任何重试都需要新的单次明确授权；本次失败不关闭本地、Candidate 或生产 Gate。
