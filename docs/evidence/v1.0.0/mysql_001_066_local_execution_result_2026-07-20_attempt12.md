# 本机 MySQL 实机执行结果 — Attempt 12 / R13

- 结果：`FAIL_SCHEMA_VERIFY_OUTCOME_CONTRACT_CLEANED`
- 实机测试：13/13 通过，0 失败，0 跳过。
- 迁移快照：001–066、56 表，写入阶段独立 provenance 检查通过。
- 失败原因：runner 错把 byte-equality verify 输出当作 provenance 输出解析。
- 清理：一次性容器、临时监听均已删除，可变输出已恢复。
- 环境限制：未连接 Candidate/生产，未部署，未关闭任何正式 Gate。
