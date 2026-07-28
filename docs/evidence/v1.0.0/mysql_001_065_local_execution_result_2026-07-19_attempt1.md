# myRoot v1.0.0 本机 MySQL 001–065 执行结果 · Attempt 1

状态：`FAILED / CLEANED / RERUN_NOT_AUTHORIZED`

- 授权输入：`mysql_001_065_local_authorization_packet_2026-07-19.json`，SHA-256=`85a3fe25b73799be52bb5ccf983cb122acc218bfa3d174094a580c9e1428bd6e`。
- 范围：仅本机 Docker MySQL 8.0.43、随机 `127.0.0.1` 临时端口；未连接 Candidate/生产。
- 命令：`npm run v1:mysql-001-065-authorized:check`。
- 结果：12 tests，7 PASS、5 FAIL、0 SKIP。
- 清理：容器、临时监听、随机数据库和随机主体均随一次性容器删除。
- 未执行：schema snapshot 写入、最终仓库 verify、任何提交/推送/部署或外部发送。

## 失败分类

1. 四组测试因并行运行互相创建随机库，使 exact-marker disposable-server guard 观察到额外数据库并以 `MYSQL_SCHEMA_SNAPSHOT_SERVER_NOT_DISPOSABLE` fail-close。
2. Principal harness 将主体限制为 `@127.0.0.1`，而 Docker Desktop 将宿主机连接呈现为私有 bridge gateway，导致 DEFINER 登录得到 `ER_ACCESS_DENIED_ERROR`。

这次结果证明 harness 编排不适配同一一次性 Docker Server，并未证明 migration 或 procedure 业务断言有缺陷。不得重用本次已失败授权。修复后必须冻结新的输入与 SHA，并再次获得单次授权。
