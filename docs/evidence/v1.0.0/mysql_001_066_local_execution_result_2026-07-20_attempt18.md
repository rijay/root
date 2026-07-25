# R19 本机 MySQL 执行结果

- 结果：`FAIL_TWO_KEY_INVENTORY_CHECK_DIGESTS_IDENTIFIED_CLEANED`。
- 真实引擎 13/13、001–066 migration、56 表 schema、字节一致性及 provenance 全部 PASS。
- 9 个 key-inventory CHECK 中 7 个匹配，2 个不匹配：
  - `chk_notification_send_attempt_accepted_receipt`：actual `064bb5a4f71106a4b117c5ad1f1f4abcc5d4563ed716a204fc54802e79b2bf75`
  - `chk_notification_send_attempt_receipt_digest`：actual `1f8b855ebd0cc7dc857f907d1fa7ffe19a725f53bb23eadad87baa3672b4a7c7`
- 两项均来自 immutable migration 026，经 MySQL 8.0.43 执行与规范化后形成；R19 未保留 CHECK 原文或任何凭据。
- Backend tests：1368 tests / 1325 pass / 34 fail / 9 skip；主要稳定错误仍为 `KEY_INVENTORY_SCHEMA_DRIFT`。
- 清理：nonce 已消费；一次性容器已删除；任务自有容器为 0；随机监听消失；可变输出已恢复。
- 边界：未连接 Candidate/生产，未提交、推送或部署，不关闭任何正式上线 Gate。
