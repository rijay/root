# R18 本机 MySQL 执行结果

- 结果：`FAIL_KEY_INVENTORY_SCHEMA_ATTESTATION_CLEANED`。
- 真实引擎 13/13、001–066 migration、56 表 schema、字节一致性及 provenance 全部 PASS。
- Backend tests：1366 tests / 1325 pass / 32 fail / 9 skip，正常 `EXIT_1`。
- TAP 共保留 27 个顶层失败；两个含失败子测试，因此汇总为 32。
- 所有失败集中于 `keyInventoryReadinessFoundation` 的 schema attestation 路径，稳定错误码为 `KEY_INVENTORY_SCHEMA_DRIFT`。
- 已定位根因类别：真实 MySQL 8.0.43 规范化后的 CHECK/schema 元数据与当前冻结 attestation expectation 不一致。R18 尚未保留规范化 CHECK 的实际 digest，因此现在直接修改硬编码 digest 会是猜测。
- 清理：nonce 已消费；一次性容器已删除；任务自有容器为 0；随机监听消失；可变输出已恢复。
- 边界：未连接 Candidate/生产，未提交、推送或部署，不关闭任何正式上线 Gate。
