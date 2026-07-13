# myRoot CloudBase 灰度候选 024 证据

执行时间：2026-07-13 11:17-14:14 +08:00

状态：`DEPLOYED_AT_ZERO_PERCENT_DIRECTED`

## 1. 发布对象

| 项目 | 结果 |
| --- | --- |
| 环境 | `myroot-prod-d5gl3gzg7115f149a` |
| 应用 | `myroot-api` |
| 默认版本 | `myroot-api-012 / normal` |
| 新候选 | `myroot-api-024 / normal` |
| 应用版本 | `0.5.7` |
| 本地提交 | `af70ff9`；未 push |
| BuildId | `2601317457` |
| 路由 | `URL_PARAMS / flowRatio=0 / myroot_canary / value present` |

路由值、环境变量值、VPC/子网 ID、数据库配置、Admin/Job token 和对象存储 Key 均未写入仓库或本证据。

## 2. 工件

1. 后端 ZIP：181 个条目、1,048,548 bytes，SHA-256 `abde4fd1d30a7543a2c10e9c6fbdf41b7b582cf29e69e3ae7c9ab69d5cf2bb62`。
2. 干净 CloudRun 输入：172 个文件，源码内容清单 SHA-256 `f436464ab91485f0ddb6bcadd488e95191fda4b5509b88c2724d1d9fcfe69b61`。
3. 小程序清单：155 个文件、496,769 bytes，SHA-256 `38a2553de2f784f3f984fd759186277022e549d7a45238ae2c2e9aa595f01eeb`。
4. 完整本地验收：`15/15 PASS`，覆盖 216 个 JavaScript 文件；候选准备脚本自测 `4/4 PASS`。

## 3. 023 结束与默认流量保护

1. 023 最终证据已归档，定向 `/health`、`/ready` 和 MySQL 最小权限均通过。
2. CLI `traffic rollback` 成功结束 023 灰度；发布单回读 `IsReleasing=false / releaseStatus=fail / routeRuleCount=0`，012 保持 `normal`。
3. 结束 023 后，无参数 `/health` 连续 15 次均为 HTTP 200、稳定版响应形态，未命中 0.5.6 或 0.5.7。

## 4. 024 部署与配置

1. 从干净临时目录以 `ReleaseType=GRAY` 提交；平台生成预期版本 `myroot-api-024`。
2. 024 构建状态 `normal`，BuildId `2601317457`；初始发布单为 `FLOW / 0`，15 次无参数请求均未命中 0.5.7。
3. 024 版本回读：`1 CPU / 2 GB / min 1 / max 2 / port 80 / VPC present`，48 个环境变量名称且无重复；隐私、提醒和对象存储名称存在。
4. 使用官方 `ReleaseGray` Interface 复用原条件路由，回读 `grayStatus=success / releaseStatus=gray / URL_PARAMS / flowRatio=0 / IsReleasing=true`；012 为默认版本，024 为条件候选。
5. 配置后，无参数 `/health` 连续 15 次均为 HTTP 200、稳定版响应形态，未命中 0.5.7。

## 5. 024 定向 Gate

| Gate | 结果 |
| --- | --- |
| `/health` | HTTP 200、业务码 0、`version=0.5.7`、`releaseId=0.5.7` |
| `/ready` | HTTP 200、MySQL connected、迁移 `004_external_evidence_minimization.sql` |
| MySQL 权限 | `leastPrivilegeReady=true / privilegeScope=SCHEMA / privilegePolicyEnforced=true` |
| 隐私说明 | 已配置处理者、有效公开联系方式、180 天保存期限和政策版本 |
| 默认流量 | 路由配置后 15/15 次无参数请求未命中 0.5.7 |

## 6. 对象存储探针

- 请求 ID：`canary-object-024-1783913206733-920d1457`
- 对象键：`release-probes/2026-07-13/canary-object-024-1783913206733-920d1457.json`
- 提供方：`CLOUDBASE`
- 状态：`VERIFIED`
- 上传确认：`true`
- 精确删除确认：`true`
- 残留可能性：`false`
- 探针后直接列举 `release-probes/2026-07-13/`：`total=0`

## 7. Cloud Function dry-run

1. 经单独行动时授权，使用 `tcb fn code update` 依次更新 `myroot-job-dispatcher` 与 `myroot-health-retention`；只更新代码包，没有应用函数配置或改动触发器。
2. 两个函数复用同一 `index.js`，SHA-256 为 `506e23926bc927fda3b9b22673e1f99746334e8c29c8f5b8ba498d23a06df927`；0.5.7 `package.json` SHA-256 为 `33f0bfceffd7fbb76f0d34288fb8fce9b660a3b30b24cc3d95b501947b59b17b`。
3. 现网 0.5.6 回滚包在更新前分别下载并核对：两份 `index.js` 与仓库父提交一致，`package.json` SHA-256 均为 `c7ba60d6a2f30b3baf0ce03e6d7b55a1127028e95aa90e03cddeeecd7de7b12d`。
4. 更新后两函数均为 `Active / Available / Nodejs18.15 / 30 seconds / 256 MB`；每个函数各 6 个变量名、`ROOT_JOB_DRY_RUN=true`、候选路由存在性以及两函数合计 10+1 个启用触发器均未漂移。
5. 两函数通过各自候选路由定向访问 `/health`，均返回 HTTP 200、`version=0.5.7 / releaseId=0.5.7`。
6. 11/11 个作业全部返回 `InvokeResult=0 / releaseVersion=0.5.7 / dryRun=true / HTTP 200 / code=0 / ok=true`，且执行请求 ID 为空。
7. 首次批量复测脚本在 zsh 下把 10 个任务名误传为一个未知任务，函数按预期以 430 拒绝且未执行任何作业；改为显式数组后主函数 10/10 通过，随后双函数 11/11 总复测通过。
8. 未发送订阅消息、未清理健康数据、未执行结算写入、未调用真实有赞、企微、物流、发券或奖励动作。
9. 对齐完成后，无参数 `/health` 连续 15 次仍为稳定版响应形态，未命中 0.5.7。

## 8. 剩余正式 Gate

1. 上传同一提交的小程序体验版并完成登录、隐私、订阅、任务、媒体、结算、字体和 Root 会员中心跳转真机验证。
2. 配置并校准真实有赞、企微、物流、履约和告警通道；真实权益动作逐项取得行动时确认。
3. 完成 5% 灰度、业务回滚演练、严格证据包留档和产品/运营/研发三方签字。

在以上 Gate 关闭前，012 继续承接默认流量，024 只允许条件定向访问，不执行 100% 切流。

## 9. v0.5.8 / v0.5.9 真机增量证据

1. `v0.5.8` 已上传体验版并修复登录后永久加载阻断；但体验版无定向参数，默认命中 `012`，点击健康同意入口返回“接口不存在”。
2. 公网无参数 `GET/POST /api/v1/privacy/health-consent` 在 `012` 返回 404；相同路径经既有条件路由命中 `024` 时返回鉴权错误而非 404，证明 Interface 只存在于候选 Implementation。
3. `v0.5.9` 新增只对 `develop/trial` 生效的 Cloud Route Module；`release` 环境强制忽略定向参数，参数只驻留进程内且未进入 Git 跟踪文件。
4. 2026-07-13 真机扫描 `v0.5.9` 定向预览码后，用户完成登录、微信隐私授权、健康信息单独同意和身体画像 4/4 提交，进入标题为“Root7日身体重启计划”的活动首页；此前 404 已关闭。
5. 第二轮真机成功加入计划但未出现微信订阅授权，先移除了应用侧按模板版本永久缓存授权决定的短路；本机微信开发者工具官方类型定义表明该 Interface 属于一次性订阅，持久选择应由微信原生设置管理。
6. 第三轮预览码 SHA-256 为 `1f4f8d339051a739c1987d400bce8ae75c7416087dbb71f79aae5c7a290e2061`。真机首次打卡提交成功并进入任务进度页，但仍未出现授权弹层，提醒 Toast 被后续“已记录”和跳转覆盖。
7. 生产 SQL 只读回读为 `notification_subscription: UNKNOWN / subscribed=0 / CHECKIN_SUBMIT`，对应 `notification_job: SCHEDULED / 2026-07-14 / attempts=0`；这证明调度存在但订阅未生效。
8. 根因是原生授权位于加入、打卡和模板网络请求之后，已脱离用户点击手势。Campaign Join Module 已恢复为单一加入 Interface；Check-in Reminder Module 改为页面预载模板、独立按钮点击时先调用微信，再记录结果。任务页和进度页均提供常驻反馈，行为回归为加入 2/2、订阅 5/5 `PASS`。
9. 第四轮定向预览构建成功，总包体约 473.4 KB，预览码 SHA-256 `923d03306c82e1ebdc43b1e7a604f67116acbd36129fa8d78240a16f63905497`。真机点击独立按钮后页面显示“已开启”，SQL 只读回读为 `ACCEPTED / subscribed=1 / CAMPAIGN_JOIN`，更新时间 `2026-07-13 13:52:05`；对应任务为 `SCHEDULED / 2026-07-14 09:00 / attempts=0 / last_error=null`。订阅授权 Gate 已通过。
10. 任务进一步回读为 `miniprogram_state=formal / lang=zh_CN`。该值符合正式发布目标，但不能证明定向预览的 `trial` 跳转；实际消息送达与跳转、商品跳转、媒体和结算仍未形成完整真机证据。024 继续保持条件路由和 0% 默认流量。
11. 024 候选提醒 Job Interface 已用 `2026-07-14 09:01 +08:00` 做未来时刻 dry-run：`HTTP 200 / code=0 / scannedCount=1 / DRY_RUN_READY=1`。脱敏请求形状为 myRoot openid 与模板存在、`pages/tasks/index`、`formal`、`zh_CN`、`thing1/thing2/thing3`；无标识值进入终端或证据。Cloud Function 保持 `Active`，`checkin_reminders` 每 10 分钟启用，且全局 `ROOT_JOB_DRY_RUN=true` 未改变。
12. 用户行动时确认后，以 `checkin-reminders-formal-proof-20260713-r1` 对 024 条件候选执行一次正式目标发送；返回 `HTTP 200 / code=0 / dryRun=false / scannedCount=1 / FAILED / 1006`。执行后立即停止，未自动或人工重试。
13. SQL 只读回读确认任务 `FAILED / attempts=1 / sent_at=null`，送达 `FAILED / delivered_at=null`；因此实际送达 Gate 未通过。该请求 ID 已作为失败幂等记录封存，后续不得复用。
14. 只读配置探针确认候选 AppID 为 myRoot、密钥非空；官方微信令牌探针成功取得 7200 秒令牌，模板清单返回目标“活动提醒”及 `thing3/thing2/thing1`，数据库请求字段和长度均符合当前模板。云托管日志服务未启用，且 024 Implementation 将微信原始 `errmsg` 覆盖为 `1006`，本次根因只能收敛到订阅发送阶段，不能继续猜测为凭证、模板、openid、额度或版本状态中的某一项。
15. 本地已增加脱敏失败详情保留并通过提醒 4/4、后端 244/244、小程序完整检查；尚未提交、部署或改变 024。下一次发送必须先形成新版本候选，以新请求 ID `r2` 执行，并再次取得行动时确认。
16. 根仓库完整验收为 14/15；代码语法、迁移校验、依赖审计、Admin 构建、后端测试、小程序检查和 HTTP Interface smoke 均通过，唯一失败为小程序 `0.5.9` 与其余部署包 `0.5.7` 的版本对齐 Gate。下一候选必须统一版本后再部署。
17. 最终只读回读确认 `012` 仍为默认版本，`024` 仍为 `URL_PARAMS / flowRatio=0` 条件候选；`myroot-job-dispatcher` 为 `Active / Nodejs18.15 / ROOT_JOB_DRY_RUN=true`，本次诊断没有改变流量或自动执行状态。
