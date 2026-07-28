# R17 本机 MySQL 执行结果

- 结果：`FAIL_FINAL_BACKEND_TESTS_32_FAILURES_CLEANED`。
- 真实引擎：13/13 PASS，0 fail，0 skip。
- schema：001–066 migration、56 表、字节一致性和独立 provenance 均 PASS；快照 SHA-256 为 `895aad618b6b0c34d06ae19684ffb3d4a4beda8bf994e212380727cd6d44819d`。
- 最终 Backend tests：正常 `EXIT_1`，1366 tests / 1325 pass / 32 fail / 9 skip。
- R17 已排除 signal、buffer limit、spawn error 和“无真实测试失败”的假设。
- 失败名称仍未保留：后端默认 spec reporter 使用 `✖`，而冻结解析器只识别 TAP `not ok`。后续必须强制 Backend tests 使用 TAP reporter 后再执行。
- 清理：nonce 已消费；一次性容器已删除；任务自有容器为 0；随机监听消失；可变输出已恢复。
- 边界：未连接 Candidate/生产，未提交、推送或部署，不关闭任何正式上线 Gate。
