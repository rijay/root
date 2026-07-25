# R20 本机 MySQL 执行结果

- 结果：`FAIL_SINGLE_WALL_CLOCK_YOUZAN_TEST_CLEANED`。
- 真实引擎 13/13、001–066 migration、56 表 schema、9/9 key-inventory CHECK 摘要、字节一致性及 provenance 全部 PASS。
- 最终 Backend tests：1368 tests / 1358 pass / 1 fail / 9 skip。
- 唯一失败：`Youzan customer Adapter ignores stale scope expiry when using the global token`。
- 根因：测试夹具把全局 token 到期时间固定为 `2026-07-20T12:00:00+08:00`，而该路径使用 `Date.now()`；R20 在该时刻之后执行，因而产生可复现的墙钟相关失败。这不是 MySQL schema 或有赞客户 Adapter 行为回归。
- R20 后已在不启动 MySQL 的情况下复现该失败；夹具改为稳定未来时间后，相关 6/6 测试通过。
- 清理：nonce 已消费；一次性容器已删除；任务自有容器为 0；随机监听消失；失败路径恢复了可变输出。
- 边界：未连接 Candidate/生产，未提交、推送或部署，不关闭本地完整闭包或任何正式上线 Gate。

R20 已完成授权范围内的执行与清理，不得复用其 packet SHA 或 nonce。若要重新验证完整闭包，必须冻结新包并取得新的单次明确授权。
