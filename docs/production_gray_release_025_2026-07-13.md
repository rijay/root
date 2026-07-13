# myRoot CloudBase 灰度候选 025 证据

执行时间：2026-07-13 16:31-19:53 +08:00

状态：`DEPLOYED_AT_ZERO_PERCENT_DIRECTED / FUNCTIONS_ALIGNED / EXPERIENCE_VERSION_CONFIRMED / DRY_RUN_READY_PASS / OBJECT_STORAGE_VERIFIED / REAL_REMINDER_R2_FAILED_412_REVIEW_REQUIRED`

## 1. 实际读取来源

1. 本地 `v0.5.10` 候选 ZIP、源码清单、迁移 005、发布说明和生产预检。
2. CloudBase `DescribeCloudRunServerDetail`、`DescribeReleaseOrder`、`DescribeCloudRunDeployRecord`、`DescribeVersionDetail` 与灰度任务的行动时回读。
3. 025 条件路由下的 `/health`、`/ready`、公开隐私说明、Admin 和提醒 Job dry-run Interface。
4. 两个 Cloud Function 更新前后的代码包、状态、运行时、变量名数量、dry-run 开关、触发器数量、候选路由匹配结果和 11 个同步调用结果。
5. 微信开发者工具 CLI 登录态、小程序发布检查与上传结果，微信公众平台版本管理页，025 定向预览、微信原生订阅结果，以及参与者、授权额度、提醒任务和送达记录的脱敏聚合只读回读。
6. 行动时生产 Store Interface dry-run、唯一一次提醒 execute 结果、发送后 dry-run，CloudRun 微信配置的脱敏核对，以及微信令牌和模板清单只读探针。微信官方[发送订阅消息 Interface](https://developers.weixin.qq.com/miniprogram/dev/server/API/mp-message-management/subscribe-message/api_sendmessage.html)用于核对方法、路径、请求体和业务错误码。

路由值、环境变量值、VPC/子网 ID、数据库配置、Admin/Job token 和对象存储 Key 均未写入仓库或本证据。

## 2. 发布对象

| 项目 | 结果 |
| --- | --- |
| 环境 | `myroot-prod-d5gl3gzg7115f149a` |
| 应用 | `myroot-api` |
| 默认版本 | `myroot-api-012 / normal` |
| 新候选 | `myroot-api-025 / normal` |
| 应用版本 | `0.5.10` |
| BuildId | `2601318859` |
| 路由 | `URL_PARAMS / flowRatio=0 / myroot_canary / value present` |
| 本地来源 | 工作树候选；本轮未 commit、未 push |

## 3. 工件

1. 后端 ZIP：183 个条目、1,069,443 bytes，SHA-256 `d63f2101f0eb6e8fd3c8286fdf9b61642766f3692436f465c4bc22509f8334ac`。
2. 干净 CloudRun 输入：174 个文件，源码内容清单 SHA-256 `eb0739a066610af1c22e329715e0f0e10227ccd4f80600cecc26f890abc67d96`。
3. Cloud Function 本地包：`index.js` SHA-256 `506e23926bc927fda3b9b22673e1f99746334e8c29c8f5b8ba498d23a06df927`，`package.json` SHA-256 `0520b045c61117f524cc54e0c7085c16b33d32bef86dbb11db6ee1ed635d82d2`；更新后从两个函数下载的代码均与本地 `v0.5.10` 精确一致。
4. 更新前两个 `v0.5.7` 回滚包已下载到 `/tmp/myroot-cf-rollback-before-v0510-20260713-r1/`；旧 `package.json` SHA-256 为 `33f0bfceffd7fbb76f0d34288fb8fce9b660a3b30b24cc3d95b501947b59b17b`。
5. 小程序清单：157 个文件、509,550 bytes，SHA-256 `f5f85fd7c599f7359d0ff7c30b9bb663018db1abbf923e3593f86672e1911d3f`；微信开发者工具 CLI 已上传 `v0.5.10`，实际上传 485,534 bytes（474.2 KB）。
6. 本地完整验收：`15/15 PASS`，后端 `253/253 PASS`；迁移 005 已在隔离 MySQL 8 验证。小程序上传前检查全部通过。

## 4. 024 回收与默认流量保护

1. 行动时回读确认 012 为稳定版本，024 为 `URL_PARAMS / 0%` 条件候选，旧灰度任务与批准对象完全匹配。
2. 在内存中保留原条件路由后结束 024 灰度任务；发布单回到稳定版 012，随后才提交 025。
3. 025 配置完成后额外执行 15 次无参数 `/health`：15 次均为稳定响应，`0.5.10` 命中 0 次，失败 0 次。
4. 未删除 012、024 或历史版本，未修改默认流量或生产凭据。

## 5. 025 部署与运行 Gate

| Gate | 结果 |
| --- | --- |
| 构建状态 | `myroot-api-025 / normal` |
| 规格 | `1 CPU / 2 GB / min 1 / max 2 / port 80` |
| 网络 | 稳定版 VPC 与子网配置已继承并回读存在 |
| 环境 | 48 个环境变量名、无重复、必需名称齐全；未输出值 |
| `/health` | HTTP 200、业务码 0、`version=0.5.10 / releaseId=0.5.10` |
| `/ready` | HTTP 200、MySQL connected、迁移 `005_notification_subscription_grants.sql` |
| MySQL 权限 | `leastPrivilegeReady=true / privilegeScope=SCHEMA / privilegePolicyEnforced=true` |
| 隐私说明 | 处理者、有效公开联系方式、180 天保存期限和政策版本齐全 |
| Admin | 条件路由下 HTTP 200 |
| 对象存储 | 单对象上传、精确删除、审计匹配和目录 `total=0` 均通过 |
| 单用户真实提醒 | 唯一一次请求返回 `FAILED / 1006 / external HTTP 412 / UNKNOWN`；未重试，匹配额度进入人工核验语义 |
| 发布单 | `grayStatus=success / releaseStatus=gray / URL_PARAMS / flowRatio=0` |

候选首次启动已登记迁移 005。该迁移只增加授权表与提醒关联字段；回滚候选时不执行破坏性 down migration。

## 6. 对象存储、提醒与 Cloud Function 安全状态

1. 仅通过代码更新 Interface 将 `myroot-job-dispatcher` 与 `myroot-health-retention` 对齐到 `v0.5.10`；未提交函数配置、环境变量或触发器定义。
2. 更新后两个函数均为 `Active / Available / Nodejs18.15`，各保留 6 个变量，分别保留 10 与 1 个启用触发器；两者均为 `ROOT_JOB_DRY_RUN=true`，候选路由与 025 精确匹配。
3. 依次同步调用 10+1 个 Job，11/11 均返回 `releaseVersion=0.5.10 / dryRun=true / HTTP 200 / code=0 / InvokeResult=0`，且 `requestId` 为空；没有执行真实外部动作或健康数据清理。
4. 微信开发者工具 CLI 已上传 `v0.5.10`；微信公众平台版本管理页随后回读开发版本 `0.5.10` 已带“体验版”标记，提交时间为 2026-07-13 17:19:20。未点击“提交审核”，线上版本仍未改变。
5. 首个重新授权预览沿用了本地旧 024 编译条件，真机提示“接口不存在”。随后行动时回读 025 发布单，并生成只存在于 `/tmp` 的 trial 定向预览包；该包强制非 release 请求命中 025，release 明确禁用，路由值未写入仓库或证据。最终定向包 485,862 bytes，二维码 SHA-256 `6933d7f7c03dd03a9aec1e59c53cc56aff304914b84974da79160510fc7ccbeb`。
6. 重新授权前 `notification_subscription_grant` 为 0 行；首个真机账号选择“允许”后，2026-07-13 17:39:02 新增 1 条 `AVAILABLE` 额度。模板 key、模板 ID、版本 `v2026-06-28-tpl10850` 和活动 `ROOT_7D_RESET` 全部匹配，授权请求存在；未读取或记录用户标识。
7. 第二个微信账号在 18:43:58 再次产生 `AVAILABLE` 额度，但因使用相同手机号被账号关联 Module 合并到同一 Root 用户：额度增至 2，参与者和 distinct Root 用户仍为 1。该结果验证了账号合并规则，但不能冒充独立参与者样本。
8. 独立账号使用不同手机号完成流程后，19:28:21 新增第 2 个独立参与者，19:28:30 新增第 3 条 `AVAILABLE` 额度；聚合回读为参与者 2、distinct 参与用户 2、额度 3、distinct 授权用户 2，3 条额度均未占用或消费。
9. 独立账号的业务流程真实生成 1 条新 `SCHEDULED` 任务：计划时间 `2026-07-14 09:00 +08:00`、`attempts=0`，活动、模板 key、模板 ID 与版本均匹配，关联额度仍未分配；旧 `FAILED / attempts=1 / 1006` 任务继续单独保留。
10. 旧失败任务的送达结果、响应证据和接收方证据均为空，无法判断微信是否实际受理；为避免重复消耗一次性额度，本轮未恢复或重试该任务。
11. 对 025 提醒 Job 执行未来时刻 dry-run，模拟 `2026-07-14 09:01 +08:00` 返回 `HTTP 200 / code=0 / dryRun=true / scannedCount=1 / DRY_RUN_READY=1`。脱敏形状检查确认接收方存在、模板匹配、页面存在，字段恰为 `thing1/thing2/thing3`。
12. dry-run 后只读回读确认新任务仍为 `SCHEDULED / attempts=0`，未绑定额度；3 条额度仍全部 `AVAILABLE`，`RESERVED=0 / CONSUMED=0`，送达记录数量未增加，任务和额度更新时间未变化。截至该 dry-run 时点，尚未执行真实提醒、结算写入、有赞、企微、物流、发券或奖励动作。
13. 收口时再次只读回读发布单：`012 -> 025`，两版均为 `normal`，`URL_PARAMS / FlowRatio=0 / grayStatus=success / releaseStatus=gray / IsReleasing=true`，且唯一条件路由的键和值均存在；未输出其内容。
14. 经单独授权，2026-07-13 19:40:13 在 025 条件路由下执行对象存储探针。请求 ID 为 `canary-object-025-1783942812209-b8caa217`，对象键为 `release-probes/2026-07-13/canary-object-025-1783942812209-b8caa217.json`；返回 `HTTP 200 / code=0 / VERIFIED / version=0.5.10 / releaseId=0.5.10`，上传确认与精确删除确认均为 `true`，残留可能性为 `false`。
15. 探针后通过 CloudBase 存储 Interface 直接列举 `release-probes/2026-07-13/`，结果为 `total=0`；025 审计回读恰好 1 条 `CLOUDBASE_OBJECT_STORAGE_PROBE`，请求 ID、对象键、版本、上传与删除结果全部匹配。发布单再次回读无漂移；两个 Cloud Function 仍为 `Active / Available / ROOT_JOB_DRY_RUN=true`，10+1 个启用触发器和候选路由均存在。未触碰业务对象或改变自动执行模式。
16. 真实发送前再次对模拟 `2026-07-14 09:01 +08:00` 执行 dry-run：`HTTP 200 / code=0 / scannedCount=1 / staleSendingCount=0 / resultCount=1 / DRY_RUN_READY=1`。候选版本、模板、页面、接收方存在性、字段形状和可用额度均通过脱敏检查；发布单仍为 `012 -> 025 / URL_PARAMS / flowRatio=0`，两个 Cloud Function 仍为全局 dry-run。
17. 经新的单独授权，2026-07-13 19:48:57 仅向 025 条件候选提交一次真实请求，请求 ID 为 `checkin-reminders-formal-proof-20260713-r2-1783943337644-20327b`，限制为单用户、单并发。Job Interface 正常完成并返回 `HTTP 200 / code=0`，但唯一任务结果为 `FAILED / errorCode=1006 / errorMessage=微信接口请求失败：412 / externalErrorCode=null / deliveryOutcome=UNKNOWN`。没有第二次请求，也没有自动或人工重试。
18. 该 `HTTP 200 / code=0` 只证明 Job Interface 已完成受控执行和最终提交，不代表微信受理。按 v0.5.10 Implementation 的未知结果语义，任务进入 `FAILED / attempts=1`，送达结果保持 `UNKNOWN`，匹配的一次性额度必须进入 `REVIEW_REQUIRED`，不得释放、复用或重发。生产 MySQL 仅限 VPC，本轮没有把本地连接超时冒充 SQL 直读证明。
19. 发送后立即再次 dry-run 返回 `HTTP 200 / code=0 / scannedCount=0 / staleSendingCount=0 / resultCount=0`，证明没有继续到期的候选任务，也没有卡在 `SENDING` 的任务。发布单、稳定版 012、候选 025、0% 条件路由、两个函数状态、10+1 个触发器和 `ROOT_JOB_DRY_RUN=true` 均无漂移。
20. 只读配置探针确认 AppID 与目标小程序匹配、AppSecret 存在、模板 ID 匹配，发送目标为官方 HTTPS 路径且无额外查询参数；微信令牌返回 `HTTP 200 / expires_in=7200`，模板清单返回 `errcode=0`，目标模板存在且字段为 `thing1/thing2/thing3`。官方文档未定义 `HTTP 412`；本地线级复现确认现有 `requestJson` 未显式设置 `Content-Length`、实际使用 chunked 传输，这只是下一版待验证的首要假设，当前不能写成已确认根因。

## 7. 本轮明确未执行

1. 已执行且仅执行一次正式目标提醒 `r2`；结果为 `FAILED / 1006 / HTTP 412 / UNKNOWN`，未重试，也未再取得或消费其他用户额度。
2. 未开放生命周期导出、媒体或其他业务对象 execute；本次只执行并删除一个无用户信息的发布探针对象。
3. 未进入 5% 灰度、100% 切流、历史版本删除、生产凭据变更、commit 或 push。

## 8. 结论与后续 Gate

`myroot-api-025 / v0.5.10` 已完成 0% 条件候选部署；两个 Cloud Function 已对齐并在全局 dry-run 下完成 11/11 复测；公众平台体验版状态、独立用户授权、真实业务任务、未来时刻 `DRY_RUN_READY` 和对象存储精确写删证明均已通过。唯一一次新单用户真实提醒在调用微信发送 Interface 时返回外部 `HTTP 412` 且结果未知，提醒 Gate 因此继续 `BLOCKED`。在新增安全的外部响应诊断、验证并修复原因、取得全新一次性额度与新的行动时授权前，不得重试旧任务、请求 ID 或额度。
