# R16 本机 MySQL 执行结果

- 结果：`FAIL_FINAL_BACKEND_TESTS_WITHOUT_TAP_FAILURES_CLEANED`。
- 已证明：MySQL 8.0.43 真实引擎测试 `13/13`，001–066 migration、56 表 schema 写入、字节一致性及独立 provenance 全部通过。
- 最终验收仅报告 `Backend tests` 非零，但 R16 结构中没有保存退出码、信号或错误码，且解析到的顶层 TAP 失败为 0；因此不得臆测根因。
- 清理：一次性容器已删除、随机监听已消失、可变输出已恢复；事后检查任务自有容器为 0。
- 事后无 MySQL 诊断：相同最小环境的 Backend tests 为 `1366 tests / 1357 pass / 0 fail / 9 skip`；完整验收中的 Backend tests 为 PASS，唯一失败是恢复后的旧 schema provenance。
- 结论：R16 的 Backend tests 异常未复现。下一包必须冻结子进程 `exitCode/signal/errorCode`、测试汇总和输出元数据后才可重跑。
- 边界：未连接 Candidate/生产，未部署，不关闭 Candidate/生产 MySQL、容量或正式发布 Gate。
