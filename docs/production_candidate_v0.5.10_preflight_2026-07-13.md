# myRoot v0.5.10 生产 0% 候选预检

日期：2026-07-13

状态：`DEPLOYED_AT_ZERO_PERCENT_DIRECTED / FUNCTIONS_ALIGNED / EXPERIENCE_VERSION_CONFIRMED / DRY_RUN_READY_PASS / OBJECT_STORAGE_VERIFIED / REAL_REMINDER_R2_FAILED_412_REVIEW_REQUIRED`

## 1. 实际读取来源

1. 当前工作树中的提醒 Module、小程序订阅 Module、MySQL Store Implementation、迁移与投影、测试、版本文件和既有 024 证据。
2. `myroot-api-024` 首次正式目标提醒的仓库记录：任务 `FAILED / 1006`、未送达、未重试，原始微信说明未被旧版保留。
3. 预检阶段未读取 CloudBase 生产变量值、生产 MySQL 明细或微信后台；部署执行阶段已通过 CloudBase Interface 回读发布单、版本、VPC、变量名和运行探针，结果见第 7 节。历史证据没有被当作当前状态。
4. 真实提醒行动时只在内存中核对候选 AppID 是否匹配、AppSecret 是否存在、模板和发送路径是否正确；未输出凭据。随后读取微信官方发送说明，并运行令牌与模板清单只读探针。

## 2. 缺失与工作假设

1. 本轮完整 `npm run verify`、候选 ZIP/源码清单/小程序清单哈希和隔离 MySQL 8 的迁移 005 实测已完成。
2. 预检时缺失的 CloudBase 发布单、稳定版/候选版、VPC、变量名和默认路由已在行动时回读并关闭。
3. 用户重新点击原生订阅并生成真实授权额度的真机证据已完成；历史 `ACCEPTED` 没有被迁移或冒充新额度。
4. 原工作假设只用于本地准备；行动时已确认 `012` 为默认稳定版、`024` 为 0% 条件候选、Cloud Function 为全局 dry-run，随后才执行候选替换。
5. 微信公众平台已回读 `0.5.10` 为体验版；独立账号已产生第 2 个独立参与者、匹配的 `SCHEDULED` 任务和可用额度。未来时刻 dry-run 已取得 `DRY_RUN_READY`；随后唯一一次真实 `r2` 返回 `FAILED / 1006 / HTTP 412 / UNKNOWN`，因此仍没有实际送达证明。

## 2.1 本地证据

| Gate | 结果 |
| --- | --- |
| 完整验收 | `15/15 PASS`；223 个 JavaScript 文件；后端 `253/253`；5 个迁移 |
| 隔离 MySQL 8 | 迁移 005、授权表 22 列、真实投影 `CONSUMED`、检查点释放锁、跨 Adapter 并发写入、恢复合并、重启持久化均通过；容器已删除 |
| 后端 ZIP | `/tmp/myroot-api-0.5.10-local-20260713-r4.zip`；1,069,443 bytes；183 个条目；SHA-256 `d63f2101f0eb6e8fd3c8286fdf9b61642766f3692436f465c4bc22509f8334ac` |
| 展开源码 | 174 个文件；内容清单 SHA-256 `eb0739a066610af1c22e329715e0f0e10227ccd4f80600cecc26f890abc67d96` |
| 小程序清单 | 157 个文件；509,550 bytes；SHA-256 `f5f85fd7c599f7359d0ff7c30b9bb663018db1abbf923e3593f86672e1911d3f` |
| 凭据扫描 | 仅命中对象存储测试的合成 Bearer 哨兵；无私钥、腾讯云 AKID、数据库连接串或 JWT |
| 工作树格式 | `git diff --check` 通过 |

## 3. 目标与影响

1. 目标：部署平台分配的下一版本，预期 `myroot-api-025 / v0.5.10 / URL_PARAMS / 0%`；不进入百分比流量。
2. 影响：候选启动会应用 `005_notification_subscription_grants.sql`，新增授权表和提醒关联字段；不会删除旧表或旧数据。
3. 影响：生产快照中的历史 `wechatAccessToken` 缓存字段会在下一次规范化写入时移除；运行时改用进程内缓存。
4. 影响：历史订阅状态不生成授权额度。内测用户必须重新点击“开启明日提醒”，否则任务返回 `SKIPPED_NO_GRANT`。
5. 影响：送达任务在微信调用期间释放 MySQL 快照锁，单轮默认 5 路并发；发送前占用与发送后结果分别持久化。
6. 影响：真实发送缺少完整 `checkpoint/resume` 时返回 `50301`，任务和授权不进入发送态；dry-run 不返回 `touser` 或 OpenID。

## 4. 部署前 Gate

1. `npm run verify` 全部通过，版本一致性恢复，迁移校验和和候选源清单凭据扫描通过。`COMPLETE`
2. 隔离 MySQL 8 从迁移 004 升到 005，验证重复启动幂等、授权表投影、检查点提交、发送期间锁释放、恢复提交和中断后的保守隔离。`COMPLETE`
3. 行动时只读回读 CloudBase 当前版本、发布单、VPC、变量名、默认路由和 `ROOT_JOB_DRY_RUN=true`；未输出变量值。`COMPLETE`
4. 024 最终证据已归档；结束旧灰度任务前确认 012 承接默认流量，结束后稳定探针通过。`COMPLETE`
5. 已分别取得“部署 0% 候选并应用迁移 005”和“函数对齐、锁定 dry-run、复测 11 Job、上传体验版并重新授权”的明确确认；没有扩展到真实提醒发送、对象存储探针或默认流量变更。`COMPLETE`

## 5. 候选验证

1. 定向 `/health` 返回 `0.5.10`；`/ready` 返回 MySQL connected、迁移 005 和 schema 级最小权限证明。`COMPLETE`
2. 路由配置后额外 15 次无参数 `/health` 均为稳定响应，未命中 `0.5.10`。旧候选结束后的稳定探针也通过。`COMPLETE`
3. 两个 Cloud Function 已对齐 `v0.5.10`；10+1 个 Job 共 11/11 返回 `releaseVersion=0.5.10 / dryRun=true / HTTP 200 / code=0`，响应无 `touser`、OpenID 或 UnionID。两名独立参与用户合计持有 3 条匹配且未消费的 `AVAILABLE` 额度。`COMPLETE`
4. 公开隐私说明和 Admin 已通过；025 对象存储单对象上传、精确删除、审计匹配和探针目录 `total=0` 均已形成当前版本证明。`COMPLETE`
5. 函数代码与候选路由已对齐，公众平台已确认 `0.5.10` 为体验版；独立账号产生的 `SCHEDULED` 任务在未来时刻 dry-run 中返回 `DRY_RUN_READY=1`。经新的单独授权，唯一一次真实 `r2` 返回 `FAILED / 1006 / HTTP 412 / UNKNOWN`，未重试；提醒 Gate 保持阻断。`BLOCKED`
6. 未执行有赞、企微、物流、奖励、健康清理或其他业务对象写入；对象存储只创建并立即删除一个无用户信息的发布探针对象。提醒 execute 仅执行上述单用户单次请求。`PARTIAL`

## 6. 回滚

1. 构建或运行失败：放弃新候选，012 继续承接默认流量；不上传小程序。
2. 迁移 005 为加法变更，候选回滚时保留表和字段，不执行破坏性 down migration。
3. 回滚后保持提醒 Job dry-run，不把 execute 路由回旧 024；旧 Implementation 不具备授权额度消费语义。
4. 如 005 部分应用或投影失败，停止候选并只读核对 `schema_migrations`、表和列，不手工删除；形成独立修复方案后再执行。
5. 不删除 012、024 或历史版本，不修改生产凭据，不改变默认流量。

## 7. 执行结果

1. 2026-07-13 16:33，CloudBase 创建 `myroot-api-025`，BuildId `2601318859`，状态 `normal`。
2. 发布单回读为 `012 -> 025 / URL_PARAMS / flowRatio=0 / grayStatus=success`；原 `myroot_canary` 路由只在内存中复用，值未写入仓库或证据。
3. 025 继承 VPC，保留 48 个环境变量名；运行时确认 `version=0.5.10`、迁移 005、MySQL connected 与 schema 级最小权限。
4. 两个 Cloud Function 已使用只更新代码的 Interface 对齐到 `v0.5.10`；更新前回滚包已下载，更新后代码哈希一致，6 个变量、10+1 个触发器、候选路由和 `ROOT_JOB_DRY_RUN=true` 均未漂移。
5. 11/11 Job 同步调用均为 `releaseVersion=0.5.10 / dryRun=true / HTTP 200 / code=0`；未执行真实外部动作。
6. 微信开发者工具 CLI 已上传 `v0.5.10`，实际上传 485,534 bytes；微信公众平台版本管理页回读该开发版本已带“体验版”标记，提交时间为 17:19:20，未提交审核。旧 024 编译条件导致首个预览未命中候选后，使用仅存在于 `/tmp` 且 release 禁用的 025 定向预览完成真机授权；路由值未写入仓库或证据。
7. 首次重新授权在 17:39:02 生成第 1 条 `AVAILABLE`。第二个微信账号因相同手机号被合并到同一 Root 用户，只增加第 2 条额度；独立账号随后在 19:28 形成第 2 个独立参与用户和第 3 条额度。最终聚合为参与者 2、distinct 参与用户 2、额度 3、distinct 授权用户 2，全部额度均为 `AVAILABLE`。
8. 独立账号流程生成 1 条新 `SCHEDULED / attempts=0 / 2026-07-14 09:00 +08:00` 任务。模拟 `09:01` 的未来时刻 dry-run 返回 `scannedCount=1 / DRY_RUN_READY=1`，接收方、模板、页面和 `thing1/thing2/thing3` 形状均就绪。
9. dry-run 后新任务仍为 `SCHEDULED / attempts=0`，3 条额度仍为 `AVAILABLE`，没有新增送达记录或更新时间变化。旧 `FAILED / 1006` 任务因结果证据为空继续禁止自动恢复或重试。
10. 19:40:13 经单独授权执行 025 对象存储探针：`HTTP 200 / code=0 / VERIFIED / uploadConfirmed=true / deleteConfirmed=true / residualObjectPossible=false`。探针目录随后回读 `total=0`，审计记录恰好 1 条且与请求、对象键和 `0.5.10` 匹配。
11. 19:48:57 经新的单独授权提交唯一一次单用户真实提醒，请求 ID 为 `checkin-reminders-formal-proof-20260713-r2-1783943337644-20327b`。Job Interface 返回 `HTTP 200 / code=0`，唯一任务返回 `FAILED / 1006 / external HTTP 412 / externalErrorCode=null / deliveryOutcome=UNKNOWN`；未重试。按 v0.5.10 语义，额度进入 `REVIEW_REQUIRED`，不得复用。
12. 发送后 dry-run 返回 `scannedCount=0 / staleSendingCount=0 / resultCount=0`；发布单、0% 条件路由、两个函数及全局 dry-run 均无漂移。微信凭据、令牌和模板清单只读探针通过；官方文档未定义 412，现有请求采用 chunked 传输仅作为待验证假设。
13. 完整执行证据见 [025 生产证据](./production_gray_release_025_2026-07-13.md)。
