# myRoot v0.5.10 发布说明

状态：生产 0% 条件候选；未提交、未 push；Cloud Function 与小程序代码已上传；未修改默认流量；单用户真实提醒仅执行一次并失败，未重试

## 1. 本版目标

关闭 `myroot-api-024 / v0.5.7` 首次正式目标提醒失败后发现的两个正式发布阻塞：微信一次性订阅额度没有任务级账本，以及微信发送成功但最终 Store 提交失败时可能自动重复发送。

## 2. Module 与 Interface 变化

1. `checkinReminder` Module 为每次原生接受创建幂等授权额度，状态为 `AVAILABLE / RESERVED / CONSUMED / INVALIDATED / REVIEW_REQUIRED`。
2. 小程序 `checkin-reminder-subscribe` Module 在原生调用前生成稳定 `grant_request_id`，后端记录失败时以同一 ID 重试一次；仍失败则常驻提示用户重新开启，不伪报成功。
3. 到期提醒只消费匹配用户、活动和模板版本的可用额度；最近订阅状态不能替代额度。
4. MySQL Store Interface 新增请求级 `checkpoint/resume`：发送前持久化占用并释放快照锁，微信调用后重新加锁、按 ID 绑定最新任务和授权，再提交结果。
5. 单轮发送采用一次检查点和受控并发，默认 5、最大 20；这为约 20 人并发的内测场景减少长事务占锁时间。
6. 真实发送的 HTTP Interface 在缺少完整 `checkpoint/resume` 时以 `50301` 拒绝执行；dry-run 只返回去标识化请求证据，不返回 `touser` 或 OpenID。
6. 微信返回 `43101` 时额度失效；明确未发送时释放；结果不明确或 `SENDING` 超过 15 分钟时进入人工核验，绝不自动重发。

## 3. 数据与隐私

1. 新增不可变迁移 `005_notification_subscription_grants.sql`，创建 `notification_subscription_grant`，并为提醒任务与送达记录增加授权关联及失败分类字段。
2. 迁移为加法变更，不删除旧表或旧记录。旧 `ACCEPTED` 记录不补造一次性额度，用户必须重新点击“开启明日提醒”。
3. 送达记录不再保存原始 `touser/openid`、完整微信响应或 `msgid`；只保留请求形状、受理存在性、稳定错误码和脱敏说明。
4. 微信 access token 改为进程内合并请求缓存，Store 规范化会移除历史缓存字段，不再把新 token 写入数据库快照。

## 4. 版本与验证

根项目、后端、Admin、小程序和 Cloud Function 已统一为 `0.5.10`。本地定向验证覆盖授权幂等、一次消费、无额度跳过、已打卡保留额度、`43101` 失效、明确未发送释放、未知结果隔离、检查点中断、受控并发、请求级检查点传递、无事务检查点时 fail-closed、dry-run 去标识化、迁移 005 和送达证据最小化。

完整 `npm run verify` 为 `15/15 PASS`，覆盖 223 个 JavaScript 文件、5 个不可变迁移、后端 `253/253` 测试、生产依赖审计、Admin 构建、小程序检查和 HTTP Interface smoke。隔离 MySQL 8 探针确认迁移 005、22 列授权表、`CONSUMED` 真实投影、检查点释放锁、第二 Store Adapter 并发写入、恢复后合并及重启持久化均通过；临时容器已删除。

候选工件：

- 后端 ZIP：`/tmp/myroot-api-0.5.10-local-20260713-r4.zip`，1,069,443 bytes，183 个条目，SHA-256 `d63f2101f0eb6e8fd3c8286fdf9b61642766f3692436f465c4bc22509f8334ac`。
- 展开源码：174 个文件，内容清单 SHA-256 `eb0739a066610af1c22e329715e0f0e10227ccd4f80600cecc26f890abc67d96`。
- 小程序：157 个文件、509,550 bytes，清单 SHA-256 `f5f85fd7c599f7359d0ff7c30b9bb663018db1abbf923e3593f86672e1911d3f`。
- `git diff --check` 通过。候选凭据模式扫描只命中对象存储测试中的合成 Bearer 哨兵；未命中私钥、腾讯云 AKID、数据库连接串或 JWT。

## 5. 发布与回滚约束

1. 下一 CloudRun 版本使用平台实际分配编号，预期为 `myroot-api-025`；只允许 `URL_PARAMS / 0%` 条件候选，稳定版 `012` 保持默认流量。
2. 候选启动会对生产 MySQL 应用迁移 005，这是独立生产写操作，必须取得行动时确认。
3. 回滚候选路由不会删除迁移 005；旧版可继续读取旧流程，但不得把提醒 Job execute 路由回 `024`，因为旧 Implementation 不理解额度账本。
4. Cloud Function 继续保持 `ROOT_JOB_DRY_RUN=true`。部署候选、更新函数代码或路由、上传体验版、重新取得用户授权、执行真实 `r2` 发送必须分别确认。

## 6. 生产候选进度

1. `myroot-api-025 / v0.5.10` 已部署为 `URL_PARAMS / 0%` 条件候选；稳定版 `012` 继续承接默认流量。
2. 两个 Cloud Function 已仅更新代码并回读为 `v0.5.10`，6 个变量、10+1 个触发器、025 路由和全局 dry-run 均未漂移；11/11 Job 复测通过。
3. 微信开发者工具 CLI 已上传小程序 `v0.5.10`，实际上传 485,534 bytes；微信公众平台已回读该版本带“体验版”标记，未提交审核。
4. 025 定向预览已完成微信原生重新授权。相同手机号的第二个微信账号按账号关联规则合并；独立账号最终形成第 2 个独立参与用户。生产聚合为 3 条 `AVAILABLE` 额度、2 个 distinct 授权用户和 1 条新 `SCHEDULED / attempts=0` 任务。
5. 模拟次日 09:01 的未来时刻 dry-run 返回 `scannedCount=1 / DRY_RUN_READY=1`；事后回读确认任务、额度和送达记录均未发生写入。旧 `FAILED / 1006` 任务因结果证据为空继续禁止自动重试。
6. 025 对象存储探针已完成单对象上传、按返回对象标识精确删除、审计匹配和目录 `total=0` 回读，状态为 `VERIFIED`；没有开放业务对象 execute。
7. 经新的单独授权，单用户真实提醒仅执行一次；Job Interface 返回 `HTTP 200 / code=0`，唯一任务返回 `FAILED / 1006 / external HTTP 412 / externalErrorCode=null / deliveryOutcome=UNKNOWN`。没有第二次请求；按本版语义，匹配额度进入 `REVIEW_REQUIRED`，不得复用或重发。
8. 发送后 dry-run 为 `scannedCount=0 / staleSendingCount=0 / resultCount=0`。微信配置、令牌与目标模板只读探针通过；官方文档未定义 412，当前 HTTP Implementation 的 chunked 传输仅作为下一候选待验证假设。
9. 本轮未执行其他外部 Adapter 动作、5% 灰度或正式切流。
