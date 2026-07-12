# myRoot 重构开发拆包 v1

版本：V0.1
日期：2026-06-19
状态：B0、B1、B2、B3、B4、B5、B6 与 B7 第一百段已实现；本地既定开发动作已收口，外部生产账号、真实证明和小批量执行证据不纳入当前开发完成范围
依据：

- [myroot_rebuild_iteration_plan.md](./myroot_rebuild_iteration_plan.md)
- [myroot_miniprogram_page_design_v1.md](./myroot_miniprogram_page_design_v1.md)
- [myroot_rebuild_route_and_migration.md](./myroot_rebuild_route_and_migration.md)
- 现有 `root_seven_day_checkin` 小程序、后台和 Store 代码结构

范围：

- myRoot 会员体验中心小程序
- Root 会员中心有赞小程序对接
- CloudBase/后端数据与任务执行
- Element Plus Admin 后台
- 可配置运营任务、活动结算和奖励发放

## 1. 拆包原则

1. 先稳定主键和数据模型，再改页面和运营配置。
2. 页面只消费 Presenter Module 给出的展示模型，不直接拼活动规则、订单状态或有赞字段。
3. 运营任务规则必须进入可配置 Module，不能写死在打卡、问卷或结算页面里。
4. 商品、订单、客户、优惠券都先进入 myRoot 镜像表，再通过 Adapter 与有赞打通。
5. 路演 20 左右并发按真实上线处理：所有写操作要幂等，展示页读缓存或快照，外部 Adapter 不阻塞用户主流程。
6. `unionid` 认证完成前先用 `app_code + openid + root_user_id` 稳定运行，认证完成后补链，不推翻数据模型。

## 1.1 B0/B1 第一段实现记录

本轮已完成：

1. 新增路径映射与迁移策略文档：[myroot_rebuild_route_and_migration.md](./myroot_rebuild_route_and_migration.md)。
2. 新增 `MYROOT_REBUILD_ENABLED` Feature Flag，默认进入新 myRoot 注册授权页；设置为 `false` 时未注册用户回到旧首页流程。
3. 新增身份数据结构：`rootUsers`、`wechatIdentities`、`userContactMethods`、`userLifecycleEvents`。
4. 扩展 `backend/db/schema.sql`，新增 `root_user`、`wechat_identity`、`user_contact_method`、`user_lifecycle_event`。
5. 扩展 Identity Resolution Module，支持 `resolveByWechatLogin`、`linkUnionId`、`attachContactMethod`、`recordLifecycleEvent`。
6. 改造微信登录：CloudBase 透传 `x-wx-openid` 时，不授权手机号也能创建 `root_user_id`；手机号授权后作为联系人证据补充，不创建第二个用户。
7. 改造 `pages/register/index`，从旧身体画像问卷变为注册授权页，明确“不强制绑定订单”。
8. 补充后端测试，覆盖 openid 无手机号登录、Feature Flag 回退、同 openid 补手机号、CloudBase header 登录。
9. 已通过 `cd backend && npm test` 与 `cd miniprogram && npm run check`。

本轮未完成但已保留：

1. 4 Tab 小程序页面重构放入 B4。
2. 商品自动同步已在 B7 第三段接出，客户镜像与订单补链基础能力已在 B7 第四段接出，订单增量运营入口已在 B7 第七段接出；订单增量正式字段和游标校准仍放入 B7 后续批次。
3. 任务中心小程序页面、完整可配置问卷页和进度详情页放入 B4。
4. 结算与奖励配置放入 B5。
5. Element Plus Admin 放入 B6。

## 1.2 B2 第一段实现记录

本轮已完成：

1. 新增 Product Mirror Module：`backend/src/productMirror.js`，集中提供 `listDisplayProducts`、`getDisplayProduct`、`recordProductJump`、`upsertDisplayProduct`。
2. 扩展 `backend/db/schema.sql` 与 Store 数据结构，新增 `youzan_product`、`youzan_sku`、`campaign_product_relation`、`product_jump_log`、`youzan_customer` 镜像对象。
3. 新增用户端商品 HTTP Interface：`GET /api/v1/products`、`GET /api/v1/products/:id`、`POST /api/v1/products/jump`。
4. 新增后台手工商品导入 MVP：`POST /api/v1/admin/products/upsert`，在有赞权限未完全确认时仍可维护路演商品快照。
5. 新增小程序商品列表 `pages/products/index` 和商品详情 `pages/product-detail/index`，首页与“我的”页已接入商品入口。
6. 新增小程序 `youzan-jump` 工具 Module，集中处理 Root 会员中心跳转目标、占位 appId 检查和失败提示。
7. 补充后端测试，覆盖无手机号/无订单用户浏览商品、商品跳转落 `product_jump_log`、后台手工导入商品。

本轮未完成但已保留：

1. 有赞商品/SKU 自动同步 Adapter 已在 B7 第三段接出；正式字段映射仍需等 Root 会员中心有赞商品样本校准。
2. 有赞客户 `youzan_yz_uid` 镜像与 `unionid/phone/rootUserId` 补链已在 B7 第四段接出；订单增量运营入口已在 B7 第七段接出，正式字段映射仍需等 Root 会员中心有赞订单样本校准。
3. 4 Tab 主导航仍放在 B4，本轮只新增页面和入口，不强制改 Tab。

## 1.3 B3 第一段实现记录

本轮已完成：

1. 新增 Campaign Module：`backend/src/campaign.js`，支持默认活动、活动创建/更新、用户加入活动；默认活动允许无订单参与。
2. 新增 Task Progress Module：`backend/src/taskProgress.js`，支持 `CHECKIN`、`QUESTIONNAIRE`、`SHARE`、`CONSULTATION`、`PURCHASE` 任务定义、任务事实幂等写入和进度快照计算。
3. 扩展 `backend/db/schema.sql` 与 Store 数据结构，新增 `campaign_definition`、`campaign_participant`、`task_definition`、`task_event`、`task_progress_snapshot`、`questionnaire_answer`。
4. 新增用户端活动/任务 HTTP Interface：`GET /api/v1/campaigns/active`、`POST /api/v1/campaigns/join`、`GET /api/v1/tasks/progress`、`POST /api/v1/tasks/events`。
5. 新增后台配置 HTTP Interface：`POST /api/v1/admin/campaigns/upsert`、`POST /api/v1/admin/task-definitions/upsert`，可配置 7/14/21 天等不同任务目标。
6. 旧 `submitCheckin`、`submitDailyCheckin`、`submitQuestionnaire` 和 `trackEvent` 已桥接到新任务事实，不破坏旧流程回归。
7. 补充后端测试，覆盖无订单用户加入活动并写打卡事实、幂等不重复计数、14/21 天配置、旧问卷/分享桥接。

本轮未完成但已保留：

1. 小程序任务中心、打卡提交页、问卷提交页、进度详情页放入 B4。
2. 问卷定义与 `questionnaire_answer` 的完整新版答卷 Module 已在 B7 第八十九段补齐，当前旧问卷仍保留桥接任务事实。
3. 结算条件与奖励发放仍放入 B5；B3 当前只负责事实与进度，不直接发券或免单。

## 1.4 B4 第一段实现记录

本轮已完成：

1. `miniprogram/app.json` 已改为 4 个主 Tab：`首页`、`商品`、`任务`、`奖励`。
2. 新增任务中心页 `pages/tasks/index`，读取活动与任务进度，支持加入活动、进入打卡/问卷/进度详情，并记录分享/咨询任务事实。
3. 新增奖励页 `pages/rewards/index`，展示必做任务达标进度、结算状态和奖励记录。
4. 新增任务 subpackage：`subpkg/task/pages/checkin/index`、`subpkg/task/pages/questionnaire/index`、`subpkg/task/pages/progress/index`。
5. 新增小程序任务展示 Presenter：`miniprogram/utils/task-presenter.js`，统一任务状态、进度文案、日期生成。
6. 首页商品入口和“我的”页菜单已适配新的 Tab 路由。
7. 后端 `ROUTE_PERMISSIONS` 与 release smoke 已补充新 4 Tab 和 `subpkg/task` 路由校验。

本轮未完成但已保留：

1. 奖励页已在 B5 第一段接入结算与奖励记录，后续需要接真实外部发放 Adapter。
2. 新问卷页已在 B7 第八十九段改为提交 `questionnaire_answer`，后端校验、留存答卷并桥接任务事实。
3. 订单同步页新版展示已在 B7 第二十二段补齐；用户咨询页与跟进状态已在 B7 第二十一段、第二十三段补齐，企微联系回写 Interface 已在 B7 第七十三段接入。

## 1.5 B5 第一段实现记录

本轮已完成：

1. 新增 Settlement Module：`backend/src/settlement.js`，支持规则版本、条件评估、结算预览、用户提交结算和状态查询。
2. 新增 Reward Grant Module：`backend/src/rewardGrant.js`，生成奖励承诺并用幂等键避免重复发券或重复复核。
3. 新增 Manual Review Module：`backend/src/manualReview.js`，免单机会和人工奖励进入复核池。
4. 扩展 `backend/db/schema.sql` 与 Store 数据结构，新增 `campaign_rule_version`、`settlement_record`、`reward_grant`、`reward_delivery_job`、`manual_review_item`。
5. 新增用户端结算 HTTP Interface：`GET /api/v1/settlement/status`、`POST /api/v1/settlement/evaluate`。
6. 新增后台规则/预览 HTTP Interface：`POST /api/v1/admin/campaign-rules/publish`、`POST /api/v1/admin/settlement/preview`。
7. 奖励页 `pages/rewards/index` 已从任务占位切换为真实结算状态、达标条件、奖励记录和人工复核展示。
8. 补充后端测试，覆盖无订单用户完成 7 天任务后生成优惠券/免单复核记录，以及 14/21 天规则可配置。

本轮未完成但已保留：

1. 有赞优惠券真实发放 Adapter、企微/有赞标签 Adapter 仍放入 B7；当前只生成 `reward_delivery_job`。
2. Element Plus Admin 的规则编辑、批量结算、复核处理页放入 B6；当前先提供后端 HTTP Interface。
3. `subpkg/profile/pages/review/index` 状态复核页首段已在 B7 第二十段细化；当前奖励页和“我的”页均可进入复核状态。
4. 旧 `coupon_event/refund_work_item` 到新 `reward_grant/manual_review_item` 的历史补迁策略待 B5 稳定后再定。

## 1.6 B6 第一段实现记录

本轮已完成：

1. 新增 Admin Config Presenter Module：`backend/src/adminConfigPresenter.js`，为后台整理活动、任务、商品、规则、结算、奖励、复核和发放任务的统一展示模型。
2. 新增后台运营配置 HTTP Interface：`GET /api/v1/admin/config-workbench`，页面不直接拼 Store 数据。
3. 扩展活动、任务、商品、规则发布、结算预览和人工复核处理路径；规则发布与复核关闭均写入审计记录。
4. 静态后台 `/admin` 新增 `运营配置` tab，首版可完成活动配置、任务配置、商品镜像维护、规则 JSON 发布、单人结算预览、奖励队列查看和人工复核通过/拒绝。
5. 人工复核处理已和 `reward_grant` 联动：免单机会或待复核奖励关闭后会同步更新奖励状态。
6. 补充后端测试，覆盖后台配置工作台数据、无订单用户结算后的复核处理、审计记录和 HTTP 鉴权。

本轮未完成但已保留：

1. 完整 Element Plus Admin 工程仍未初始化；当前先复用静态后台作为可运营过渡版本。
2. 多运营账号、细粒度角色、批量结算 UI、复杂筛选和可视化漏斗仍在 B6/B7 后续；Adapter 运行页第一段已在 B7 第八段接入。
3. 后台写操作当前已带 `operator_id` 审计，但 `request_id`、二次确认交互和更细的风险提示需要在 Element Plus Admin 中补齐。
4. 奖励真实发放仍停留在 `reward_delivery_job` 队列，需 B7 接有赞优惠券或人工发放 Adapter。

## 1.7 B6 第二段实现记录

本轮已完成：

1. 新增 `admin/` Element Plus Admin 工程骨架，包含 Vite、Vue 3、Element Plus、主题样式、开发/构建/校验脚本。
2. 新增 Admin HTTP client：`admin/src/api/client.js`，统一发送 `X-Admin-Token` 与 `X-ROOT-ADMIN-TOKEN`，保留现有 Admin Token 鉴权路径。
3. 新增运营配置前端 Module：`admin/src/modules/config/`，只通过 Backend Admin Interface 操作活动、任务、商品、规则、结算预览和人工复核。
4. 新增 `ConfigWorkbench.vue`，用 Element Plus 的 `el-tabs`、`el-form`、`el-table` 承接 B6 第一段静态后台能力。
5. 根目录新增 `admin:check`，最终验收脚本已纳入 Element Plus Admin validation、真实 build 与 Admin JS syntax check。

本轮未完成但已保留：

1. Element Plus Admin 已接用户生命周期页、审计页和 Adapter 运行页第一段；完整路由、布局权限和运营数据页仍待后续。
2. 批量结算、二次确认、`request_id`、表单细粒度校验和审计检索仍待后续 B6。
3. 当时旧静态 `/admin` 暂不下线，作为过渡后台和回退路径保留；B7 第三十六段后显式迁为 `/admin-legacy` 回退入口。

## 1.8 B6 第三段实现记录

本轮已完成：

1. 新增 Admin Lifecycle Presenter Module：`backend/src/adminLifecyclePresenter.js`，集中整理用户身份、UnionID 状态、任务进度、结算、奖励和运营卡点。
2. 新增后台用户生命周期 HTTP Interface：`GET /api/v1/admin/lifecycle-users`，支持关键词、用户状态、UnionID 状态和 limit 查询。
3. Element Plus Admin Shell 已从单页切换为 Module 路由骨架，`运营配置` 与 `用户生命周期` 可在左侧菜单切换。
4. 新增 `admin/src/modules/users/UserLifecycle.vue`，展示用户列表、UnionID 打通状态、任务进度、结算状态、奖励状态和生命周期详情抽屉。
5. Admin 自检已覆盖用户生命周期 Module，后端测试覆盖 lifecycle HTTP Interface 与 Presenter 输出。

本轮未完成但已保留：

1. 多运营账号、角色权限和菜单级访问控制仍待后续；当前继续沿用 Admin Token。
2. 批量结算、批量复核、`request_id`、二次确认和审计检索仍待 B6 后续。
3. Adapter 运行页第一段已在 B7 第八段接入，运营数据页仍按 B6/B7 后续推进，避免把外部自动化提前混入用户生命周期页。

## 1.9 B6 第四段实现记录

本轮已完成：

1. 新增 Admin Settlement Batch Module：`backend/src/adminSettlementBatch.js`，集中处理批量结算预览、执行、跳过、奖励生成和审计。
2. 新增后台批量结算 HTTP Interface：`POST /api/v1/admin/settlement/batch-preview`、`POST /api/v1/admin/settlement/batch-execute`。
3. 批量执行必须带 `request_id` 且必须二次确认；HTTP 路径支持 `X-Request-Id` 幂等，重复提交不会重复生成结算和审计。
4. 批量结算审计写入 `BATCH_SETTLEMENT_EXECUTE`，包含 operator、requestId、用户列表、预览摘要和执行摘要。
5. Element Plus Admin 的结算 tab 已新增批量 root_user_id 输入、批量预览、确认执行、二次确认 checkbox 和结果表。
6. 后端测试覆盖批量预览、二次确认、缺少 request_id 拦截、审计写入和 HTTP 幂等。

本轮未完成但已保留：

1. 更完整筛选仍待 B6/B7 后续。
2. 奖励发放人工确认与失败重试已在 B7 第一段补齐，有赞优惠券 HTTP Adapter 已在 B7 第二段接出，券状态查询已在 B7 第五段接出，企微标签发放已在 B7 第六段接出，有赞订单增量运营入口已在 B7 第七段接出，企微联系回写已在 B7 第七十三段接出；正式字段映射和生产定时重试仍在 B7 外部校准阶段。
3. 批量结算当前按 root_user_id 显式输入，后续可接筛选结果批量加入和分批队列执行。

## 1.10 B6 第五段实现记录

本轮已完成：

1. 新增 Admin Access Control Module：`backend/src/adminAccessControl.js`，提供 `admin`、`operator`、`finance`、`viewer` 的最小能力模型。
2. 后台高风险 HTTP Interface 已接入角色校验：配置写入、批量结算、人工复核和审计读取均通过统一权限 Module 判断；未配置 Admin Token 的本地开发仍保留 `local-admin` 全权限。
3. 新增 Admin Manual Review Module：`backend/src/adminManualReview.js`，把单条复核与批量复核的状态变更、奖励状态联动和审计写入集中到同一 Implementation。
4. 新增后台批量复核 HTTP Interface：`POST /api/v1/admin/manual-reviews/batch-resolve`，要求 `request_id` 与二次确认，HTTP 路径支持 `X-Request-Id` 幂等。
5. 批量复核审计写入 `BATCH_MANUAL_REVIEW_RESOLVE`，单条复核审计补充 `requestId` 与 `batchRequestId`，便于运营追溯。
6. Element Plus Admin 的奖励复核 tab 已支持 OPEN 复核项多选、批量通过/拒绝、`request_id` 和二次确认。
7. 新增 Element Plus Admin 审计记录 Module：`admin/src/modules/audit/`，支持按动作、操作人和关键词查询，并在详情抽屉中查看 metadata/before/after。
8. Admin 自检、后端测试和最终验收脚本已覆盖批量复核、角色拦截、审计查询和 HTTP 幂等。

本轮未完成但已保留：

1. 奖励发放人工确认/失败重试已进入 B7 第一段；发放 Adapter 运行页和运营数据漏斗仍放入后续 B7/B6。
2. 当前角色模型是最小能力集，后续若接企业微信 SSO 或更细审批流，只替换 Admin Access Control Seam 与 Token Adapter。
3. 当时静态 `/admin` 仍保留作回退路径，复杂运营工作继续迁入 `admin/` Element Plus Admin；B7 第三十六段后旧后台回退入口为 `/admin-legacy`。

## 2. 当前代码盘点

### 2.1 可复用

| 现有能力 | 文件 | 复用方式 |
| --- | --- | --- |
| Store Module | `backend/src/store.js` | 保留 Store Interface，新增重构数据结构和 CloudBase/生产 Adapter |
| 登录与微信授权 | `backend/src/domain.js`、`backend/src/identity.js` | 拆成 Identity Resolution Module，保留手机号归一化能力 |
| Operation Task Module | `backend/src/operationTask.js` | 扩展为运营待办，不等同用户任务事件 |
| Questionnaire Module | `backend/src/questionnaire.js` | 改造成可配置问卷定义与用户答卷 |
| External Adapter Sample Module | `backend/src/externalAdapterSamples.js` | 复用样本预览、字段映射、状态枚举校验 |
| External Platform Adapter Module | `backend/src/externalPlatformAdapters.js` | 复用 Adapter 运行记录、游标、失败落账 |
| Admin Auth 与审计 | `backend/src/app.js`、`backend/src/auditLog.js` | 保留后台最小安全与审计思路 |
| 小程序请求层 | `miniprogram/utils/request.js` | 保留统一请求、登录态和错误处理 |

### 2.2 必须重构

| 当前状态 | 风险 | 重构方向 |
| --- | --- | --- |
| `miniprogram/app.json` 仍是 2 个 Tab：`首页`、`我的` | 与新 4 Tab 页面设计不一致 | 改为 `首页`、`商品`、`任务`、`奖励` |
| 旧流程默认围绕 7 日试饮和订单绑定 | 与“订单非强制绑定”相冲突 | 用户参与任务不依赖订单，购买条件只是可配置条件之一 |
| `user` 表中 `openid`、`phone` 过重 | 不利于两个小程序用 `unionid` 补链 | 拆出 `root_user`、`wechat_identity`、`identity_link` |
| `checkin_session` 表达固定 7 日流程 | 难支持 7/14/21 天或组合任务 | 改为 `campaign_participant` + `task_event` + `task_progress_snapshot` |
| `coupon_event` 偏固定优惠券实验 | 难支持免单机会、积分、标签、人工复核 | 改为 `reward_grant` + `reward_delivery_job` |
| 静态后台 `backend/public/admin.*` 越来越重 | 当前 B6 第一段已可运营，但长期不适合复杂权限、批量结算和复核工作流 | B6 第二段已新增 `admin/` Element Plus 工程，旧后台只做过渡 |

## 3. 目标开发批次

推荐按 8 个 Batch 推进。P0/P1/P2 最小闭环可以上线路演；P3 做运营增强。

| Batch | 名称 | 目标 | 依赖 |
| --- | --- | --- | --- |
| B0 | 重构基线与旧流程冻结 | 确认 Canonical 页面、旧路径处置、测试基线 | 无 |
| B1 | 身份与数据地基 | 建立 `root_user_id`、微信身份、生命周期状态 | B0 |
| B2 | 商品与有赞镜像 | myRoot 可展示商品并跳 Root 会员中心购买 | B1 |
| B3 | 可配置运营任务 | 打卡、问卷、分享、咨询统一成为任务事实 | B1 |
| B4 | 小程序 12 页面重构 | 按 ardot 页面设计完成用户端主流程 | B1/B2/B3 |
| B5 | 结算与奖励 | 规则版本、条件判断、奖励记录和复核 | B3 |
| B6 | Element Plus Admin | 活动、任务、商品、用户、结算、复核后台 | B1-B5 |
| B7 | 外部 Adapter 与上线闸口 | 有赞、企微、CloudBase、`unionid` 补链 | B2/B5/B6 |

## 4. Batch 0：重构基线与旧流程冻结

目标：先让现有系统“可回归、可回退、可比对”，避免新旧流程混在一起。

目标文件：

- `docs/myroot_rebuild_development_breakdown_v1.md`
- `miniprogram/app.json`
- `backend/tests/*.test.js`
- `miniprogram/scripts/validate.js`
- `scripts/final-verification.js`

开发包：

| 编号 | 开发项 | 内容 | 验收 |
| --- | --- | --- | --- |
| DEV-0001 | Canonical 路由确认 | 定义新 12 页面与旧页面的保留、迁移、退役关系 | 文档列出新旧路径映射；旧订单绑定路径不再作为主流程入口 |
| DEV-0002 | 回归基线 | 跑通现有 `backend` 测试、小程序静态检查和根 `verify` | 当前测试结果记录到发布台账 |
| DEV-0003 | Feature Flag | 增加 `MYROOT_REBUILD_ENABLED` 或等价开关 | 旧流程与新流程可以灰度切换 |
| DEV-0004 | 数据迁移策略 | 明确旧 `user/checkin_session/coupon_event` 到新模型的迁移或只读归档 | 迁移脚本或只读归档策略二选一落文档 |

延期记录：

- 旧历史数据完整迁移可后置；首发可以保留只读归档，但不能影响新用户进入。

## 5. Batch 1：身份与数据地基

目标：所有业务写入都围绕内部 `root_user_id`，`openid` 和未来 `unionid` 只是身份凭据。

目标文件：

- `backend/db/schema.sql`
- `backend/src/identity.js`
- `backend/src/domain.js`
- `backend/src/store.js`
- `backend/src/app.js`
- `backend/tests/domain.test.js`
- `miniprogram/pages/register/*`

新增或调整数据对象：

| 数据对象 | 关键字段 | 说明 |
| --- | --- | --- |
| `root_user` | `root_user_id`、`lifecycle_status`、`source_channel` | 内部用户主表 |
| `wechat_identity` | `app_code`、`openid`、`unionid`、`root_user_id` | 两个小程序身份凭据 |
| `identity_link` | `root_user_id`、`link_type`、`evidence`、`confidence` | 手机号、订单、企微等补链证据 |
| `user_contact_method` | `root_user_id`、`phone_masked`、`phone_hash` | 手机号不作为主键 |
| `user_lifecycle_event` | `root_user_id`、`event_type`、`occurred_at` | 全生命周期轨迹 |

Module 与 Interface：

| Module | Interface | 说明 |
| --- | --- | --- |
| Identity Resolution Module | `resolveByWechatLogin(input, context)` | 通过 `app_code + openid` 找到或创建 `root_user_id` |
| Identity Resolution Module | `linkUnionId(rootUserId, unionid, evidence)` | 微信开放平台认证后补链 |
| Identity Resolution Module | `attachContactMethod(rootUserId, contact, evidence)` | 授权手机号只作为辅助证据 |
| User Lifecycle Module | `recordLifecycleEvent(rootUserId, event, context)` | 记录注册、入会、参与、结算、复核等状态 |

开发包：

| 编号 | 开发项 | 内容 | 验收 |
| --- | --- | --- | --- |
| DEV-1001 | 新身份模型落库 | 增加新数据对象，保留旧字段兼容层 | 新用户登录生成 `root_user_id`；不要求订单绑定 |
| DEV-1002 | 微信登录改造 | 登录请求带 `app_code`，区分 myRoot 与 Root 会员中心 | 同一个 `openid` 不跨应用误判；未来可由 `unionid` 合并 |
| DEV-1003 | 注册授权页 | 实现授权登录、手机号授权、非强制绑定订单说明 | 页面状态与 ardot 设计一致 |
| DEV-1004 | 生命周期事件 | 注册、授权手机号、进入活动、跳转商品、提交任务都写事件 | 后台可按用户查看事件时间线 |
| DEV-1005 | `unionid_pending` 状态 | 无 `unionid` 时允许继续参与，后台标记待补链 | 用户端不出现技术错误文案 |

## 6. Batch 2：商品与有赞镜像

目标：myRoot 展示商品和 SKU 快照，购买跳转 Root 会员中心；购买不是参与任务的前置条件。

目标文件：

- `backend/src/productMirror.js`
- `backend/src/commerceMirror.js`
- `backend/src/externalPlatformAdapters.js`
- `backend/src/youzanOpenAdapter.js`
- `backend/db/schema.sql`
- `miniprogram/pages/products/*`
- `miniprogram/pages/product-detail/*`

新增数据对象：

| 数据对象 | 关键字段 | 说明 |
| --- | --- | --- |
| `youzan_product` | `youzan_product_id`、`title`、`status`、`image_url`、`raw_payload` | 商品镜像 |
| `youzan_sku` | `youzan_sku_id`、`youzan_product_id`、`sku_name`、`price`、`stock_status` | SKU 镜像 |
| `campaign_product_relation` | `campaign_id`、`youzan_product_id`、`display_order` | 活动商品展示关系 |
| `product_jump_log` | `root_user_id`、`youzan_product_id`、`jump_target`、`occurred_at` | 跳转购买记录 |
| `youzan_customer` | `youzan_yz_uid`、`unionid`、`root_user_id`、`phone`、`nickname`、`match_source`、`linked_at`、`raw_payload` | 有赞客户镜像，B7 第四段已支持基础补链，正式字段仍需校准 |
| `youzan_order` | `youzan_order_no`、`root_user_id`、`youzan_yz_uid`、`status`、`paid_at` | 订单镜像 |

Module 与 Interface：

| Module | Interface | 说明 |
| --- | --- | --- |
| Product Mirror Module | `listDisplayProducts(campaignId, context)` | 给小程序商品页使用 |
| Product Mirror Module | `recordProductJump(rootUserId, productId, context)` | 记录跳转 Root 会员中心 |
| Product Mirror Module | `syncYouzanProducts(adapterInput)` | 同步或导入商品快照 |
| Commerce Mirror Module | `syncOrdersByTimeRange(range, cursor)` | P3 增量同步订单 |
| Commerce Mirror Module | `listUserOrders(rootUserId)` | 用户端订单同步状态展示 |

开发包：

| 编号 | 开发项 | 内容 | 验收 |
| --- | --- | --- | --- |
| DEV-2001 | 商品镜像模型 | 新建商品、SKU、活动商品关系 | 后台可维护至少 1 个活动商品 |
| DEV-2002 | 商品页 | 实现商品列表、同步时间、跳转购买 CTA | 点击 CTA 写 `product_jump_log` |
| DEV-2003 | 商品详情页 | 展示商品快照、规格、Root 会员中心说明 | 不展示不可靠库存或价格时用占位文案 |
| DEV-2004 | 有赞跳转 Interface | 封装小程序跳转参数，不散落在页面 | 跳转失败有可理解提示 |
| DEV-2005 | 商品导入 MVP | 首版支持手工导入或后台刷新，不强依赖自动同步 | 没有有赞权限时仍可完成路演展示 |

当前实现状态：

1. DEV-2001 至 DEV-2005 的第一段已完成，采用手工导入/Seed 快照支撑路演展示。
2. 商品页和详情页已从 myRoot 内展示商品快照，购买 CTA 先写 `product_jump_log`，再跳转 Root 会员中心。
3. 跳转 appId 若仍是占位值，用户端给出“Root 会员中心暂未配置”提示，不误导为购买失败。

延期记录：

- 有赞商品/SKU 全自动同步等 `D-002` 权限确认后启动。
- 有赞客户基础镜像与订单自动补链已在 B7 第四段接出；订单增量运营入口已在 B7 第七段接出；售后状态、更完整订单生命周期和 live 字段/游标校准等 `D-003/D-004/D-012` 继续放入后续批次。

## 7. Batch 3：可配置运营任务

目标：打卡、问卷、分享、咨询、指定商品购买都通过统一任务事实进入进度计算。

目标文件：

- `backend/src/campaign.js`
- `backend/src/taskProgress.js`
- `backend/src/questionnaire.js`
- `backend/src/operationTask.js`
- `backend/db/schema.sql`
- `miniprogram/pages/tasks/*`
- `miniprogram/pages/checkin-submit/*`
- `miniprogram/pages/questionnaire-submit/*`
- `miniprogram/pages/progress-detail/*`

新增数据对象：

| 数据对象 | 关键字段 | 说明 |
| --- | --- | --- |
| `campaign_definition` | `campaign_id`、`title`、`status`、`start_at`、`end_at` | 活动定义 |
| `campaign_participant` | `campaign_id`、`root_user_id`、`joined_at`、`status` | 用户参与记录 |
| `task_definition` | `task_id`、`campaign_id`、`task_type`、`config_json` | 可配置任务定义 |
| `task_event` | `root_user_id`、`campaign_id`、`task_id`、`event_type`、`payload_json` | 用户任务事实 |
| `task_progress_snapshot` | `root_user_id`、`campaign_id`、`snapshot_json`、`computed_at` | 进度快照 |
| `questionnaire_definition` | `questionnaire_id`、`version`、`questions_json` | 问卷配置 |
| `questionnaire_answer` | `root_user_id`、`questionnaire_id`、`answers_json` | 问卷结果 |

Module 与 Interface：

| Module | Interface | 说明 |
| --- | --- | --- |
| Campaign Module | `getActiveCampaign(context)` | 小程序首页入口 |
| Campaign Module | `joinCampaign(rootUserId, campaignId, context)` | 参与活动，不要求订单 |
| Task Progress Module | `recordTaskEvent(input, context)` | 所有用户任务事实统一入口 |
| Task Progress Module | `computeTaskProgress(rootUserId, campaignId)` | 生成进度快照 |
| Task Progress Module | `getProgressView(rootUserId, campaignId)` | 页面展示模型 |
| Questionnaire Module | `submitQuestionnaireAnswer(input, context)` | 写答卷并生成任务事实 |

开发包：

| 编号 | 开发项 | 内容 | 验收 |
| --- | --- | --- | --- |
| DEV-3001 | Campaign 基础模型 | 活动定义、参与记录、活动状态 | 后台可创建 7/14/21 天活动 |
| DEV-3002 | Task Definition 模型 | 支持 `CHECKIN`、`QUESTIONNAIRE`、`SHARE`、`CONSULTATION`、`PURCHASE` | 任务配置不写死在页面 |
| DEV-3003 | Task Event 幂等写入 | 每类任务有幂等键和重复提交处理 | 重复提交不会重复计数 |
| DEV-3004 | 进度快照 | 读取任务事实生成用户进度 | 首页、任务中心、进度详情可共用 |
| DEV-3005 | 今日打卡页 | 选择题提交并写 `task_event` | 无订单用户可提交打卡 |
| DEV-3006 | 阶段问卷页 | 可配置题目、必填校验、提交后写任务事实 | 问卷版本固定，旧答卷可追溯 |
| DEV-3007 | 分享/咨询任务 | 分享和企微咨询作为任务事件记录 | 任务中心状态可更新 |

当前实现状态：

1. DEV-3001 至 DEV-3004 的后端第一段已完成，活动、任务定义、任务事实和进度快照已可运行。
2. DEV-3002 已支持 `CHECKIN`、`QUESTIONNAIRE`、`SHARE`、`CONSULTATION`、`PURCHASE` 五类任务事实。
3. DEV-3003 已通过 `idempotency_key` 和任务日期去重，重复提交不会重复计数。
4. DEV-3005 至 DEV-3007 的小程序页面与新版问卷提交体验放入 B4 页面重构；当前可通过 HTTP Interface 先支撑联调。

## 8. Batch 4：myRoot 小程序 12 页面重构

目标：按 ardot 页面设计完成用户端，主导航改为 4 Tab，并处理所有关键状态。

目标文件：

- `miniprogram/app.json`
- `miniprogram/app.wxss`
- `miniprogram/config/env.js`
- `miniprogram/utils/request.js`
- `miniprogram/utils/router.js`
- `miniprogram/utils/myroot-presenter.js`
- `miniprogram/pages/home/*`
- `miniprogram/pages/products/*`
- `miniprogram/pages/tasks/*`
- `miniprogram/pages/rewards/*`
- `miniprogram/pages/register/*`
- `miniprogram/subpkg/product/pages/detail/*`
- `miniprogram/subpkg/task/pages/checkin/*`
- `miniprogram/subpkg/task/pages/questionnaire/*`
- `miniprogram/subpkg/task/pages/progress/*`
- `miniprogram/subpkg/profile/pages/orders/*`
- `miniprogram/subpkg/profile/pages/support/*`
- `miniprogram/subpkg/profile/pages/review/*`

页面开发包：

| 编号 | 页面 | 路径建议 | 依赖 | 验收 |
| --- | --- | --- | --- | --- |
| DEV-4001 | 活动首页 | `pages/home/index` | B1/B3 | 展示活动、今日任务、推荐商品 |
| DEV-4002 | 商品与购买跳转 | `pages/products/index` | B2 | 展示商品镜像，跳转有赞 |
| DEV-4003 | 任务中心 | `pages/tasks/index` | B3 | 展示任务进度和任务入口 |
| DEV-4004 | 结算奖励 | `pages/rewards/index` | B5 | 展示达标条件和奖励记录 |
| DEV-4005 | 注册授权 | `pages/register/index` | B1 | 不强制绑定订单 |
| DEV-4006 | 商品详情 | `subpkg/product/pages/detail/index` | B2 | 商品快照与跳转购买 |
| DEV-4007 | 打卡提交 | `subpkg/task/pages/checkin/index` | B3 | 写任务事实并更新进度 |
| DEV-4008 | 阶段问卷 | `subpkg/task/pages/questionnaire/index` | B3 | 题目配置和提交校验 |
| DEV-4009 | 有赞订单同步 | `subpkg/profile/pages/orders/index` | B2/B7 | 同步中、待同步、异常均有说明 |
| DEV-4010 | 用户咨询 | `subpkg/profile/pages/support/index` | B3/B7 | 跳企微咨询并可记录任务事件 |
| DEV-4011 | 状态复核 | `subpkg/profile/pages/review/index` | B5/B6 | 解释复核原因和退路 |
| DEV-4012 | 进度详情 | `subpkg/task/pages/progress/index` | B3 | 展示规则条件和用户完成状态 |

当前实现状态：

1. DEV-4002、DEV-4003、DEV-4004、DEV-4007、DEV-4008、DEV-4009、DEV-4010、DEV-4011、DEV-4012 已完成第一段可运行页面。
2. DEV-4004 奖励页已接入 B5 结算状态、奖励承诺和人工复核记录。
3. DEV-4001 首页已在 B7 第九十段完成 myRoot 活动首页改版，展示活动进度、今日建议任务、任务摘要、商品镜像和快捷入口。
4. DEV-4009 后续只保留真实订单字段、售后状态、多包裹和游标口径校准；DEV-4010 后续只保留企微真实 URL/token/模板校准、真实组织架构/企微会话字段校准和自动回写策略；DEV-4011 复核解释模板已在 B7 第七十八段接入，模板结构校验和后台预览已在 B7 第七十九段接入，后续只保留真实运营模板口径确认。

视觉与交互验收：

1. 4 个主 Tab：`首页`、`商品`、`任务`、`奖励`。
2. 次级页不重复底部 Tab，左上角提供返回。
3. 页面文案不暴露 `openid`、`unionid`、`yzUid`。
4. 商品页明确“myRoot 展示商品，Root 会员中心完成购买”。
5. 使用 Root 视觉 Token 和 OPLUS SANS 字体加载策略。
6. `miniprogram/scripts/validate.js` 通过。

## 9. Batch 5：结算与奖励

目标：运营能配置“完成什么条件，得到什么奖励”，系统生成可追溯结算与奖励记录。

目标文件：

- `backend/src/settlement.js`
- `backend/src/rewardGrant.js`
- `backend/src/manualReview.js`
- `backend/src/campaign.js`
- `backend/src/taskProgress.js`
- `backend/db/schema.sql`
- `backend/tests/domain.test.js`
- `miniprogram/pages/rewards/*`
- `miniprogram/subpkg/profile/pages/review/*`

新增数据对象：

| 数据对象 | 关键字段 | 说明 |
| --- | --- | --- |
| `campaign_rule_version` | `campaign_id`、`version`、`conditions_json`、`rewards_json`、`published_at` | 规则版本，发布后不可覆盖 |
| `settlement_record` | `root_user_id`、`campaign_id`、`rule_version`、`status`、`result_json` | 结算判断记录 |
| `reward_grant` | `root_user_id`、`reward_type`、`status`、`idempotency_key` | 奖励承诺 |
| `reward_delivery_job` | `reward_grant_id`、`adapter_type`、`status`、`attempt_count` | 自动发放任务 |
| `manual_review_item` | `root_user_id`、`review_type`、`reason`、`status` | 人工复核池 |

Module 与 Interface：

| Module | Interface | 说明 |
| --- | --- | --- |
| Settlement Module | `evaluateSettlement(rootUserId, campaignId, options)` | 根据规则版本和任务事实生成判断 |
| Settlement Module | `previewSettlement(campaignId, ruleVersion)` | 后台发布前预览 |
| Reward Grant Module | `grantReward(settlementRecord, context)` | 生成奖励承诺，幂等 |
| Reward Grant Module | `deliverReward(rewardGrantId, adapter)` | 自动发券或标签等外部动作 |
| Manual Review Module | `createManualReviewItem(input, context)` | 免单、身份冲突、订单异常进入复核 |

首版条件类型：

| 条件类型 | 配置字段 | 例子 |
| --- | --- | --- |
| 累计打卡 | `task_type`、`min_count` | 累计打卡 >= 7 天 |
| 连续打卡 | `task_type`、`min_streak` | 连续打卡 >= 7 天 |
| 问卷完成 | `questionnaire_id`、`required` | 完成阶段问卷 |
| 分享次数 | `task_type`、`min_count` | 分享小程序 >= 1 次 |
| 咨询参与 | `task_type`、`required` | 已联系企微顾问 |
| 指定商品购买 | `youzan_product_id`、`order_status` | 已购买指定商品 |

首版奖励类型：

| 奖励类型 | 发放策略 | 说明 |
| --- | --- | --- |
| 有赞优惠券 | P2 先生成待发放，P3 自动发券 | 不阻塞结算记录 |
| 免单机会 | 默认进入人工复核 | 避免风控和库存风险 |
| 积分 | 可先只记录承诺 | 后续接会员体系 |
| 标签 | B7 第六段已接企微标签发放 Adapter | 正式字段仍需校准 |
| 订单增量 | B7 第七段已接订单增量运营入口 | 正式字段、售后状态和游标仍需 live 校准 |
| 人工复核 | 生成复核项 | 运营确认后再发放 |

开发包：

| 编号 | 开发项 | 内容 | 验收 |
| --- | --- | --- | --- |
| DEV-5001 | 规则版本模型 | 条件和奖励 JSON 配置，发布后不可改 | 同一活动可有多版本历史 |
| DEV-5002 | 条件评估器 | 支持首版条件类型、平铺数组隐式 AND 和显式 AND/OR 条件树 | 7/14/21 天与任选互动规则可配置 |
| DEV-5003 | 结算记录 | 每次判断生成可追溯记录 | 失败原因、缺失条件可展示 |
| DEV-5004 | 奖励承诺 | 生成优惠券、免单机会等奖励记录 | 幂等键防重复发放 |
| DEV-5005 | 奖励页 | 展示达标条件、处理中、待发放、待复核 | 与 ardot 页面一致 |
| DEV-5006 | 人工复核 | 免单或异常进入复核池 | 用户端有退路，后台有处理入口 |

当前实现状态：

1. DEV-5001 至 DEV-5005 的第一段已完成，规则版本、条件评估、结算记录、奖励承诺和奖励页均可运行。
2. DEV-5002 已支持累计任务、连续任务、问卷完成、分享、咨询和购买条件；7/14/21 天规则可通过后台 HTTP Interface 发布，B7 第九十一段已补齐显式 AND/OR 条件树。
3. DEV-5004 已实现奖励幂等：重复提交结算会保留新的判断记录，但不会重复生成相同奖励承诺。
4. DEV-5006 已完成自动创建复核项的后端第一段，运营处理后台已在 B6 接入，状态复核独立页面已在 B7 第二十段接入。

延期记录：

- 有赞优惠券、企微/有赞标签的真实发放 Adapter 放入 B7；当前先写 `reward_delivery_job`，不阻塞用户结算。
- 复核 SLA、预计处理时间和运营备注展示已在 B7 第二十四段补齐；企微联系回写已在 B7 第七十三段接入；复核解释模板已在 B7 第七十八段接入。

## 10. Batch 6：Element Plus Admin

目标：后台从静态页面过渡到可运营、可配置、可审计的 Element Plus Admin。

目标目录建议：

- `admin/`
- `admin/src/modules/campaign/`
- `admin/src/modules/task/`
- `admin/src/modules/product/`
- `admin/src/modules/user/`
- `admin/src/modules/settlement/`
- `admin/src/modules/reward/`
- `admin/src/modules/review/`
- `backend/src/admin*.js`

后台页面拆包：

| 编号 | 后台页面 | 核心能力 | 依赖 |
| --- | --- | --- | --- |
| DEV-6001 | 登录与权限 | 管理员登录、角色、审计 | B1 |
| DEV-6002 | 用户生命周期 | 搜索用户、身份、事件、任务、订单、奖励 | B1-B5 |
| DEV-6003 | 活动配置 | 活动创建、上下线、渠道、时间 | B3 |
| DEV-6004 | 任务配置 | 任务类型、任务文案、任务条件 | B3 |
| DEV-6005 | 商品镜像管理 | 商品导入、排序、活动关联 | B2 |
| DEV-6006 | 规则版本编辑 | 条件与奖励配置、发布、版本历史 | B5 |
| DEV-6007 | 结算预览与执行 | 单人/批量预览、手动结算、重跑 | B5 |
| DEV-6008 | 奖励与复核 | 发放队列、失败重试、人工复核处理 | B5/B7 |
| DEV-6009 | Adapter 运行 | 有赞、企微、订单同步、游标、失败原因 | B7 |
| DEV-6010 | 运营数据 | 路演漏斗、商品跳转、任务完成、奖励转化 | B1-B7 |

后台 Interface 要求：

1. 后台只调用 Backend Admin Interface，不直接读取前端本地状态。
2. 所有写操作必须带 `operator_id`、`request_id` 和审计记录。
3. 规则发布、奖励发放、复核关闭属于高风险操作，必须有预览或二次确认。

当前实现状态：

1. DEV-6003 至 DEV-6008 的第一段已在静态后台 `/admin` 的 `运营配置` tab 中可用，第二段已迁入 `admin/` Element Plus Admin 首个 Module。
2. DEV-6003 支持活动 ID、标题、状态和周期配置。
3. DEV-6004 支持任务类型、标题、目标次数和必做状态配置。
4. DEV-6005 支持商品镜像标题、价格、活动关联、Root 会员中心跳转路径维护，以及有赞商品/SKU 同步预览与确认导入。
5. DEV-6006 支持规则 JSON 发布和版本历史展示，规则结构继续沿用 Settlement Module 的可配置条件与奖励模型。
6. DEV-6007 支持单人和批量结算预览/执行；批量执行已具备 `request_id`、二次确认、审计和 HTTP 幂等。
7. DEV-6008 支持奖励队列、发放任务、人工复核列表、单条复核关闭和批量复核；有赞优惠券 HTTP Adapter 已在 B7 第二段接出。
8. DEV-6002 的第一段已完成：Element Plus Admin 新增用户生命周期页，可查看身份、任务、结算、奖励和卡点摘要。
9. DEV-6001 的第一段已完成：Admin Token 支持多 token 与最小角色能力，viewer 只读，operator/admin 可执行运营写操作。
10. Element Plus Admin 已新增审计记录页，可查询批量结算、批量复核、规则发布等审计记录。
11. DEV-6010 的第一段已完成：Element Plus Admin 新增运营数据漏斗页，后端通过只读 Presenter Module 聚合企微线索、注册、活动参与、商品跳转、订单同步、任务、结算和奖励发放。
12. 根验证已新增 Element Plus Admin validation、build、批量复核、审计查询和运营数据漏斗 smoke，避免后续 Admin 工程游离在验收链路之外。

延期记录：

- 完整 `admin/` 状态管理和表单细粒度校验仍待实现。
- 权限模型当前只做最小角色能力，菜单级隐藏已在 B7 第三十五段接入，企业微信 SSO 待后续。
- 真实有赞发券 Adapter 已在 B7 第二段接出，Adapter 运行页第一段已在 B7 第八段接入；运营数据漏斗首版已在 B7 第十八段接入。
- DEV-6009/DEV-6010 已完成可运营首版，图表化和分群留存已在 B7 第二十七段接入，预警阈值配置与可调度 Job 已在 B7 第二十八段接入；后续继续补外部预警推送和真实字段校准后的口径复核。

## 11. Batch 7：外部 Adapter 与上线闸口

目标：外部系统可逐步接入，但任何外部异常都不拖垮 myRoot 主流程。

目标文件：

- `backend/src/externalPlatformAdapters.js`
- `backend/src/youzanOpenAdapter.js`
- `backend/src/weworkContactAdapter.js`
- `backend/src/rewardDeliveryAdapter.js`
- `backend/src/launchReadiness.js`
- `backend/scripts/adapter-runner.js`
- `DEPLOY.md`

Adapter 拆包：

| 编号 | Adapter | 首版策略 | 启动条件 |
| --- | --- | --- | --- |
| DEV-7001 | `WECHAT_UNIONID` | 先预留，认证后补链 | 微信开放平台认证通过 |
| DEV-7002 | `YOUZAN_PRODUCT` | 已支持手工样本和 HTTP Adapter 自动/半自动同步 | 有赞商品字段样本校准 |
| DEV-7003 | `YOUZAN_ORDER` | P1 展示同步中，P3 增量同步；B7 第七段已提供后台增量预览/确认入口 | 订单样本和状态枚举确认 |
| DEV-7004 | `YOUZAN_CUSTOMER` | 已支持 `yzUid + unionid/phone/rootUserId` 补链 | 真实客户字段校准 |
| DEV-7005 | `YOUZAN_COUPON` | P2 待发放，P3 自动发券 | 优惠券发放和查询权限确认 |
| DEV-7006 | `WEWORK_CONTACT` / `WEWORK_TAG` | 已支持企微线索同步和企微标签发放 Adapter | 企业微信客户联系字段与标签写入权限确认 |
| DEV-7007 | `CLOUDBASE_DEPLOY` | 小程序和后端部署配置 | CloudBase 环境确认 |

上线闸口：

| 检查项 | 灰度 | 正式 |
| --- | --- | --- |
| Store Adapter | 不允许内存 Adapter | CloudBase/生产 Adapter |
| 微信登录 | 可用测试 appid | 正式 appid/secret |
| 合法域名 | 测试域名可临时 | 必须配置正式 HTTPS |
| 有赞商品 | 可手工导入 | 自动或半自动同步有记录 |
| 订单同步 | 可展示同步中 | 样本准入和失败落账通过 |
| 奖励发放 | 可人工 | 自动发放需可重试和审计 |
| 规则版本 | 必须 | 必须 |
| 后台审计 | 必须 | 必须 |

### 11.1 B7 第一段实现记录

本轮已完成：

1. 新增 Reward Delivery Module：`backend/src/rewardDelivery.js`，集中处理 `reward_delivery_job` 的人工确认发放、失败记录、重试和审计。
2. 新增后台奖励发放 HTTP Interface：`POST /api/v1/admin/reward-delivery/execute`，支持单条或批量 `deliveryJobIds`，必须带 `request_id` 与二次确认。
3. 发放 Interface 支持 `X-Request-Id` 幂等，重复提交不会重复改写发放状态或重复写入批量审计。
4. 发放成功会把 `reward_delivery_job.status` 更新为 `DELIVERED`，同步把对应 `reward_grant.status` 更新为 `DELIVERED`，并记录 `external_ref`。
5. 发放失败会把任务置为 `FAILED`，记录 `last_error`、`attempt_count` 和 `next_retry_at`，奖励仍保持 `PENDING_DELIVERY`，可再次重试。
6. 新增审计动作：`REWARD_DELIVERY_EXECUTE` 与 `REWARD_DELIVERY_BATCH_EXECUTE`，记录 operator、requestId、Adapter 类型、结果和外部凭证。
7. Element Plus Admin 的奖励队列已支持多选 PENDING/FAILED 发放任务、确认发放、标记失败、填写外部凭证和二次确认。
8. Admin 自检、后端测试和最终验收脚本已覆盖奖励发放、角色拦截、失败重试、审计和 HTTP 幂等。

本轮未完成但已保留：

1. 当前默认发放路径仍是人工确认，用于 Root 会员中心有赞发券权限未确认前的可运营闭环。
2. 真实 `YOUZAN_COUPON` 自动发券 HTTP Implementation 已在 B7 第二段接出；正式调用仍待有赞权限、URL、token 和字段路径确认。
3. 有赞商品/SKU 自动同步已在 B7 第三段接出；有赞客户镜像与基础补链已在 B7 第四段接出；企微标签发放已在 B7 第六段接出；订单增量运营入口已在 B7 第七段接出，live 字段和游标校准仍按 B7 后续批次推进。

### 11.2 B7 第二段实现记录

本轮已完成：

1. 新增 Youzan Coupon Adapter Implementation：`backend/src/youzanCouponAdapter.js`，支持配置发券 URL、method、token 位置、额外参数、返回状态和外部凭证字段路径。
2. 新增 Reward Delivery Adapter Registry：`backend/src/rewardDeliveryAdapters.js`，在 `YOUZAN_COUPON_SEND_URL` 且 token 可用时注册 `YOUZAN_COUPON` Adapter。
3. `backend/src/rewardDelivery.js` 已接入 Adapter Seam：无配置时保持人工确认；显式自动发放且未配置 Adapter 时会落失败并写入重试信息；配置齐全时可调用真实 HTTP Implementation。
4. Element Plus Admin 发放任务新增 `人工确认/自动 Adapter` 模式选择，默认人工确认，避免有赞权限未稳定时误触真实发券。
5. 内置测试已覆盖有赞券发放请求、token 传递、奖励 payload 传递、外部券码回写和奖励状态更新。

本轮未完成但已保留：

1. 券状态查询基础能力已在 B7 第五段接出；失败自动定时重试和有赞正式字段映射仍需等真实有赞云权限与样本确认后收口。
2. `YOUZAN_PRODUCT` 已在 B7 第三段接出；`YOUZAN_CUSTOMER` 已在 B7 第四段接出；`WEWORK_TAG` 已在 B7 第六段接出；订单增量运营入口已在 B7 第七段接出，正式字段与游标仍按 B7 后续批次推进。

### 11.3 B7 第三段实现记录

本轮已完成：

1. 新增 Youzan Product Adapter Implementation：`backend/src/youzanProductAdapter.js`，支持商品列表 URL、method、token 位置、分页参数、列表路径、游标路径、商品字段映射和 SKU 字段映射配置。
2. 新增 Admin Product Sync Module：`backend/src/adminProductSync.js`，提供预览与确认同步，预览不会写入商品镜像，确认同步统一调用 Product Mirror Module。
3. 新增后台商品同步 HTTP Interface：`POST /api/v1/admin/products/sync-preview` 与 `POST /api/v1/admin/products/sync-execute`；确认同步必须带 `request_id` 与二次确认，并写入 `YOUZAN_PRODUCT_SYNC` 审计。
4. Element Plus Admin 的“商品镜像”Tab 已新增有赞商品同步工作区；样本 JSON 为空时调用有赞 HTTP Adapter，填写样本时可走半自动导入。
5. 后端测试已覆盖 Adapter token 注入、字段映射、预览不落库、确认同步落 Product Mirror、HTTP 幂等和审计记录。
6. 最终验收脚本已新增 `product_sync` smoke check，保证商品同步 Interface 与审计链路不被回归破坏。

本轮未完成但已保留：

1. 有赞商品正式字段路径、状态枚举、价格单位和 SKU 路径仍待 Root 会员中心真实商品样本校准。
2. Root 会员中心正式 appId、商品详情 path 和线上跳转版本仍需在上线前替换环境变量。
3. 有赞订单增量运营入口已在 B7 第七段接出；券状态查询基础能力已在 B7 第五段接出，企微标签发放已在 B7 第六段接出。

### 11.4 B7 第四段实现记录

本轮已完成：

1. 新增 Youzan Customer Mirror Module：`backend/src/youzanCustomerMirror.js`，以 `youzan_yz_uid` 为外部客户键，支持通过 `unionid`、`rootUserId` 或手机号把有赞客户镜像补链到内部 `root_user_id`。
2. 新增 Youzan Customer Adapter Implementation：`backend/src/youzanCustomerAdapter.js`，支持客户列表 URL、method、token、分页游标、列表路径、游标路径、hasMore 路径和客户字段映射配置。
3. External Adapter Sample Module 新增 `YOUZAN_CUSTOMER` 来源，支持 CSV/表格/JSON 样本导入，样本最小字段为 `有赞客户ID`，建议同时提供 `unionid`、手机号和昵称。
4. Adapter Calibration Module、External Platform Adapter Module 与命令行 Adapter Runner 已纳入 `YOUZAN_CUSTOMER`，上线前可与订单、物流、企微一起做样本准入和真实运行校准。
5. Order Fulfillment Module 已读取 `youzanYzUid` 与 `buyerUnionId`，订单导入时可先 upsert 有赞客户镜像，再通过 `AUTO_YOUZAN_CUSTOMER` 自动补链未绑定订单。
6. 新增后台客户镜像查询 HTTP Interface：`GET /api/v1/admin/youzan-customers`，B7 第十一段已接入 Element Plus Admin 客户镜像/补链排查页。
7. 后端测试和最终验收脚本已覆盖客户样本导入、真实客户 Adapter、订单补链、Adapter 校准来源数量和 `youzan_customer_mirror` smoke check。

本轮未完成但已保留：

1. Root 会员中心真实客户字段、客户列表路径、游标路径和 `yzUid/unionid/phone/nickname` 映射仍需要用真实有赞账号校准。
2. 有赞订单增量运营入口已在 B7 第七段接出；正式字段、状态枚举、售后状态和游标策略仍需 live sample 校准。
3. 企业微信联系回写已在 B7 第七十三段接入；运营数据漏斗首版已在 B7 第十八段接入，趋势/导出/预警已在 B7 第十九段接入，图表化和分群留存已在 B7 第二十七段接入。

### 11.5 B7 第五段实现记录

本轮已完成：

1. 新增 Youzan Coupon Status Adapter Implementation：`backend/src/youzanCouponStatusAdapter.js`，支持配置状态查询 URL、method、token 位置、外部券码参数名、状态字段路径、券码字段路径、核销时间和过期时间字段路径。
2. Reward Delivery Module 新增状态查询能力，发放与状态核验拆成两个 Interface：发放负责送出奖励，状态查询负责回写外部券状态。
3. 新增后台券状态查询 HTTP Interface：`POST /api/v1/admin/reward-delivery/status-query`，要求 `request_id`，复用奖励发放写权限，并写入 `REWARD_DELIVERY_STATUS_QUERY` 与 `REWARD_DELIVERY_STATUS_BATCH_QUERY` 审计。
4. 状态查询支持人工回写和自动 Adapter 两种路径；无真实有赞配置时，运营仍可手工标记 `ISSUED/USED/EXPIRED/CANCELLED`。
5. `reward_grant` 已新增外部状态、状态查询时间、外部状态 payload、核销时间和过期时间字段；`reward_delivery_job` 已新增状态查询时间字段。
6. Admin Config Presenter 已返回奖励外部状态，后续 Element Plus Admin 可直接加状态查询按钮和状态列。
7. 后端测试和最终验收脚本已覆盖真实状态 Adapter、后台状态查询权限、HTTP 幂等、审计和 `reward_status_query` smoke check。

本轮未完成但已保留：

1. `YOUZAN_COUPON_STATUS_URL`、token 位置、状态枚举和值路径仍需用 Root 会员中心有赞云真实账号校准。
2. 券状态自动定时轮询、批量查询效率优化和异常状态运营提醒仍按 B7 后续批次推进；外部平台 Adapter 到期重试调度已在 B7 第二十五段接入。
3. 企业微信联系回写已在 B7 第七十三段接入；有赞订单增量 live 校准仍按后续批次推进；运营数据漏斗首版已在 B7 第十八段接入，趋势/导出/预警已在 B7 第十九段接入，图表化和分群留存已在 B7 第二十七段接入。

### 11.6 B7 第六段实现记录

本轮已完成：

1. 新增 WeWork Tag Adapter Implementation：`backend/src/weworkTagAdapter.js`，支持配置标签写入 URL、method、token 位置、额外参数、结果状态路径、外部凭证路径和消息路径。
2. Reward Delivery Adapter Registry 已注册 `WEWORK_TAG`；当配置 `WEWORK_TAG_APPLY_URL` 和 `WEWORK_TAG_ACCESS_TOKEN`/`WEWORK_ACCESS_TOKEN` 时，可自动调用真实企微标签写入 Implementation。
3. `WEWORK_TAG` Adapter 会从奖励 payload、请求 body 或已同步的 `leadProfiles.external_contact_id` 推导企微外部联系人 ID，并把 `tagId`、`tagName`、`rewardGrantId`、`rootUserId` 一并传给外部平台。
4. 无真实企微配置时，奖励发放 Interface 仍可走人工确认，运营可以先记录外部标签凭证，不阻塞活动结算。
5. `lead_profile` schema 已补齐 `external_contact_id`、`wechat_remark_name` 和 `receiver_phone`，避免后续 MySQL/CloudBase 迁移时丢企微线索关键字段。
6. 后端测试和最终验收脚本已覆盖真实企微标签 Adapter、企微标签人工发放、外部凭证回写和 `wework_tag_delivery` smoke check。

本轮未完成但已保留：

1. `WEWORK_TAG_APPLY_URL`、token 位置、标签 ID、企微外部联系人 ID 字段和企微返回状态仍需用真实企业微信账号校准。
2. 批量标签重试和运营标签漏斗仍按 B7 后续批次推进；企微联系回写已在 B7 第七十三段接入，真实 URL/token/模板仍需生产校准。
3. 有赞订单增量正式有赞字段、售后状态和游标校准仍按后续批次推进。

### 11.7 B7 第七段实现记录

本轮已完成：

1. 新增 Admin Order Increment Sync Module：`backend/src/adminOrderIncrementSync.js`，把 `YOUZAN_ORDER` 增量同步收口成后台运营可执行的预览与确认 Interface。
2. 新增后台订单增量 HTTP Interface：`POST /api/v1/admin/orders/increment-preview` 与 `POST /api/v1/admin/orders/increment-execute`；确认执行必须带 `request_id` 与二次确认。
3. 订单增量入口可按请求选择 `YOUZAN_OPEN` 或 `MANUAL_SAMPLE` Adapter，样本预览不落库，确认导入后复用 External Platform Adapter Module 进入样本校验、订单导入、运行台账和游标提交。
4. 确认同步写入 `YOUZAN_ORDER_INCREMENT_SYNC` 审计，并通过 `X-Request-Id` 幂等保护，避免运营重复点击造成重复导入或重复审计。
5. 后端测试已覆盖预览、确认导入、游标提交、审计、角色拦截和 HTTP 幂等。
6. 最终验收脚本已新增 `order_increment_sync` smoke check，覆盖专用订单增量入口的预览、导入、幂等和审计链路。

本轮未完成但已保留：

1. Root 会员中心真实有赞订单 URL、token 位置、字段路径、状态枚举、售后状态和游标策略仍需用 live sample 校准。
2. Adapter 运行页第一段已在 B7 第八段接入；运行详情和重跑操作已在 B7 第九段接入。
3. 售后/退款状态、部分发货、多包裹和更完整订单生命周期仍放入 `D-003/D-004/D-012` 后续迭代。

### 11.8 B7 第八段实现记录

本轮已完成：

1. 新增 Element Plus Adapter Run Module：`admin/src/modules/adapters/AdapterRunPage.vue` 与 `admin/src/modules/adapters/adminAdapterApi.js`。
2. Admin Shell 已启用“Adapter 运行”菜单，页面可读取 Adapter catalog、运行台账、游标和准入来源。
3. 页面新增有赞订单增量同步工作区，支持 `MANUAL_SAMPLE` 样本预览/确认导入，也支持切换 `YOUZAN_OPEN` live 小批量预览/导入。
4. 确认导入会填写 `request_id`、二次确认和 `X-Request-Id`，复用后端 `YOUZAN_ORDER_INCREMENT_SYNC` 审计与幂等。
5. 运行台账支持按来源、Adapter 和状态筛选，可查看失败原因、导入数量和游标前后值。
6. `admin/scripts/validate.js` 已把 Adapter Run Module 纳入 Admin 自检，避免菜单或 Interface 契约后续回退。

本轮未完成但已保留：

1. 按运行 ID 深链已在 B7 第十段接入；真实平台失败重试策略已在 B7 第十七段接入。
2. Root 会员中心真实有赞订单字段、状态枚举、售后状态和游标策略仍需 live sample 校准。
3. 运营数据漏斗首版已在 B7 第十八段接入；趋势、导出、预警和自动刷新已在 B7 第十九段接入。

### 11.9 B7 第九段实现记录

本轮已完成：

1. Adapter Run Page 新增运行详情抽屉，点击运行台账行可查看 `run_id`、来源、Adapter、模式、状态、limit、游标、review_id 和失败原因。
2. 运行台账新增“重新预览”和“重试导入”动作，复用 `POST /api/v1/admin/external-adapters/run`。
3. 真实 Adapter 重跑会沿用历史运行的 `source_type`、`adapter_kind`、`requested_limit` 和 `cursor_before`，降低运营误选风险。
4. 手工样本运行不保存原始样本文本；有赞订单手工样本可使用当前订单增量表单文本重跑，其他手工样本提示运营重新粘贴样本。
5. 重跑结果若属于有赞订单，会回填订单增量结果区，方便运营直接核对可导入/已导入数量和错误提醒。
6. Admin 自检已新增 `runExternalAdapter`、运行详情抽屉和重跑动作契约，避免后续回退。

本轮未完成但已保留：

1. Adapter 人工回滚动作已在 B7 第十四段接入；真实平台失败重试策略已在 B7 第十七段接入。
2. 真实有赞/企微/物流字段校准仍需在 live sample 后确认；自动重试调度器已在 B7 第二十五段接入。
3. 运营数据漏斗首版已在 B7 第十八段接入；趋势、导出、预警和自动刷新已在 B7 第十九段接入；图表化和分群留存已在 B7 第二十七段接入，推送仍按后续批次推进。

### 11.10 B7 第十段实现记录

本轮已完成：

1. 新增 `GET /api/v1/admin/external-sample-reviews` 查询 Interface，支持按 `reviewId`、来源、模式和决策状态过滤，并返回指定评审详情。
2. `GET /api/v1/admin/external-adapters` 已带回最近取样评审列表，Adapter 运行页可直接把 `run.review_id` 和评审台账关联起来。
3. Adapter Run Page 支持 `?module=adapters&runId=...` 深链，打开链接后自动进入 Adapter 运行 Module 并展开对应运行详情。
4. 运行详情抽屉新增取样评审明细，展示决策状态、样本数、可导入/已导入数量、字段覆盖率、缺失字段和未知状态枚举。
5. Admin 自检、后端单测和最终验收脚本已覆盖取样评审详情查询、页面深链契约和字段覆盖率读取。

本轮未完成但已保留：

1. 跨页面跳转到指定 `run_id` 的入口已在本段接入；原始样本行排查已在 B7 第十六段接入。
2. 真实有赞/企微/物流字段校准、售后状态仍需在 live sample 后确认；自动重试调度器已在 B7 第二十五段接入。
3. 运营数据漏斗首版已在 B7 第十八段接入；趋势、导出、预警和自动刷新已在 B7 第十九段接入；图表化和分群留存已在 B7 第二十七段接入，推送仍按后续批次推进。

### 11.11 B7 第十一段实现记录

本轮已完成：

1. Youzan Customer Mirror Module 的查询 payload 新增补链状态、同 `yzUid` 订单数、已绑定/未绑定订单数、最近订单和下一步排查动作。
2. Element Plus Adapter Run Page 新增“有赞客户镜像”排查区，支持按 `yzUid`、UnionID、`root_user_id`、手机号或昵称搜索客户镜像。
3. 客户镜像表格展示补链状态、补链证据、订单绑定摘要、最近订单和下一步动作，点击客户可打开详情抽屉查看完整镜像记录。
4. 该页面用于排查“有赞客户已同步但订单未自动绑定”或“客户缺少 UnionID/手机号无法补链”等运营问题。
5. Admin 自检、后端测试和最终验收脚本已覆盖客户镜像 UI 契约、补链状态和订单摘要读取。

本轮未完成但已保留：

1. 客户镜像的人工改绑、冲突合并和批量补链动作仍按后续批次推进。
2. 真实有赞客户字段、客户列表路径、游标策略和 `yzUid/unionid/phone/nickname` 映射仍需用 live sample 校准。
3. 运营数据漏斗首版已在 B7 第十八段接入；趋势、导出、预警和自动刷新已在 B7 第十九段接入；图表化和分群留存已在 B7 第二十七段接入，推送仍按后续批次推进；原始样本行排查已在 B7 第十六段接入。

### 11.12 B7 第十二段实现记录

本轮已完成：

1. Element Plus ConfigWorkbench 的“奖励复核”Tab 新增券状态查询动作，支持选择有赞券发放任务后自动查询或人工回写外部券状态。
2. 奖励队列新增外部状态与最近查询时间列，发放任务表新增券状态与查询时间列。
3. 券状态查询表单支持 `MANUAL`/`AUTO` 两种模式，人工模式可回写 `ISSUED`、`USED`、`EXPIRED`、`CANCELLED` 和外部券码/备注。
4. 该动作复用 `POST /api/v1/admin/reward-delivery/status-query`，继续要求 `request_id` 并写入状态查询审计。
5. Admin 自检、后端测试和最终验收脚本已覆盖状态查询 UI 契约、workbench 外部状态展示和 `reward_status_query` smoke check。

本轮未完成但已保留：

1. 有赞券状态自动查询仍需真实 `YOUZAN_COUPON_STATUS_URL`、token、券码路径和状态枚举校准。
2. 运营数据漏斗首版已在 B7 第十八段接入；趋势、导出、预警和自动刷新已在 B7 第十九段接入；图表化和分群留存已在 B7 第二十七段接入，推送仍按后续批次推进；原始样本行排查已在 B7 第十六段接入。

### 11.13 B7 第十三段实现记录

本轮已完成：

1. Admin Config Presenter 为 `TAG` 奖励和 `WEWORK_TAG` 发放任务新增 `weworkTagHint`，集中返回标签 ID、标签名、企微外部联系人 ID、企微备注和来源渠道。
2. Element Plus ConfigWorkbench 的“奖励复核”Tab 已展示企微标签和外部联系人提示，发放任务支持一键把标签字段填入发放表单。
3. 奖励发放表单新增 `externalContactId`、`tagId` 和 `tagName`，提交时仍复用 `POST /api/v1/admin/reward-delivery/execute` 与同一个 `request_id`/二次确认机制。
4. `WEWORK_TAG` 人工确认和自动 Adapter 共用同一套页面字段，后续真实企业微信字段校准只需收口在 Adapter Implementation 与 Presenter。
5. Admin 自检、后端测试和最终验收脚本已覆盖企微标签 UI 契约、workbench 标签提示和 `wework_tag_delivery` smoke check。

本轮未完成但已保留：

1. `WEWORK_TAG_APPLY_URL`、token 位置、企微真实标签 ID、外部联系人字段和返回凭证路径仍需用真实企业微信账号校准。
2. 批量标签重试、标签冲突处理和运营标签漏斗仍按 B7 后续批次推进；企微联系回写已在 B7 第七十三段接入，真实 URL/token/模板仍需生产校准。
3. 原始样本行排查已在 B7 第十六段接入；订单增量 live 字段校准仍按后续批次推进。

### 11.14 B7 第十四段实现记录

本轮已完成：

1. External Platform Adapter Module 新增运行级人工回滚 Interface：`rollbackAdapterRun(data, body)`，只允许回滚 `IMPORT` 运行，要求 `request_id` 与二次风险确认。
2. External Adapter Sample Module 在导入时记录 `rollbackRefs` 与 `rollbackNotes`；新建订单、履约、有赞客户和企微线索会形成可回滚目标，更新既有记录在本段先写入风险说明，字段级恢复已在 B7 第十五段补齐。
3. 后台新增 `POST /api/v1/admin/external-adapters/rollback`，复用配置写权限、`X-Request-Id` 幂等和审计，审计动作是 `EXTERNAL_ADAPTER_RUN_ROLLBACK`。
4. 回滚动作会按目标类型删除本次导入新建的数据，并在安全条件成立时把 Adapter 游标退回到上一条成功运行；若当前游标已被后续运行推进，只记录跳过，避免覆盖更新链。
5. Element Plus Adapter 运行页新增 `rollback_status`、可回滚目标数、运行详情回滚结果和“回滚”按钮；页面会二次确认后再调用后台 Interface。
6. 后端测试、HTTP Interface 测试、Admin 自检和最终验收脚本已覆盖运行级回滚、角色拦截、幂等、审计、订单/履约删除和游标回退。

本轮未完成但已保留：

1. 已更新过既有订单、客户、履约或线索字段的运行，已在 B7 第十五段补充字段级 before snapshot。
2. 真实平台失败重试策略已在 B7 第十七段接入；运营数据漏斗首版已在 B7 第十八段接入，趋势/导出/预警已在 B7 第十九段接入，图表化和分群留存已在 B7 第二十七段接入；原始样本行排查已在 B7 第十六段接入。
3. 订单增量 live 字段、售后状态、多包裹和有赞游标策略仍需真实 Root 会员中心账号校准。

### 11.15 B7 第十五段实现记录

本轮已完成：

1. External Adapter Sample Module 在更新既有订单、有赞客户、履约和企微线索前记录 `beforeSnapshot`，并把 `restoreExisting` 写入对应 rollback target。
2. `YOUZAN_ORDER` 导入现在可同时记录订单字段快照、订单导入引发的有赞客户镜像快照，以及本次新建履约记录的删除目标。
3. `FULFILLMENT` 导入现在会同时记录履约字段快照和订单 `delivery_status` 快照，避免只恢复物流表、不恢复订单表。
4. External Platform Adapter Module 的回滚 Implementation 已支持“有快照则恢复、无快照则按新增数据删除”的统一路径，并兼容旧的 `rollbackWithOrder` target。
5. 后端测试新增既有记录恢复用例，覆盖订单、履约、有赞客户和企微线索四类 target；最终验收脚本新增 `adapter_snapshot_rollback` smoke check。

本轮未完成但已保留：

1. 字段级快照只恢复目标主记录；自动匹配产生的运营待办、生命周期事件和外部平台侧动作仍需人工核对。
2. 真实平台失败重试策略已在 B7 第十七段接入；运营数据漏斗首版已在 B7 第十八段接入，趋势/导出/预警已在 B7 第十九段接入，图表化和分群留存已在 B7 第二十七段接入。
3. 订单增量 live 字段、售后状态、多包裹和有赞游标策略仍需真实 Root 会员中心账号校准。

### 11.16 B7 第十六段实现记录

本轮已完成：

1. External Sample Review 记录新增 `rows` 行级排查 payload，包含原始字段、映射字段、字段 presence、错误、警告、导入状态和简要导入结果。
2. `GET /api/v1/admin/external-sample-reviews?reviewId=...` 现在可直接返回完整原始样本行排查数据，仍复用已有取样评审 Interface。
3. Element Plus Adapter 运行详情抽屉新增“原始样本行排查”，支持按问题行、错误、警告、已导入和全部筛选，也支持关键字搜索原始字段、映射字段、错误和警告。
4. 点击样本行可查看原始字段 JSON 和映射字段 JSON，真实有赞/企微字段校准时可直接定位字段名、枚举和映射问题。
5. 后端测试、HTTP Interface 测试、Admin 自检和最终验收脚本已覆盖 review rows、raw/mapped 字段和页面排查控件。

本轮未完成但已保留：

1. 真实平台失败重试策略已在 B7 第十七段接入；运营数据漏斗首版已在 B7 第十八段接入；趋势、导出和预警已在 B7 第十九段接入；自动重试调度器已在 B7 第二十五段接入。
2. 订单增量 live 字段、售后状态、多包裹和有赞游标策略仍需真实 Root 会员中心账号校准。
3. 若后续真实样本行过大，需要把 `review.rows` 从内嵌 JSON 拆到独立分页存储；当前灰度排查先保留最近 30 次评审。

### 11.17 B7 第十七段实现记录

本轮已完成：

1. External Platform Adapter Module 的运行台账新增 `retry_status`、`retry_attempt`、`retry_source_run_id`、`retry_reason` 和 `next_retry_at`。
2. 真实 Adapter 缺配置、缺 Implementation 或字段校准类失败会进入 `MANUAL_REVIEW`；5xx、429、超时和网络抖动类失败会进入 `RETRYABLE` 并给出建议重试时间。
3. 从失败运行重新预览或重试导入时，新运行会记录来源失败 `run_id`；成功后标记为 `RETRY_SUCCEEDED`，便于复盘重试 lineage。
4. Element Plus Adapter 运行页已展示重试状态、建议重试时间、重试来源和重试原因，并在重跑请求中携带 `retrySourceRunId`。
5. 后端测试、HTTP Interface 测试、Admin 自检和最终验收脚本已覆盖不可重试失败、可重试失败、重试来源和页面契约。

本轮未完成但已保留：

1. 自动按 `next_retry_at` 扫描并触发重跑的调度器已在 B7 第二十五段接入；CloudBase/cron 可调用的 Job Interface 已在 B7 第二十六段接入。
2. 订单增量 live 字段、售后状态、多包裹和有赞游标策略仍需真实 Root 会员中心账号校准。
3. 运营数据漏斗首版已在 B7 第十八段接入；趋势、导出、预警和自动刷新已在 B7 第十九段接入；图表化和分群留存已在 B7 第二十七段接入，推送仍按后续批次推进。

### 11.18 B7 第十八段实现记录

本轮已完成：

1. 新增 Admin Analytics Presenter Module：`backend/src/adminAnalyticsPresenter.js`，通过一个只读 Interface 汇总运营漏斗，页面不直接读取 Store 内部结构。
2. 新增后台运营数据 HTTP Interface：`GET /api/v1/admin/operational-analytics`，支持 `campaignId`、`dateFrom`、`dateTo` 查询。
3. 漏斗首版覆盖企微线索、myRoot 注册、活动参与、商品跳转、订单同步、订单补链、任务启动、达到结算、结算通过、奖励生成和奖励发放。
4. 瓶颈项首版覆盖企微线索未补链、参与后未开始任务、跳有赞后订单未补链、达标未结算和奖励待处理。
5. Element Plus Admin 新增 `OperationalAnalytics` Module，并开启“运营数据”菜单，展示阶段转化、瓶颈、任务类型、来源、奖励状态和最近活动。
6. 后端测试、HTTP Interface 测试、Admin 自检和最终验收脚本已覆盖运营漏斗聚合、查询入口和页面契约。

本轮未完成但已保留：

1. 当前是只读聚合首版，趋势、导出、自动预警和定时刷新已在 B7 第十九段接入；图表化和分群留存已在 B7 第二十七段接入，预警推送仍待后续。
2. 商品跳转、活动参与和任务结算的 `campaignId` 口径后续需要结合真实 Root 会员中心商品关系统一复核，避免跨活动商品造成漏斗偏差。
3. 订单增量 live 字段、售后状态、多包裹、有赞游标策略和真实发券字段仍需真实账号校准后回看漏斗口径。

### 11.19 B7 第十九段实现记录

本轮已完成：

1. Admin Analytics Presenter Module 新增日期趋势、预警派生和 CSV 导出 Interface，继续保持页面只消费后台展示模型。
2. `GET /api/v1/admin/operational-analytics` 返回 `alerts`、`trend` 和刷新建议；任务趋势优先按 `task_date` 归属，避免补录时把运营趋势打到录入日。
3. 新增 `GET /api/v1/admin/operational-analytics/export`，可导出阶段、瓶颈、预警和趋势 CSV。
4. Element Plus Admin 的“运营数据”页新增预警表、日期趋势表、CSV 导出按钮和自动刷新开关。
5. 后端测试、HTTP Interface 测试、Admin 自检和最终验收脚本已覆盖趋势、预警、CSV 导出和自动刷新页面契约。

本轮未完成但已保留：

1. 趋势首版用表格呈现；图表化总览、来源分群留存和渠道对比已在 B7 第二十七段接入，环比仍放入后续运营增强。
2. 预警首版是页面内只读提示，暂未推送企微/钉钉/短信，也未配置阈值后台。
3. 真实 Root 会员中心商品关系、订单字段、售后状态和发券字段校准后，需要复核趋势与预警口径。

### 11.20 B7 第二十段实现记录

本轮已完成：

1. 新增 `subpkg/profile/pages/review/index` 状态复核页首段，页面只消费 `GET /api/v1/settlement/status` 的展示模型，不在小程序内复制结算或复核判断。
2. 状态复核页展示待处理复核、历史复核、最近结算和关联奖励，并把 `FREE_ORDER_REVIEW`、`REWARD_REVIEW` 等内部枚举转成用户可读文案。
3. 奖励页人工复核卡片新增“查看进度”入口；“我的”页菜单新增“状态复核”入口。
4. 小程序路由守卫已允许已注册、任务中、已完成、失败和日常用户进入复核页，未注册用户仍回到注册/首页主流程。
5. `miniprogram/scripts/validate.js` 与 release smoke 已覆盖复核页存在性、路由白名单和奖励页/个人中心入口契约。

本轮未完成但已保留：

1. 复核 SLA、处理预计时间和运营备注已在 B7 第二十四段从 Manual Review Module 回传；企微联系回写已在 B7 第七十三段接入；复核解释模板已在 B7 第七十八段接入。
2. 企微联系回写真实 URL、token、模板和回执字段仍待生产校准，当前用户侧仍保留小程序客服/人工协助退路。
3. 订单同步页新版展示已在 B7 第二十二段补齐；本段当时仅保留拆分背景。

### 11.21 B7 第二十一段实现记录

本轮已完成：

1. `subpkg/profile/pages/support/index` 从静态客服入口升级为用户咨询页首段，支持选择订单物流、打卡问卷、奖励复核和身体反馈四类咨询主题。
2. 已登录用户点击联系顾问时会调用 `POST /api/v1/tasks/events` 写入 `CONSULTATION` 任务事实，继续复用 Task Progress Module 的幂等、活动归属和进度快照 Interface。
3. 未登录用户仍可直接使用微信客服入口，不阻塞人工协助。
4. 支持页新增订单与物流、状态复核、任务进度三个快捷入口，减少用户在咨询前后的跳转成本。
5. `miniprogram/scripts/validate.js` 已覆盖支持页必须保留微信客服入口和 `CONSULTATION` 任务事件记录；release smoke 已覆盖咨询任务可写入并推进可选任务进度。

本轮未完成但已保留：

1. 企微联系回写已在 B7 第七十三段接入，顾问分配已在 B7 第七十四段接入；真实企业微信外部联系人 ID、真实组织架构和自动回写策略仍待生产字段校准。
2. 咨询跟进状态已在 B7 第二十三段补齐；后续只保留真实企微字段、真实组织架构和自动回写策略。
3. 有赞订单同步页新版展示已在 B7 第二十二段补齐。

### 11.22 B7 第二十二段实现记录

本轮已完成：

1. `subpkg/profile/pages/orders/index` 从原始订单列表升级为有赞订单同步页首段，页面继续只消费 `GET /api/v1/user/orders`，不在小程序内复制订单补链或字段校准规则。
2. 新增订单同步展示 Presenter，按无订单、同步中、已送达、异常、取消等状态输出用户可读标题、说明和样式。
3. 页面新增同步说明，明确“Root 会员中心购买，myRoot 展示订单和活动相关状态”，并强调不强制订单绑定才能参与任务。
4. 已同步订单展示商品、金额、匹配方式、收货信息和物流节点；无订单时提供商品入口，异常和疑问状态提供人工协助入口。
5. `miniprogram/scripts/validate.js` 与 release smoke 已覆盖订单同步说明、商品入口、人工协助退路和订单 Interface 契约。

本轮未完成但已保留：

1. 有赞订单 live 字段、售后状态、多包裹、拆单和游标策略仍需真实 Root 会员中心账号校准后扩展。
2. 当前用户端只展示已补链到当前用户的订单；未补链订单仍通过后台有赞客户镜像/订单补链排查处理。
3. 若后续需要主动触发订单同步，可在 Admin Order Increment Sync Module 稳定后再暴露用户端刷新提示，不在本段新增外部调用。

### 11.23 B7 第二十三段实现记录

本轮已完成：

1. 新增 `backend/src/consultationFollowup.js`，把 `CONSULTATION` 任务事实与 `CONSULTATION_FOLLOW` 运营待办组合成咨询跟进状态 Module。
2. `POST /api/v1/tasks/events` 记录咨询事件时，会自动生成幂等的顾问跟进待办，并写入 `CONSULTATION_FOLLOW_CREATED` 生命周期事件。
3. 新增用户端 `GET /api/v1/user/consultations`，小程序咨询页可展示最近咨询、待跟进/已跟进/已关闭状态和运营备注。
4. Element Plus 用户生命周期页新增待跟进咨询指标、表格标签和详情说明，运营能从生命周期工作台识别需要跟进的咨询。
5. 小程序静态校验、Admin 自检、后端 HTTP 测试和 release smoke 已覆盖咨询跟进 Interface，避免后续只记录咨询而丢失处理状态。

本轮未完成但已保留：

1. 企微联系回写已在 B7 第七十三段接入，顾问分配已在 B7 第七十四段接入；真实企业微信外部联系人 ID、真实组织架构和聊天结果自动拉取仍需生产字段校准。
2. 咨询 SLA、超时提醒、顾问工作台和 SLA 升级链路已在 B7 第七十五至七十七段接入；当前跟进处理仍复用运营待办完成动作，小程序页面不直接理解待办实现。
3. 复核解释模板已在 B7 第七十八段接入，模板校验与后台预览已在 B7 第七十九段接入，后续只需按真实运营口径确认模板内容。

### 11.24 B7 第二十四段实现记录

本轮已完成：

1. Manual Review Module 的 `toManualReviewPayload` 新增 `slaHours`、`expectedResolutionAt`、`overdue`、`statusCopy`、`publicNote`、`operatorId` 和 `resolution`，让状态复核页只消费稳定展示 Interface。
2. 新建复核项时按优先级生成默认 SLA：高优先级 12 小时、正常 24 小时、低优先级 48 小时，也支持后续从 `metadata` 覆盖。
3. Admin 处理单条或批量复核时可传入用户可见备注，复核完成后小程序状态复核页展示运营备注和处理结果。
4. `subpkg/profile/pages/review/index` 已展示预计处理时间、SLA 文案、超时提示和历史复核备注。
5. 小程序静态校验、Admin 自检、后端测试和 release smoke 已覆盖复核 SLA、预计处理时间和运营备注展示。

本轮未完成但已保留：

1. 企微联系回写已在 B7 第七十三段接入；真实顾问身份和外部联系人证据仍需等企微字段生产校准后完善。
2. 复核解释模板已在 B7 第七十八段接入，模板校验与后台预览已在 B7 第七十九段接入，后续运营可继续扩展模板内容，但不改变当前 Manual Review Interface。

### 11.25 B7 第二十五段实现记录

本轮已完成：

1. 新增 `backend/src/adapterRetryScheduler.js`，按 `FAILED + RETRYABLE + next_retry_at` 扫描到期真实 Adapter 运行，并提供预览/执行同一套调度 Interface。
2. 调度器默认每批 5 条、最多 20 条，保留 `maxAttempts`、来源筛选和 Adapter 筛选入口；达到最大尝试次数、已有后续重试子运行或同一 Adapter 已有更新成功运行时会跳过，避免重复打同一失败页。
3. 新增 `POST /api/v1/admin/external-adapters/retry-due`，支持 `dryRun` 预览和执行模式，执行时复用 External Platform Adapter Module 的运行 Interface，自动写入新的 retry lineage、取样评审和游标结果。
4. Element Plus Adapter 运行页新增到期重试数量、预览到期重试、执行到期重试和结果摘要，运营可在人工干预前先看清候选运行。
5. `createApp` 透传 `adapterImplementations` 与 `fetchImpl` 到 runtime context，方便本地、测试和 CloudBase MCP 环境注入真实平台 Adapter 的不同 Adapter。
6. 后端 domain/API 测试、Admin 自检和最终验收脚本已覆盖自动重试调度器预览、执行、lineage 和幂等请求入口。

本轮未完成但已保留：

1. CloudBase/cron 可调用的 Job Interface 已在 B7 第二十六段接入；正式云端定时频率、环境变量和触发器配置仍需上线环境确认。
2. 真实有赞、企微和物流字段校准仍需 live sample 后确认；自动重试只负责调度，不替代字段映射验收。
3. 失败到达最大尝试次数后的通知与负责人路由已在 B7 第二十九段接入；外部预警 Webhook Adapter 已在 B7 第四十七段接入，运营图表化和分群留存已在 B7 第二十七段接入。

### 11.26 B7 第二十六段实现记录

本轮已完成：

1. 新增 `POST /api/v1/jobs/adapter-retry-due`，作为 CloudBase 定时触发或外部 cron 调用的到期重试 Job Interface，复用 B7 第二十五段的 Adapter Retry Scheduler Module。
2. Job 执行模式要求稳定 `request_id`，并复用后台角色能力校验；`dryRun: true` 可用于上线前预览候选运行。
3. `withIdempotency` 已支持显式 `requestId`，定时任务把 `request_id` 放在 header 或 body 中都能进入同一个幂等账本。
4. 新增 `backend/scripts/adapter-retry-scheduler.js` 和 `npm run adapter-retry --prefix backend`，支持 `--dry-run`、`--batch-size`、`--max-attempts`、`--source`、`--adapter`、`--request-id` 和后台口令参数，便于 CloudBase 任务、运维 cron 或本地灰度调用。
5. 后端 API 测试覆盖 Job 鉴权、角色能力、缺少执行 `request_id`、dry-run、执行和重复 `request_id` 幂等；最终验收脚本新增 `adapter_retry_job` smoke。

本轮未完成但已保留：

1. 正式 CloudBase 控制台触发器频率、访问域名、后台口令注入和告警渠道仍需在生产环境配置时确认。
2. 真实有赞/企微/物流字段校准仍按后续运营增强推进；运营图表化和分群留存已在 B7 第二十七段接入，预警阈值配置与可调度 Job 已在 B7 第二十八段接入，最大尝试次数后的通知与负责人路由已在 B7 第二十九段接入，外部预警 Webhook Adapter 已在 B7 第四十七段接入。

### 11.27 B7 第二十七段实现记录

本轮已完成：

1. Admin Analytics Presenter Module 新增 `retentionSegments` 与 `charts` 输出，继续把运营数据口径收口在后端只读展示 Interface。
2. 来源分群留存按 `root_user_id` 的优先来源归因，企微线索来源优先于默认登录来源，避免同一用户被拆到登录、活动入口和商品跳转多个来源。
3. `retentionSegments` 覆盖线索、注册、参与、跳有赞、订单补链、任务启动、结算达标、结算通过、奖励生成和奖励发放，并给出分群状态与下一步建议。
4. `charts` 提供漏斗条形、趋势序列和分群条形三类页面可直接消费的数据，页面不再重新计算图表口径。
5. Element Plus Admin 的“运营数据”页新增漏斗图表、趋势图表、来源分群留存表和分群任务启动图表。
6. CSV 导出新增分群与分群奖励段；后端 domain/API 测试、Admin 自检和最终验收脚本已覆盖新增 Interface 与页面契约。

本轮未完成但已保留：

1. 预警推送仍停留在页面内提示，后续需补企微/钉钉/短信等外部通知 Adapter。
2. 阈值后台配置已在 B7 第二十八段接入；环比、按活动商品/路演场次的更细分组仍作为后续运营增强。
3. 真实 Root 会员中心有赞字段、企微字段、CloudBase 控制台触发器配置和告警渠道仍需生产环境校准；Job 发布 Manifest 已在 B7 第三十一段接入。

### 11.28 B7 第二十八段实现记录

本轮已完成：

1. 新增 Operational Alerts Module，统一管理运营预警规则、阈值评估、通知落账和 Job 运行记录。
2. Store 与 schema 新增 `operationalAlertRules`、`operationalAlertRuns`、`operationalAlertNotifications`，并纳入 snapshot 校验。
3. Admin Analytics Presenter 的 `alerts` 改为按有效规则评估，同时返回 `alertRules`、`alertSummary`、`alertRuns` 和 `alertNotifications`。
4. 新增 `POST /api/v1/admin/operational-alert-rules/upsert`，运营可配置瓶颈项、阶段转化和来源分群阈值；写操作要求 `request_id` 并写入审计。
5. 新增 `POST /api/v1/jobs/operational-alerts`，CloudBase 定时任务或运维 cron 可 dry-run 预览或执行运营预警；执行模式要求稳定 `request_id`，并支持冷却时间避免重复通知。
6. Element Plus Admin 的“运营数据”页新增预警阈值配置、规则表、Job 预览/执行和通知记录。
7. 后端 domain/API 测试、Admin 自检和最终验收脚本已覆盖阈值配置、Job 幂等和通知落账。

本轮未完成但已保留：

1. 真实企微/钉钉/短信通知通道仍需生产环境 URL、密钥、模板和告警负责人确认；当前 `WEBHOOK` 只保留通用 HTTP Adapter Seam。
2. 最大重试次数后的通知和业务负责人路由已在 B7 第二十九段接入；分群推送到外部渠道仍待生产通知 Adapter 配置后推进。
3. 环比、活动商品和路演场次维度仍按后续运营增强推进。

### 11.29 B7 第二十九段实现记录

本轮已完成：

1. Operational Alerts Module 新增负责人路由字段：`ownerRole`、`ownerName`、`ownerContact`、`routeKey`，规则保存、告警评估、通知落账和 Webhook payload 共用同一 Interface。
2. Store schema 的 `operational_alert_rule` 与 `operational_alert_notification` 增加负责人和路由字段，历史通知保留当时责任人快照，避免规则后改造成证据漂移。
3. 新增 `ADAPTER_RETRY_EXHAUSTED` 预警目标类型，默认规则 `op_alert_adapter_retry_exhausted` 监控真实 Adapter 失败且 `retry_attempt >= 5` 的运行。
4. Adapter 达到最大重试次数后会进入运营预警评估，通知记录会固化来源 `run_id`、Adapter 类型、失败原因和研发负责人路由。
5. Element Plus Admin 的“运营数据”页新增负责人、联系方式、路由 Key 和 Webhook 输入，规则表与通知表展示负责人。
6. 后端 domain/API 测试、Admin 自检和最终验收脚本已覆盖负责人路由、Adapter 重试耗尽预警、通知落账和 `POST /api/v1/jobs/operational-alerts` smoke。

本轮未完成但已保留：

1. 真实企微/钉钉/短信通知通道仍需生产环境 URL、密钥、模板和告警负责人确认；当前外部发送仍走通用 `WEBHOOK` Adapter Seam。
2. 环比、活动商品和路演场次维度仍按后续运营增强推进。
3. 运营预警命令行运行器已在 B7 第三十段接入，CloudBase Job 发布 Manifest 已在 B7 第三十一段接入；正式控制台触发器、后台口令注入和生产告警渠道仍需上线环境配置时确认。

### 11.30 B7 第三十段实现记录

本轮已完成：

1. 新增 `backend/scripts/operational-alert-runner.js`，作为运营预警 Job 的命令行 Adapter，可供 CloudBase 定时任务、运维 cron 或本地灰度调用。
2. 新增 `npm run operational-alerts --prefix backend`，支持 `--base-url`、`--admin-token`、`--campaign`、`--date-from`、`--date-to`、`--dry-run`、`--execute`、`--request-id`、`--reason` 和 `--json`。
3. 命令行默认 dry-run，只有显式 `--execute` 才写通知；执行模式自动生成稳定 `request_id`，也允许外部调度器传入自己的 `request_id`。
4. 命令行报告输出命中数、发出数、跳过数、失败数、命中预警和执行结果，并按失败情况返回非零退出码，便于 CloudBase 或 cron 做告警。
5. 后端 API 测试已覆盖 runner 参数解析、dry-run、execute、报告输出和退出码；最终验收脚本已通过 runner 执行一次运营预警 Job。

本轮未完成但已保留：

1. CloudBase Job 发布 Manifest 已在 B7 第三十一段接入；正式 CloudBase 控制台触发器仍需上线环境配置时确认。
2. 真实企微/钉钉/短信通知通道仍需生产环境 URL、密钥和模板；当前外部发送仍走通用 `WEBHOOK` Adapter Seam。

### 11.31 B7 第三十一段实现记录

本轮已完成：

1. 新增 `backend/scripts/cloudbase-job-manifest.js`，把 Adapter 到期重试、运营预警、生命周期结算队列调度、生命周期结算队列超时清理和用户生命周期定时导出五个定时 Job 的频率、HTTP Interface、命令、环境变量和安全策略集中成一个发布 Manifest Module。
2. 新增 `npm run jobs:manifest --prefix backend`，可输出 Markdown 报告或 `--json` 结构化清单，用于 CloudBase 控制台配置、发布评审和运维交接。
3. `adapter-retry` 与 `operational-alerts` 两个命令行 Adapter 默认优先读取 `ROOT_JOB_BASE_URL`，再回落到 `ROOT_CALIBRATION_BASE_URL`、`ROOT_PUBLIC_BASE_URL` 和本地端口，避免生产定时任务误绑定校准变量。
4. Manifest 校验要求 Job 显式区分 dry-run/execute、使用 `POST /api/v1/jobs/*` Interface、声明 `ROOT_JOB_BASE_URL` 与 `ROOT_ADMIN_JOB_TOKEN`，并在严格模式下要求 HTTPS base URL。
5. 后端测试已覆盖 Manifest 结构、命令、频率、环境变量和 base URL 解析；最终验收脚本已新增 CloudBase Job Manifest 检查。

本轮未完成但已保留：

1. Production Env Matrix 已在 B7 第三十二段接入；正式 CloudBase 控制台触发器创建、执行账号、密钥注入和告警渠道仍需在生产环境手工确认。
2. `ROOT_JOB_BASE_URL`、`ROOT_ADMIN_JOB_TOKEN` 和 `ROOT_ALERT_CAMPAIGN_ID` 的生产值不能写入仓库，只能进入 CloudBase 环境变量或密钥管理。
3. 真实企微/钉钉/短信通知通道仍需生产 URL、密钥、模板和外部通道重试策略。

### 11.32 B7 第三十二段实现记录

本轮已完成：

1. 新增 `backend/src/productionEnvMatrix.js`，把正式微信登录、生产数据仓库、CloudBase Job、有赞订单/客户/优惠券、物流、企业微信线索/标签和外部预警通道的环境变量集中为 Production Env Matrix Module。
2. 新增 `backend/scripts/production-env-matrix.js` 与 `npm run production-env --prefix backend`，支持 `--target production|gray`、`--json` 和 `--allow-blocked`，报告会输出每组变量的负责人、缺失项和处理动作。
3. Release Record Module 已纳入 `productionEnvMatrix` evidence，并把生产环境变量缺口合并进 `mustFixBeforeRelease` / `mustConfirmForGray`。
4. `release-calibration` 报告新增“生产环境矩阵”章节，和上线闸口、Adapter 校准、运行记录共用同一发布证据链。
5. 最终验收脚本新增 `Production env matrix` gate，覆盖 READY 矩阵、缺失变量阻塞生产、运行/数据/Job/真实 Adapter 分组。

本轮未完成但已保留：

1. 真实生产密钥、Webhook URL、CloudBase 控制台变量和有赞/企微字段映射值不能写入仓库，仍需上线时由控制台和密钥管理注入。
2. `production-env` 证明变量清单和缺失判断有效，不证明真实账号字段语义已经校准；字段语义仍由 Adapter Calibration 和真实小批量运行证明。
3. 外部预警通道仍是可选组，生产若启用企微/钉钉/短信推送，需补齐通道 URL、密钥、模板和失败重试策略。

### 11.33 B7 第三十三段实现记录

本轮已完成：

1. 新增 `backend/src/cloudbaseIdentityProbe.js`，形成 CloudBase 身份透传探针 Module，集中读取 `x-wx-openid`、`x-wx-unionid` 和 `x-root-app-code`。
2. 新增 `GET /api/v1/admin/cloudbase-identity-probe`，走后台 admin seam，只读请求头，不创建用户、不写入业务数据。
3. 探针返回 `READY`、`UNIONID_PENDING` 或 `BLOCKED`，其中缺 `unionid` 会表达为认证/应用绑定待完成，不阻塞当前 openid 登录链路。
4. 探针只返回脱敏预览，不返回原始 openid/unionid，避免把身份主键泄露到发布记录或截图里。
5. 后端 domain/API 测试和最终验收脚本已覆盖探针状态、后台口令保护、脱敏和 `cloudbase_identity_probe` smoke。

本轮未完成但已保留：

1. 微信开放平台认证和两个小程序应用绑定仍需在控制台完成；完成后用真实 CloudBase 请求复测 `x-wx-unionid`。
2. 探针证明 CloudBase header 透传，不替代 Root 会员中心有赞客户字段、订单字段和企微字段校准。
3. 生产截图或发布记录只允许保留脱敏预览和状态，不保留原始 openid/unionid。

### 11.34 B7 第三十四段实现记录

本轮已完成：

1. 新增 `admin/src/modules/release/adminReleaseApi.js`，集中读取发布记录、上线闸口和 CloudBase 身份透传探针 Interface。
2. 新增 `admin/src/modules/release/ReleaseWorkbench.vue`，在 Element Plus Admin 左侧新增“开发发布”入口，展示发布建议、上线闸口、Production Env Matrix 摘要和 CloudBase 身份探针状态。
3. `admin/src/App.vue` 已接入 `release` Module，支持 `?module=release` 直达开发发布页。
4. `admin/scripts/validate.js` 已纳入 release Module 文件、Interface 路径、探针 header、发布阻塞项、上线闸口和 `productionEnvMatrix` 字段检查。
5. 已通过 `npm run check --prefix admin`、`npm run build --prefix admin` 与项目根目录 `npm run verify`，Element Plus 构建仍只保留现有 chunk size 提醒。

本轮未完成但已保留：

1. 真实 CloudBase `unionid` 仍等待微信开放平台认证、开放平台应用创建和两个小程序绑定后实测。
2. 当时静态 `/admin` 仍是过渡入口；发布证据链已先在 Element Plus Admin 聚合，B7 第三十六段后 `/admin` 已改为 Element Plus Admin 主入口。
3. 真实发布截图只保留开发发布页中的状态和脱敏预览，不保留原始 openid/unionid。

### 11.35 B7 第三十五段实现记录

本轮已完成：

1. `backend/src/adminAccessControl.js` 新增 `capabilityListForRole`，继续让角色能力集中在 Admin Access Control Module 内，不把权限判断散落到页面。
2. 新增 `GET /api/v1/admin/me`，返回当前 `operatorId`、`role`、`tokenConfigured` 和 capabilities，作为 Element Plus Admin 菜单级权限 Interface。
3. `admin/src/App.vue` 已从静态菜单改为按 capabilities 计算可见 Module，并在顶部展示当前 operator、role 和 local 状态。
4. `admin/src/api/client.js` 新增 `fetchAdminProfile`；`admin/scripts/validate.js` 已覆盖 `/api/v1/admin/me`、capability 菜单和当前操作者展示契约。
5. 后端 API 测试已覆盖本地 admin、viewer、finance 和无效 token 的 profile 结果；运营数据测试夹具补固定参与时间，避免跨午夜后趋势日期误判。

本轮未完成但已保留：

1. 企业微信 SSO、组织架构同步和更细审批流仍待后续；当前只把已有 Admin Token 角色能力映射到前端菜单可见性。
2. 页面内部按钮级权限仍主要依赖后端 403 和现有表单限制；若后续运营角色更多，可继续把 capabilities 下沉到按钮和批量动作。
3. 静态旧后台仍保留回退，迁移收口在 B7 第三十六段改为 `/admin-legacy` 显式入口。

### 11.36 B7 第三十六段实现记录

本轮已完成：

1. `admin/vite.config.js` 已把 Element Plus Admin build base 固定为 `/admin/`，避免新后台资源与旧静态 `/assets` 路径互相覆盖。
2. `backend/src/app.js` 已把 `/admin` 接为 Element Plus Admin 主入口；当 `admin/dist/index.html` 存在时读取新后台，否则回退旧静态后台；`/admin-legacy` 保留旧后台显式回退入口。
3. `/admin/assets/*` 只从 `admin/dist/assets` 读取，旧静态资源仍走原有 `/assets/*`，让两个入口的资源 Interface 分离。
4. `backend/tests/api.test.js` 已用临时 admin dist 验证 `/admin`、`/admin/assets` 与 `/admin-legacy`，不依赖本地 build 产物。
5. `scripts/final-verification.js` 已新增 `element_plus_admin_entry` 和 `legacy_admin_fallback` smoke；`admin/scripts/validate.js` 已锁定 `/admin/` build base。

本轮未完成但已保留：

1. 旧静态后台没有删除，继续作为上线初期回退路径；彻底下线需等 Element Plus Admin 在灰度中稳定后再决策。
2. 生产部署必须携带 `admin/dist`，否则 `/admin` 会安全回退到旧后台，但这只适合应急，不代表新后台完成上线；B7 第三十七段已补 backend-only 部署准备脚本。
3. 真实有赞/企微字段、CloudBase unionid 透传和外部告警渠道仍按 B7 后续外部校准推进。

### 11.37 B7 第三十七段实现记录

本轮已完成：

1. `backend/src/app.js` 已新增 Admin dist 解析 seam：默认依次识别源码旁 `admin/dist` 与后端内置 `backend/public/admin-dist`，也可通过 `ROOT_ADMIN_DIST_DIR` 显式指定。
2. 新增 `scripts/prepare-backend-admin-dist.js`，把 Element Plus build 复制到 `backend/public/admin-dist`，让只部署 `backend/` 的云托管镜像也能服务 `/admin`。
3. 根 `package.json` 新增 `admin:build` 与 `deploy:prepare-admin`，部署前可用一条命令生成 backend 内置 Admin build。
4. `backend/tests/api.test.js` 已覆盖 bundled dist 解析、环境变量覆盖和发布准备脚本复制结果。
5. `scripts/final-verification.js` 已把根 `scripts/` 纳入 JS syntax check，并新增 `Backend admin dist bundle` 验收项。

本轮未完成但已保留：

1. `backend/public/admin-dist` 是发布准备产物，正式上线仍需在构建/部署流程中显式执行 `npm run admin:build && npm run deploy:prepare-admin`。
2. 若后续改为从项目根构建镜像，可保留同一 Admin dist seam，只需要调整 Dockerfile 的复制路径。

### 11.38 B7 第三十八段实现记录

本轮已完成：

1. 新增 `admin/src/modules/access.js`，把 Element Plus Admin 的能力判断集中为前端 Admin Access Module，提供 `has`、`any`、`disabled` 和 `reason` Interface。
2. `admin/src/App.vue` 已通过 `GET /api/v1/admin/me` 的 profile 创建 access Interface，并用 provide/inject 向各业务 Module 下沉 capabilities。
3. `ConfigWorkbench` 已按能力禁用并提示配置写入、批量结算、人工复核、奖励发放和券状态查询按钮；对应动作方法也加了前端守卫，避免直接调用时绕过页面状态。
4. `AdapterRunPage` 已把订单增量、到期重试、Adapter 重跑和回滚动作统一挂到 `CONFIG_WRITE` 能力；`OperationalAnalytics` 已把预警阈值保存和预警 Job 预览/执行挂到同一能力。
5. 后端写入型 Interface 补齐能力校验：订单补链确认、订单/物流手工同步、Adapter 重跑、外部样本导入、导入批次确认和修正应用都要求 `CONFIG_WRITE`。
6. `admin/scripts/validate.js` 与后端测试已覆盖按钮级权限 Interface、页面 gating 和 viewer 禁止重跑 Adapter 的回归。

本轮未完成但已保留：

1. 企业微信 SSO、组织架构同步和更细审批流仍待后续；当前仍使用 Admin Token 映射 viewer/finance/operator/admin capabilities。
2. 旧静态 `/admin-legacy` 只保留应急回退，不继续补完整按钮级权限；旧后台下线仍待灰度稳定后决策。
3. 真实有赞/企微字段、CloudBase unionid 透传和外部告警渠道仍按生产校准批次推进。

### 11.39 B7 第三十九段实现记录

本轮已完成：

1. `backend/src/adminLifecyclePresenter.js` 已把用户生命周期筛选扩展为后端统一口径，新增活动、任务进度、咨询状态、结算状态、奖励状态、当前卡点、严重度、待办状态和 limit 过滤。
2. 生命周期行新增 `taskProgressStatus`、`consultationStatus`、`settlementStatus`、`rewardStatus` 和 `hasOpenTasks`，前端与后续批量动作不需要重复推导状态。
3. `admin/src/modules/users/UserLifecycle.vue` 已补完整筛选条，支持多条件组合查询和一键重置；列表新增筛选状态列，方便运营确认当前命中的状态口径。
4. `admin/scripts/validate.js`、后端 domain/API 测试和 `scripts/final-verification.js` 已覆盖完整筛选契约、HTTP 过滤和最终验收 smoke。

本轮未完成但已保留：

1. 筛选结果 CSV 导出、当前列表批量结算、保存个人常用筛选、按筛选条件全量批量结算和定时导出已在后续批次接入；异步分批队列已由结算队列能力承接。
2. 旧静态 `/admin-legacy` 下线仍待 Element Plus Admin 灰度稳定后决策。
3. 真实有赞/企微字段、CloudBase unionid 透传和外部告警渠道仍按生产校准批次推进。

### 11.40 B7 第四十段实现记录

本轮已完成：

1. `backend/src/adminLifecyclePresenter.js` 新增 `buildLifecycleUsersCsv`，复用生命周期工作台筛选口径导出当前命中的用户生命周期明细。
2. `GET /api/v1/admin/lifecycle-users/export` 已接入后台 HTTP Interface，返回 `text/csv`，字段覆盖身份、UnionID、openid、活动、任务进度、咨询、结算、奖励、卡点、待办和最新生命周期事件。
3. `admin/src/modules/users/adminLifecycleApi.js` 与 `UserLifecycle.vue` 新增筛选结果 CSV 下载，导出的查询条件与页面筛选对象保持一致。
4. Admin 自检、后端 Domain/API 测试和最终验收脚本已覆盖生命周期导出 Interface 与 CSV 内容。

本轮未完成但已保留：

1. CSV 字段级脱敏已在 B7 第五十二段接入，导出下载审批已在 B7 第五十三段接入；当前按受 Admin Token 保护的可见字段导出，定时导出记录已提供默认 7 天留存。
2. 保存个人常用筛选、按筛选条件全量批量结算入口和定时导出已在后续批次接入；异步分批执行和失败重试已由生命周期结算队列承接。
3. 旧静态 `/admin-legacy` 下线仍待 Element Plus Admin 灰度稳定后决策。
4. 真实有赞/企微字段、CloudBase unionid 透传和外部告警渠道仍按生产校准批次推进。

### 11.41 B7 第四十一段实现记录

本轮已完成：

1. `admin/src/modules/users/adminLifecycleApi.js` 新增生命周期页可复用的批量结算 Adapter，直接调用既有 `POST /api/v1/admin/settlement/batch-preview` 与 `POST /api/v1/admin/settlement/batch-execute`。
2. `admin/src/modules/users/UserLifecycle.vue` 新增当前列表批量结算入口，展示当前列表人数、总命中人数、可结算人数，并支持活动 ID、`request_id`、二次确认、预览结果抽屉和确认执行。
3. 页面执行按钮复用 Admin Access Module 的 `SETTLEMENT_EXECUTE` capability；真正写入仍由后端批量结算 Interface 校验权限、幂等和审计。
4. Admin 自检已覆盖生命周期页批量结算入口，最终验收继续覆盖后端批量结算 smoke。

本轮未完成但已保留：

1. 当前列表批量结算入口仍作用于生命周期页当前列表，按筛选条件全量选人和同步批量结算已在 B7 第四十三段接入；后台异步分批执行、失败重试和进度页已由后续生命周期结算队列承接。
2. 保存个人常用筛选和定时导出已在后续批次接入；CSV 默认字段脱敏已在 B7 第五十二段接入，下载审批已在 B7 第五十三段接入。
3. 旧静态 `/admin-legacy` 下线仍待 Element Plus Admin 灰度稳定后决策。
4. 真实有赞/企微字段、CloudBase unionid 透传和外部告警渠道仍按生产校准批次推进。

### 11.42 B7 第四十二段实现记录

本轮已完成：

1. 新增 `backend/src/adminLifecycleFilterPresets.js`，提供用户生命周期常用筛选的归一化、保存、列表和归档能力；只保存白名单筛选字段，并按 Admin 操作人隔离。
2. 新增后台 HTTP Interface：`GET /api/v1/admin/lifecycle-filter-presets`、`POST /api/v1/admin/lifecycle-filter-presets/upsert`、`POST /api/v1/admin/lifecycle-filter-presets/delete`。
3. Domain 层已为保存/删除写入 `ADMIN_LIFECYCLE_FILTER_PRESET_UPSERT` 与 `ADMIN_LIFECYCLE_FILTER_PRESET_DELETE` 审计；写入支持 `request_id` 幂等。
4. Element Plus 用户生命周期页新增常用筛选下拉、筛选名称、保存筛选、删除筛选和一键套用，运营可复用常见活动/任务/结算/奖励组合。
5. Store 默认数据、快照校验和 `schema.sql` 已补 `adminLifecycleFilterPresets` / `admin_lifecycle_filter_preset`，Admin 自检、Domain/API 测试和最终验收 smoke 已覆盖。

本轮未完成但已保留：

1. 当前常用筛选按 Admin 操作人私有保存；团队共享筛选和排序置顶已在 B7 第四十九段接入，复制筛选已在 B7 第五十一段接入。
2. 按筛选条件全量批量结算入口已在 B7 第四十三段接入；后台异步分批执行和失败重试已由生命周期结算队列承接，定时导出已在 B7 第五十段接入，CSV 字段治理仍待后续批次。
3. 旧静态 `/admin-legacy` 下线仍待 Element Plus Admin 灰度稳定后决策。
4. 真实有赞/企微字段、CloudBase unionid 透传和外部告警渠道仍按生产校准批次推进。

### 11.43 B7 第四十三段实现记录

本轮已完成：

1. `backend/src/adminLifecyclePresenter.js` 已把生命周期筛选与排序沉为内部 Implementation，并新增 `buildLifecycleBatchSelection`；列表 `limit` 只影响页面展示，筛选批量结算使用独立 `selectionLimit`。
2. Domain 层新增 `previewAdminLifecycleSettlementBatch` 与 `executeAdminLifecycleSettlementBatch`，先按生命周期筛选选出 `rootUserIds`，再复用既有批量结算 Module 完成预览、二次确认、幂等、审计、结算记录和奖励生成。
3. 后台 HTTP Interface 新增 `POST /api/v1/admin/lifecycle-users/settlement-batch-preview` 与 `POST /api/v1/admin/lifecycle-users/settlement-batch-execute`；执行仍要求 `SETTLEMENT_EXECUTE` capability 和 `request_id`。
4. Element Plus 用户生命周期页新增 `筛选全量上限`、`筛选预览` 和 `筛选执行`，并将原按钮区分为 `当前列表预览/执行`，结果抽屉展示来源、筛选命中数、选入人数和截断状态。
5. Admin 自检、Domain/API 测试和最终验收脚本已覆盖筛选批量结算 Interface；测试用 `limit: 1` 证明筛选全量选人不受页面列表分页限制。

本轮未完成但已保留：

1. 同步批量结算入口适合 20 左右并发和小批量运营处理；手动分批队列、失败重试、进度页、后台取消动作、CloudBase/cron 自动调度、异常预警和超时清理已在 B7 第四十四到四十八段接入。
2. CSV 默认字段脱敏已在 B7 第五十二段接入；定时导出、留存期限和下载审计已在 B7 第五十段接入，导出下载审批已在 B7 第五十三段接入。
3. 旧静态 `/admin-legacy` 下线仍待 Element Plus Admin 灰度稳定后决策。
4. 真实有赞/企微字段、CloudBase unionid 透传和外部告警渠道仍按生产校准批次推进。

### 11.44 B7 第四十四段实现记录

本轮已完成：

1. 新增 `backend/src/adminLifecycleSettlementJobs.js`，提供生命周期筛选结算队列 Module；创建队列时冻结筛选快照、命中用户、`selectionLimit` 和每批数量，执行时复用既有批量结算 Module。
2. Store 默认数据、快照校验和 `schema.sql` 已补 `adminLifecycleSettlementJobs` / `admin_lifecycle_settlement_job`，队列状态、筛选、选人、进度、失败项、运行摘要都可持久化。
3. 后台 HTTP Interface 新增 `GET /api/v1/admin/lifecycle-settlement-jobs`、`POST /create`、`POST /run`、`POST /cancel`、`POST /retry-failed`；写入动作均要求 `SETTLEMENT_EXECUTE` capability 和 `request_id`。
4. Element Plus 用户生命周期页新增 `每批` 控制、`创建队列`、`查看队列` 和队列抽屉；运营可查看队列状态、进度、执行/失败/奖励数量，并执行下一批、重试失败项或取消队列。
5. 队列动作写入 `ADMIN_LIFECYCLE_SETTLEMENT_JOB_CREATE/RUN/CANCEL/RETRY_FAILED` 审计；每批真正结算仍由 `BATCH_SETTLEMENT_EXECUTE` 审计保留原始执行证据。
6. Domain/API 测试、Admin 自检和最终验收脚本已覆盖队列创建、分批执行、列表、取消、失败重试和 `lifecycle_settlement_jobs` smoke。

本轮未完成但已保留：

1. 当前队列支持运营手动执行下一批；CloudBase/cron 自动调度已在 B7 第四十五段接入，失败项和长时间未推进的站内预警已在 B7 第四十六段接入，队列超时清理已在 B7 第四十八段接入。
2. CSV 默认字段脱敏已在 B7 第五十二段接入；定时导出、留存期限和下载审计已在 B7 第五十段接入，导出下载审批已在 B7 第五十三段接入。
3. 旧静态 `/admin-legacy` 下线仍待 Element Plus Admin 灰度稳定后决策。
4. 真实有赞/企微字段、CloudBase unionid 透传和外部告警渠道仍按生产校准批次推进。

### 11.45 B7 第四十五段实现记录

本轮已完成：

1. 新增 `backend/src/adminLifecycleSettlementScheduler.js`，提供生命周期结算队列自动调度 Module；调度只推进已创建且仍有待处理用户的队列，不自动创建新队列。
2. 后台新增 `POST /api/v1/jobs/lifecycle-settlement-due` Job Interface，执行模式要求 `SETTLEMENT_EXECUTE` capability 与稳定 `request_id`，并复用队列执行、结算审计和幂等路径。
3. 新增 `backend/scripts/lifecycle-settlement-scheduler.js` 与 `npm run lifecycle-settlement --prefix backend`，支持 CloudBase/cron dry-run、execute、`batchSize`、`jobLimit`、活动筛选和报告退出码。
4. CloudBase Job 发布 Manifest 增加 `lifecycle_settlement_due`，默认每 15 分钟执行一次、每队列每批 20 人、每轮最多 3 个队列；Production Env Matrix 增加可选 `ROOT_LIFECYCLE_SETTLEMENT_CAMPAIGN_ID`。
5. Element Plus 用户生命周期页队列抽屉新增调度预览与调度执行入口，运营可在页面里看到候选、执行、成功和失败数量。
6. Domain/API 测试、Admin 自检和最终验收脚本已覆盖自动调度 Module、HTTP Job、命令行 Runner、CloudBase Manifest 和 `lifecycle_settlement_scheduler` smoke。

本轮未完成但已保留：

1. 真实 CloudBase 控制台触发器创建、`ROOT_JOB_BASE_URL`、`ROOT_ADMIN_JOB_TOKEN` 注入和执行告警仍需在生产环境配置。
2. 外部预警 Webhook Adapter 已在 B7 第四十七段接入，队列超时清理已在 B7 第四十八段接入，团队共享筛选和排序置顶已在 B7 第四十九段接入，定时导出已在 B7 第五十段接入。
3. 真实有赞/企微字段、CloudBase unionid 透传和外部告警渠道仍按生产校准批次推进。

### 11.46 B7 第四十六段实现记录

本轮已完成：

1. Operational Alerts Module 新增 `LIFECYCLE_SETTLEMENT_JOB_FAILED` 与 `LIFECYCLE_SETTLEMENT_JOB_STALLED` 目标类型，复用既有规则、冷却、通知落账和 Job Interface。
2. 默认规则新增 `op_alert_lifecycle_settlement_job_failed` 与 `op_alert_lifecycle_settlement_job_stalled`；失败队列按 `failedCount` 触发，长时间未推进队列按 `ageMinutes >= 60` 触发。
3. 预警 payload 保留 `lifecycleJobId`、`lifecycleJobStatus`、`failedCount`、`pendingCount`、`ageMinutes` 与错误说明，便于从运营数据页回到用户生命周期队列抽屉处理。
4. Element Plus 运营数据页目标类型下拉已支持结算队列失败和结算队列卡住，运营可保存覆盖规则、负责人和路由 Key。
5. Domain/API 测试、Admin 自检和最终验收脚本已覆盖默认规则、analytics payload、运营预警 Job 通知落账和 `operational_alerts` smoke。

本轮未完成但已保留：

1. 外部推送生产化 Webhook Adapter 已在 B7 第四十七段接入；真实企微/钉钉/短信 URL、密钥、模板和负责人仍需在生产环境注入并验收。
2. 队列超时清理已在 B7 第四十八段接入，默认只重置卡住的 `RUNNING` 队列并记录老化的 `QUEUED` 队列；自动取消必须显式开启，避免误取消运营刻意暂停的队列。
3. 团队共享筛选和排序置顶已在 B7 第四十九段接入，定时导出已在 B7 第五十段接入。

### 11.47 B7 第四十七段实现记录

本轮已完成：

1. 新增 `backend/src/operationalAlertWebhookAdapter.js`，把外部预警推送从 Operational Alerts 主 Module 中抽成独立 Adapter，统一处理生产默认 URL、规则级 URL、通道、模板、超时和签名。
2. `WEBHOOK` 渠道支持 `ROOT_OPERATIONAL_ALERT_WEBHOOK_URL`、`ROOT_OPERATIONAL_ALERT_WEBHOOK_SECRET`、`ROOT_OPERATIONAL_ALERT_WEBHOOK_CHANNEL`、`ROOT_OPERATIONAL_ALERT_WEBHOOK_TEMPLATE` 和 `ROOT_OPERATIONAL_ALERT_WEBHOOK_TIMEOUT_MS`，规则单独填写 `webhookUrl` 时可覆盖默认 URL。
3. Webhook payload 保留 `alert`、`rule`、负责人路由、`requestId`、通道和模板；配置密钥时写入 `X-Root-Alert-Signature` HMAC-SHA256 签名。
4. 预警通知落账新增外部回执与错误排查字段，Element Plus 运营数据页的通知记录表展示外部回执和错误。
5. 命令行 `operational-alerts` 报告展示外部回执和失败原因；Production Env Matrix 已把外部通道 URL、密钥、通道、模板和超时归到同一组。
6. Domain/API 测试、Admin 自检和最终验收脚本已覆盖默认环境 URL、规则级 URL、签名、成功发送、HTTP 失败落账和命令行失败退出码。

本轮未完成但已保留：

1. 真实企微/钉钉/短信机器人 URL、签名密钥、模板内容和负责人名单仍需在生产 CloudBase/密钥管理中注入，仓库不保存真实密钥。
2. 外部通道失败后的多次重试、死信队列、通道健康页和健康预警已分别在 B7 第六十段、第六十一段与第六十二段接入；真实通道 URL、密钥、模板和负责人名单仍需生产注入。
3. 队列超时清理已在 B7 第四十八段接入，团队共享筛选和排序置顶已在 B7 第四十九段接入，定时导出已在 B7 第五十段接入。

### 11.48 B7 第四十八段实现记录

本轮已完成：

1. 新增 `backend/src/adminLifecycleSettlementCleanup.js`，提供生命周期结算队列超时清理 Module；清理 Interface 先生成候选计划，再按 dry-run/execute 执行，便于运营预览和审计。
2. 清理策略保持保守：默认 `staleMinutes=120`，长时间卡在 `RUNNING` 的队列重置为 `QUEUED` 交给调度器继续推进；老化的 `QUEUED` 队列默认只记录检查，不自动取消。
3. 自动取消必须显式传入 `allowCancel=true` 或配置 `ROOT_LIFECYCLE_SETTLEMENT_ALLOW_CANCEL=true`，且超过 `cancelAfterMinutes` 才会把队列置为 `CANCELLED`。
4. 新增 `POST /api/v1/jobs/lifecycle-settlement-cleanup` Job Interface，执行模式要求 `SETTLEMENT_EXECUTE` capability 与稳定 `request_id`，所有清理动作写入 `ADMIN_LIFECYCLE_SETTLEMENT_JOB_TIMEOUT_CLEANUP` 审计。
5. 新增 `backend/scripts/lifecycle-settlement-cleanup.js` 与 `npm run lifecycle-settlement-cleanup --prefix backend`，支持 CloudBase/cron dry-run、execute、活动筛选、状态筛选、超时阈值、取消阈值、候选上限和报告退出码。
6. CloudBase Job 发布 Manifest 增加 `lifecycle_settlement_cleanup`，默认每小时执行一次；Production Env Matrix 增加超时分钟、取消分钟和允许取消开关变量。
7. Element Plus 用户生命周期队列抽屉新增清理预览与超时清理入口，队列详情展示最近清理动作与说明。
8. Domain/API 测试、Admin 自检和最终验收脚本已覆盖清理计划、执行、环境变量默认值、HTTP Job、命令行 Runner、CloudBase Manifest 和 `lifecycle_settlement_cleanup` smoke。

本轮未完成但已保留：

1. 真实 CloudBase 控制台触发器创建、`ROOT_JOB_BASE_URL`、`ROOT_ADMIN_JOB_TOKEN` 和清理阈值变量注入仍需在生产环境配置。
2. 团队共享筛选和排序置顶已在 B7 第四十九段接入，用户生命周期定时导出已在 B7 第五十段接入；导出交付失败重试/死信机制已在 B7 第六十段接入，通道健康聚合已在 B7 第六十一段接入，导出交付健康预警已在 B7 第六十二段接入。
3. 真实有赞/企微字段、CloudBase unionid 透传、Root 会员中心 appId 和外部告警渠道仍按生产校准批次推进。

### 11.49 B7 第四十九段实现记录

本轮已完成：

1. `backend/src/adminLifecycleFilterPresets.js` 扩展常用筛选数据模型，新增 `scope`、`pinned`、`sortOrder` 和 `canModify`，保持白名单筛选字段归一化不变。
2. 常用筛选列表现在同时返回当前操作人的个人筛选与所有团队筛选，并按置顶、排序值、更新时间和标题排序，形成运营团队共享筛选列表。
3. 团队筛选只允许创建者修改或删除；其他操作人可以套用但不能覆盖，避免没有企业微信 SSO 时误改团队模板。
4. `admin_lifecycle_filter_preset` schema 新增 `scope`、`pinned` 和 `sort_order`，旧数据默认按个人、未置顶、排序 100 兼容。
5. Element Plus 用户生命周期页新增团队共享、置顶、排序控件，下拉项显示团队/置顶标记，选中他人团队筛选时禁止保存覆盖和删除。
6. Domain/API 测试、Admin 自检和最终验收脚本已覆盖团队共享、置顶排序、跨操作人可见、非创建者只读保护和 `lifecycle_filter_presets` smoke。

本轮未完成但已保留：

1. CSV 默认字段脱敏已在 B7 第五十二段接入；定时导出、CSV 留存期限和下载审计已在 B7 第五十段接入，复制筛选已在 B7 第五十一段接入，导出下载审批已在 B7 第五十三段接入。
2. 企业微信 SSO、组织架构同步和更细审批流仍待后续；当前团队筛选基于已有 Admin Token 的 `operatorId` 作为创建者证据。
3. 真实有赞/企微字段、CloudBase unionid 透传、正式 CloudBase 控制台触发器和外部告警渠道仍按生产校准批次推进。

### 11.50 B7 第五十段实现记录

本轮已完成：

1. 新增 `backend/src/adminLifecycleUserExports.js`，把用户生命周期导出计划、CSV 生成、导出记录、下载次数、保留期、过期清理和审计集中在一个 Module。
2. 新增 Store/seed/schema 数据结构 `adminLifecycleUserExports` 与 `admin_lifecycle_user_export`，导出记录保留筛选快照、摘要、文件名、下载次数、创建时间和过期时间。
3. 新增 `GET /api/v1/admin/lifecycle-user-exports`、`POST /api/v1/admin/lifecycle-user-exports/create` 和下载 Interface，Element Plus 用户生命周期页可生成当前筛选导出记录、查看记录和下载 CSV。
4. 新增 `POST /api/v1/jobs/lifecycle-users-export` Job Interface，execute 模式要求稳定 `request_id`，复用同一导出 Module 并写入 `ADMIN_LIFECYCLE_USER_EXPORT_RUN` 与下载审计。
5. 新增 `backend/scripts/lifecycle-users-export.js` 与 `npm run lifecycle-users-export --prefix backend`，支持 CloudBase/cron dry-run、execute、活动筛选、状态筛选、导出上限、保留天数和报告退出码。
6. CloudBase Job 发布 Manifest 增加 `lifecycle_users_export`，默认每天 09:30 生成一次生命周期 CSV；Production Env Matrix 增加 `ROOT_LIFECYCLE_EXPORT_CAMPAIGN_ID`、`ROOT_LIFECYCLE_EXPORT_LIMIT` 和 `ROOT_LIFECYCLE_EXPORT_RETENTION_DAYS`。
7. Domain/API 测试、Admin 自检、最终验收脚本和 Admin build 已覆盖定时导出记录、下载次数、过期清理、HTTP Job、命令行 Runner、CloudBase Manifest 和 `lifecycle_scheduled_export` smoke。

本轮未完成但已保留：

1. 真实 CloudBase 控制台触发器创建、`ROOT_JOB_BASE_URL`、`ROOT_ADMIN_JOB_TOKEN`、导出活动口径和执行历史仍需在生产环境配置。
2. 当前导出文件先存放在后台数据仓库记录中；默认字段脱敏策略已在 B7 第五十二段接入，导出下载审批已在 B7 第五十三段接入，对象存储文件 Adapter、签名下载和 Webhook 投递承接已在 B7 第五十五段、第五十八段、第五十九段接入；真实 COS/S3 SDK、真实邮件/企微平台 URL/模板仍待真实角色与合规口径确认后接入新的 Adapter。
3. 真实有赞/企微字段、CloudBase unionid 透传、Root 会员中心 appId 和外部告警渠道仍按生产校准批次推进。

### 11.51 B7 第五十一段实现记录

本轮已完成：

1. `backend/src/adminLifecycleFilterPresets.js` 新增复制能力，允许操作人复制自己的常用筛选或团队筛选；不可复制其他操作人的个人筛选。
2. 复制默认生成个人副本，标题追加“副本”，保留来源筛选条件，默认不置顶、排序 100，避免误改团队模板。
3. Domain 层新增 `copyAdminLifecycleFilterPreset`，写入 `ADMIN_LIFECYCLE_FILTER_PRESET_COPY` 审计，并记录来源 preset、目标 preset、`request_id` 和目标 scope。
4. 后台 HTTP Interface 新增 `POST /api/v1/admin/lifecycle-filter-presets/copy`，复用 Admin Token 操作人和 request_id 幂等。
5. Element Plus 用户生命周期页新增“复制筛选”按钮，可把只读团队模板复制成自己的个人筛选后继续修改保存。
6. Domain/API 测试、Admin 自检和最终验收脚本已覆盖复制团队筛选、禁止复制他人个人筛选、审计记录和 `lifecycle_filter_presets` smoke。

本轮未完成但已保留：

1. 企业微信 SSO、组织架构同步和更细审批流仍待后续；当前复制权限仍基于 Admin Token 的 `operatorId` 与团队筛选 scope。
2. CSV 默认字段脱敏已在 B7 第五十二段接入，导出下载审批已在 B7 第五十三段接入，导出外部交付 Interface 已在 B7 第五十四段接入，本地文件对象存储 Adapter 已在 B7 第五十五段接入，Webhook 签名下载投递增强已在 B7 第五十九段接入；真实 COS/S3 SDK Adapter、真实邮件/企微平台 URL/模板和真实 CloudBase 控制台触发器仍按生产校准批次推进。

### 11.52 B7 第五十二段实现记录

本轮已完成：

1. 新增 `backend/src/adminLifecycleExportPolicy.js`，把用户生命周期导出的字段敏感度策略收口为独立 Module。
2. 生命周期 CSV 默认使用 `MASKED` 策略，遮盖 `phone`、`verified_phone`、`unionid` 和 `openid_list`，保留 `root_user_id`、任务、咨询、结算、奖励和卡点等运营分析字段。
3. `RAW` 原文字段必须显式请求，且仅 admin 角色或本地未配置口令的开发态可用；operator/finance/viewer 请求 `RAW` 会自动降级为 `MASKED`。
4. 即时 CSV 导出、定时导出记录、CloudBase/cron Job 和下载记录复用同一个导出策略 Interface，导出摘要和审计 metadata 记录实际策略、请求策略、是否降级和敏感字段列表。
5. `npm run lifecycle-users-export --prefix backend` 新增 `--sensitivity` 参数，CloudBase Job Manifest 与 Production Env Matrix 新增 `ROOT_LIFECYCLE_EXPORT_SENSITIVITY`，默认值为 `MASKED`。
6. Element Plus 用户生命周期导出记录抽屉展示字段策略，Admin 自检、Domain/API 测试和最终验收脚本已覆盖默认脱敏、admin 显式原文、operator 降级和 `lifecycle_scheduled_export` smoke。

本轮未完成但已保留：

1. 下载审批流已在 B7 第五十三段接入；对象存储文件 Adapter、签名下载和 Webhook 投递承接已在 B7 第五十五段、第五十八段、第五十九段接入，真实 COS/S3 SDK、真实邮件/企微平台 URL/模板和字段级审批策略仍待真实角色、合规口径和生产投递通道确认后接入新的 Adapter。
2. 企业微信 SSO、组织架构同步、更细角色矩阵、真实 CloudBase 控制台触发器和执行历史仍按生产校准批次推进。

### 11.53 B7 第五十三段实现记录

本轮已完成：

1. `backend/src/adminLifecycleUserExports.js` 新增导出下载审批状态，支持 `NOT_REQUIRED`、`PENDING`、`APPROVED`、`REJECTED`。
2. `MASKED` 导出默认无需审批；`RAW` 或显式 `approvalRequired` 的导出记录会进入 `PENDING`，审批通过前下载 Interface 会拒绝返回 CSV。
3. 新增后台审批 HTTP Interface：`POST /api/v1/admin/lifecycle-user-exports/review`，要求 `DATA_EXPORT_APPROVE` capability，并支持 `request_id` 幂等。
4. Admin Access Control 新增 `DATA_EXPORT_APPROVE` 能力，默认授予 admin 和 finance；operator 可创建默认脱敏导出，但不能审批高风险下载。
5. 审批动作写入 `ADMIN_LIFECYCLE_USER_EXPORT_APPROVAL` 审计，记录审批人、审批 request_id、审批状态和导出字段策略。
6. Element Plus 用户生命周期导出记录抽屉新增审批状态、审批通过/拒绝动作和下载前置禁用提示。
7. `npm run lifecycle-users-export --prefix backend` 新增 `--approval-required` / `--no-approval-required`，CloudBase Job Manifest 与 Production Env Matrix 新增 `ROOT_LIFECYCLE_EXPORT_APPROVAL_REQUIRED`。
8. Domain/API 测试、Admin 自检和最终验收脚本已覆盖审批前禁止下载、finance 审批、operator 拦截、审批后下载和 `lifecycle_export_approval` smoke。

本轮未完成但已保留：

1. 外部交付 Interface 已在 B7 第五十四段接入，Webhook 投递 payload 与签名下载已在 B7 第五十九段接入；真实对象存储 SDK、真实邮件/企微平台 URL/模板、审批通知和更细字段级审批策略仍待真实角色、合规口径和生产投递通道确认后接入新的 Adapter。
2. 企业微信 SSO、组织架构同步、更细角色矩阵、真实 CloudBase 控制台触发器和执行历史仍按生产校准批次推进。

### 11.54 B7 第五十四段实现记录

本轮已完成：

1. 新增 `backend/src/adminLifecycleExportDelivery.js`，把用户生命周期导出的交付通道收口为独立 Module，支持 `NONE`、`INTERNAL_LINK`、`WEBHOOK` 和 `OBJECT_STORAGE` 通道口径。
2. `backend/src/adminLifecycleUserExports.js` 已为导出记录新增交付状态、交付目标、外部引用、错误、交付时间、交付 request_id 和尝试次数；默认导出不外发。
3. 新增后台交付 HTTP Interface：`POST /api/v1/admin/lifecycle-user-exports/deliver`，要求 `DATA_EXPORT_APPROVE` capability 与稳定 `request_id`。
4. 交付动作不会绕过审批：`RAW` 或显式需要审批的导出记录在 `APPROVED` 前会拒绝外部交付，审批通过后交付状态从 `PENDING_APPROVAL` 进入 `READY`。
5. Element Plus 用户生命周期导出记录抽屉新增交付状态和“交付”动作，当前默认生成内部下载链接交付记录，真实外部通道后续复用同一 Interface。
6. 命令行 Runner、CloudBase Job Manifest 和 Production Env Matrix 已新增 `ROOT_LIFECYCLE_EXPORT_DELIVERY_*`、`ROOT_LIFECYCLE_EXPORT_OBJECT_*` 变量口径，默认 `deliveryEnabled=false`。
7. Domain/API 测试、Admin 自检和最终验收脚本已覆盖默认不交付、operator 拦截、finance 交付、审批前拒绝交付、审批后交付和 `lifecycle_export_delivery` smoke。

本轮未完成但已保留：

1. 对象存储本地文件 Adapter 已在 B7 第五十五段接入，真实 COS/S3 上传 Adapter 仍需生产 bucket、权限和 SDK 方案确认。
2. Webhook 投递 payload 与签名下载已在 B7 第五十九段接入；真实邮件/企微平台 URL、模板、审批通知、字段级审批策略、企业微信 SSO、组织架构同步和真实 CloudBase 控制台触发器仍按生产校准批次推进。

### 11.55 B7 第五十五段实现记录

本轮已完成：

1. `backend/src/adminLifecycleExportDelivery.js` 将 `OBJECT_STORAGE` 从占位推进为可替换 Adapter seam，外部 Adapter 只需实现 `putObject({ objectKey, body, contentType, metadata })`。
2. 新增本地文件对象存储 Adapter：配置 `ROOT_LIFECYCLE_EXPORT_OBJECT_DIR` 或请求 `objectDir` 后，交付会把 CSV 写入对象目录，并同步写入 `.metadata.json`。
3. 对象 key 统一由 `objectPrefix/exportId/filename` 生成，并做路径片段清洗，避免对象 key 逃逸配置目录。
4. `OBJECT_STORAGE` 交付成功后记录 `DELIVERED`、`externalRef`、`objectKey` 和 Adapter 类型；未配置对象目录或自定义 Adapter 时保持 `SKIPPED`，不会误报成功。
5. 命令行 Runner、CloudBase Job Manifest、Production Env Matrix 和最终验收脚本已新增 `ROOT_LIFECYCLE_EXPORT_OBJECT_DIR`。
6. Domain/API 测试和最终验收脚本已覆盖本地对象目录写入、CSV 内容回读、metadata 记录和 HTTP 交付 smoke。

本轮未完成但已保留：

1. 后台导出签名下载链接已在 B7 第五十八段接入；真实 COS/S3/CloudBase 对象存储 SDK Adapter、对象存储原生签名 URL 和对象生命周期策略仍需生产 bucket、权限和密钥方案确认；过期导出对象清理已在 B7 第五十六段接入本地对象目录 Adapter。
2. Webhook 投递 payload 与签名下载已在 B7 第五十九段接入；真实邮件/企微平台 URL、模板、审批通知、字段级审批策略、企业微信 SSO、组织架构同步和真实 CloudBase 控制台触发器仍按生产校准批次推进。

### 11.56 B7 第五十六段实现记录

本轮已完成：

1. `backend/src/adminLifecycleExportDelivery.js` 为对象存储 Adapter seam 补齐 `deleteObject({ objectKey })`，本地文件 Adapter 会同步删除 CSV 与 `.metadata.json`。
2. `backend/src/adminLifecycleUserExports.js` 新增用户生命周期导出过期清理 Module 行为，支持 dry-run 候选、execute 清理、对象删除失败保留记录、清理审计和可重跑结果。
3. 新增 `POST /api/v1/jobs/lifecycle-user-exports-cleanup` Job Interface，执行模式要求 `DATA_EXPORT_APPROVE` capability 与稳定 `request_id`。
4. 新增 `backend/scripts/lifecycle-user-exports-cleanup.js` 与 `npm run lifecycle-user-exports-cleanup --prefix backend`，支持 dry-run、execute、候选上限、对象目录、对象清理开关、指定 now 和报告退出码。
5. CloudBase Job 发布 Manifest 增加 `lifecycle_user_exports_cleanup`，Production Env Matrix 增加 `ROOT_LIFECYCLE_EXPORT_CLEANUP_LIMIT` 与 `ROOT_LIFECYCLE_EXPORT_OBJECT_CLEANUP_ENABLED`。
6. 列表、下载、审批和交付 Interface 对已过期对象导出保持“隐藏/拒绝访问但保留记录待清理”的口径，避免自动剪枝造成对象文件孤儿。
7. Domain/API 测试和最终验收脚本已覆盖过期对象导出 dry-run、权限拦截、缺 request_id 拦截、对象文件删除、metadata 删除、记录移除、审计和 `lifecycle_export_cleanup` smoke。

本轮未完成但已保留：

1. 后台导出签名下载链接已在 B7 第五十八段接入；真实 COS/S3/CloudBase 对象存储 SDK Adapter、对象存储原生签名 URL、对象存储生命周期规则和生产 bucket 权限仍需真实云环境确认。
2. Webhook 投递 payload 与签名下载已在 B7 第五十九段接入；真实邮件/企微平台 URL、模板、审批通知、字段级审批策略、企业微信 SSO、组织架构同步、正式 CloudBase 控制台触发器和执行历史仍按生产校准批次推进。

### 11.57 B7 第五十七段实现记录

本轮已完成：

1. Element Plus 用户生命周期导出记录抽屉新增“过期清理预览”和“过期清理”入口，复用 B7 第五十六段的后端清理 Job Interface。
2. 新增前端 `runLifecycleUserExportsCleanup` API Adapter，统一调用 `POST /api/v1/jobs/lifecycle-user-exports-cleanup`，执行模式带稳定 `request_id`。
3. 清理入口按 `DATA_EXPORT_APPROVE` capability 禁用并展示权限提示，避免 operator 误触导出文件清理。
4. 页面展示最近清理结果摘要：候选数、移除记录、删除对象、跳过对象和对象失败数，便于运营先 dry-run 再执行。
5. 最终验收脚本已校验构建后的 Element Plus Admin 入口包含导出过期清理 endpoint 与入口文案，防止后端 Job 可用但页面漏入口。

本轮未完成但已保留：

1. 真实 COS/S3/CloudBase 对象存储删除 Adapter、对象存储原生签名 URL、对象生命周期规则和生产触发器仍待真实云环境确认。
2. 更细的清理历史列表、失败项单独重跑、对象存储凭证轮换提示和外部审批通知仍可作为后续运营增强。

### 11.58 B7 第五十八段实现记录

本轮已完成：

1. 用户生命周期导出交付新增签名下载链接能力，`INTERNAL_LINK` 交付可按请求或环境变量生成 `/api/v1/lifecycle-user-exports/:exportId/signed-download`。
2. 新增 `ROOT_LIFECYCLE_EXPORT_DOWNLOAD_SECRET`、`ROOT_LIFECYCLE_EXPORT_SIGNED_DOWNLOAD_ENABLED` 和 `ROOT_LIFECYCLE_EXPORT_SIGNED_DOWNLOAD_TTL_SECONDS`，签名链接默认 24 小时，可配置且限制在 60 秒到 7 天。
3. 签名下载复用导出审批、过期保留和下载审计 Interface，坏签名、过期签名和缺密钥分别返回可解释错误，不走后台 admin 下载路径。
4. CloudBase Job Manifest 与 Production Env Matrix 已纳入签名下载变量，便于生产密钥管理和发布记录检查。
5. Domain/API 测试和最终验收脚本已覆盖签名链接生成、无后台 token 下载、MASKED 字段策略、坏签名拒绝和 `lifecycle_export_signed_download` smoke。

本轮未完成但已保留：

1. 真实 COS/S3/CloudBase 对象存储 SDK Adapter、对象存储原生签名 URL、对象生命周期规则和生产 bucket 权限仍需真实云环境确认。
2. Webhook 投递 payload 与签名下载已在 B7 第五十九段接入；真实邮件/企微平台 URL、模板、审批通知、字段级审批策略、企业微信 SSO、组织架构同步、正式 CloudBase 控制台触发器和执行历史仍按生产校准批次推进。

### 11.59 B7 第五十九段实现记录

本轮已完成：

1. `WEBHOOK` 交付 payload 新增 `signedDownloadUrl`、`signedDownloadPath` 和 `signedDownloadExpiresAt`，可直接给邮件/企微投递 Adapter 使用，不暴露后台 admin 下载路径。
2. Webhook 请求头新增导出 ID、`request_id`、通道、模板、签名下载标记与 HMAC 签名，方便外部投递平台做幂等、路由和验签。
3. 交付结果记录 `webhookStatusCode`、`webhookSigned`、`webhookResponsePreview` 和 `signedDownloadUrlPreview`；预览会去掉 query，避免泄露 signature。
4. Production Env Matrix 与 CloudBase Job Manifest 新增 `ROOT_LIFECYCLE_EXPORT_DELIVERY_WEBHOOK_CHANNEL`、`ROOT_LIFECYCLE_EXPORT_DELIVERY_WEBHOOK_TEMPLATE`、`ROOT_LIFECYCLE_EXPORT_DELIVERY_TIMEOUT_MS`。
5. Domain/API 测试和最终验收脚本覆盖 Webhook 202、签名头、signed download payload、响应摘要和 `lifecycle_export_webhook_delivery` smoke。

本轮未完成但已保留：

1. 真实邮件/企微 URL、模板内容、负责人名单和真实 CloudBase 执行历史仍需生产环境注入和验收；失败重试/死信机制已在 B7 第六十段接入。
2. 真实 COS/S3/CloudBase SDK Adapter、对象存储原生签名 URL、企业微信 SSO/组织架构仍待后续。

### 11.60 B7 第六十段实现记录

本轮已完成：

1. 用户生命周期导出交付记录新增 `RETRY_SCHEDULED` 与 `DEAD_LETTER` 状态，并记录 last attempt、next retry、max attempts 和 dead letter reason。
2. `POST /api/v1/jobs/lifecycle-user-exports-delivery-retry` 新增到期交付重试 Job Interface，支持 dry-run 预览、execute 执行、稳定 `request_id`、批量上限和最大尝试次数。
3. 新增 `npm run lifecycle-user-exports-delivery-retry --prefix backend` 命令行 Runner，供 CloudBase/cron 调用同一 Interface。
4. CloudBase Job Manifest 与 Production Env Matrix 新增 `ROOT_LIFECYCLE_EXPORT_DELIVERY_RETRY_BATCH_SIZE`、`ROOT_LIFECYCLE_EXPORT_DELIVERY_MAX_ATTEMPTS`、`ROOT_LIFECYCLE_EXPORT_DELIVERY_RETRY_DELAY_SECONDS`。
5. Domain/API 测试和最终验收脚本覆盖 Webhook 500 后进入 `RETRY_SCHEDULED`、到期 dry-run、execute 重试成功和 `lifecycle_export_delivery_retry` smoke。

本轮未完成但已保留：

1. 真实邮件/企微 URL、模板内容、负责人名单和真实 CloudBase 执行历史仍需生产环境注入和验收。
2. 真实 COS/S3/CloudBase SDK Adapter、对象存储原生签名 URL 和企业微信 SSO/组织架构仍待后续；通道健康与失败原因聚合已在 B7 第六十一段接入。

### 11.61 B7 第六十一段实现记录

本轮已完成：

1. `adminLifecycleUserExports` 新增用户生命周期导出交付健康聚合 Interface，按通道、状态、失败原因和到期重试汇总已有导出记录。
2. 新增 `GET /api/v1/admin/lifecycle-user-exports/delivery-health`，返回 `HEALTHY`、`PENDING`、`WARNING`、`BLOCKED`、`IDLE` 五类健康状态。
3. Element Plus 用户生命周期导出记录抽屉新增通道健康摘要、通道维度表和失败原因表，并补齐 `RETRY_SCHEDULED`、`DEAD_LETTER` 交付状态标签。
4. Domain/API 测试和最终验收脚本覆盖 Webhook 失败后健康状态变为 `WARNING`、到期重试数为 1、重试成功后到期重试归零和 `lifecycle_export_delivery_health` smoke。

本轮未完成但已保留：

1. 真实邮件/企微 URL、模板内容、负责人名单和真实 CloudBase 执行历史仍需生产环境注入和验收。
2. 真实 COS/S3/CloudBase SDK Adapter、对象存储原生签名 URL 和企业微信 SSO/组织架构仍待后续；通道健康订阅通知已在 B7 第六十二段接入运营预警体系。

### 11.62 B7 第六十二段实现记录

本轮已完成：

1. `operationalAlerts` 新增 `LIFECYCLE_EXPORT_DELIVERY_HEALTH` 目标类型，复用既有运营预警 Interface 生成导出交付健康告警。
2. 新增默认规则 `op_alert_lifecycle_export_delivery_dead_letter` 与 `op_alert_lifecycle_export_delivery_due_retry`，分别覆盖 `DEAD_LETTER` 和到期 `RETRY_SCHEDULED`。
3. 预警通知 payload 新增导出记录、文件名、交付通道、交付状态、到期重试数、死信数、尝试次数和死信原因字段，Webhook Adapter 可直接投递给邮件/企微等外部通道。
4. Element Plus 运营数据页的预警规则表单新增“导出交付健康”目标选项，运营可继续按阈值、负责人和路由 Key 配置。
5. Domain/API 测试和最终验收脚本覆盖导出死信、到期重试、默认规则、站内通知、Job 执行结果和 `operational_alerts` smoke。

本轮未完成但已保留：

1. 真实邮件/企微 URL、模板内容、负责人名单和真实 CloudBase 执行历史仍需生产环境注入和验收。
2. 真实 COS/S3/CloudBase SDK Adapter、对象存储原生签名 URL、企业微信 SSO/组织架构和外部告警通道签收策略仍待后续生产校准。

### 11.63 B7 第六十三段实现记录

本轮已完成：

1. `releaseRecord` 新增外部通道与负责人证据聚合，发布记录会输出 `evidence.externalChannelReadiness`。
2. 发布记录证据覆盖 Operational Alerts 负责人路由、`ROOT_OPERATIONAL_ALERT_WEBHOOK_*`、用户生命周期导出 Webhook 交付变量和导出交付健康摘要。
3. 发布记录顶层新增 `mustFixBeforeRelease`、`mustConfirmForGray` 和 `finalChecks` 镜像，Element Plus 开发发布页可直接展示发布阻塞。
4. `release-calibration` 命令行报告新增“外部通道与负责人”章节，输出预警规则数、Webhook 规则数、阻塞数、提醒数、导出到期重试和死信数。
5. Domain/API 测试和最终验收 `release_record` smoke 覆盖外部通道证据、导出健康预警负责人路由和发布阻塞字段镜像。

本轮未完成但已保留：

1. 真实邮件/企微/钉钉 URL、模板内容、负责人名单和真实 CloudBase 执行历史仍需生产环境注入和验收；发布记录现在会把缺口结构化暴露出来。
2. 真实 COS/S3/CloudBase SDK Adapter、对象存储原生签名 URL、企业微信 SSO/组织架构和外部告警签收策略仍待后续生产校准。

### 11.64 B7 第六十四段实现记录

本轮已完成：

1. 新增 `backend/src/releaseEvidencePack.js`，把发布记录、Production Env Matrix、CloudBase Job Manifest、Adapter 校准和外部通道负责人证据聚合为脱敏发布证据包。
2. 新增 `backend/scripts/release-evidence-pack.js` 与 `npm run release:evidence --prefix backend`，支持 `--base-url`、`--target production|gray`、`--admin-token`、`--strict`、`--json` 和 `--allow-blocked`。
3. 发布证据包会清洗 base_url 中的账号、密码和 query，不输出 token、secret、openid、unionid 或手机号原文，只保留状态、变量名、负责人路由和脱敏预览。
4. 新增 `backend/tests/release_evidence_pack.test.js`，覆盖证据包结构、脱敏策略、CLI 参数和发布闸口退出码。
5. 最终验收脚本新增 `release_evidence_pack` smoke，发布证据包进入 `npm run verify` 总闸门。

本轮未完成但已保留：

1. 发布证据包只证明当前环境的发布证据是否完整，不替代真实有赞、企微、CloudBase 控制台、外部 Webhook 和对象存储 SDK 的生产验收。
2. 真实生产证据需要在认证、应用绑定、CloudBase 变量和外部通道配置完成后，用同一命令重新生成并留档。

### 11.65 B7 第六十五段实现记录

本轮已完成：

1. 新增后台只读 `GET /api/v1/admin/release-evidence-pack`，返回 `{ pack, validation }`，支持 `target`、`baseUrl` 和 `strict` 查询参数。
2. `domain.getReleaseEvidencePack` 复用发布记录、Adapter 校准、Production Env Matrix、CloudBase Job Manifest 和 `releaseEvidencePack` Module，HTTP 层不重复拼装发布规则。
3. Element Plus「开发发布」页新增“发布证据包”区块，展示证据包状态、阻塞数、提醒数、Job 数、缺失变量数、阻塞/提醒列表和留证命令。
4. 发布页新增脱敏证据包 JSON 下载，便于生产验收时直接留档；下载内容仍复用后端脱敏校验后的 `pack/validation`。
5. API 测试和最终验收 `release_evidence_pack` smoke 已改为覆盖真实 HTTP Interface，Admin 自检和构建验证已覆盖页面接入。

本轮未完成但已保留：

1. 管理台展示的是当前运行环境的脱敏证据；真实生产签字仍必须在生产域名、CloudBase header、真实有赞/企微字段和外部通道配置完成后重新生成。
2. 企业微信 SSO、组织架构同步、真实 COS/S3/CloudBase SDK Adapter 和对象存储原生签名 URL 仍待后续生产校准。

### 11.66 B7 第六十六段实现记录

本轮已完成：

1. 新增 `releaseEvidenceArchive` Module，支持保存当前脱敏发布证据包、列出最近留档、写入操作审计。
2. Store 默认快照新增 `releaseEvidenceArchives`，快照校验会检查 `archive_id` 与 `request_id` 重复；`backend/db/schema.sql` 新增 `release_evidence_archive` 结构用于后续数据库拆表。
3. `GET /api/v1/admin/release-evidence-pack` 会返回最近留档摘要；新增 `POST /api/v1/admin/release-evidence-pack/archive` 保存当前证据包，要求 `CONFIG_WRITE` capability 和稳定 `request_id`。
4. Element Plus「开发发布」页新增留档备注、留档按钮和最近留档表；留档后刷新列表，JSON 下载仍来自脱敏证据包。
5. Domain/API 测试和最终验收 `release_evidence_pack` smoke 覆盖留档记录、幂等、审计和脱敏检查。

本轮未完成但已保留：

1. 留档记录只保存系统生成的脱敏证据，不替代产品/运营/研发的最终签字责任。
2. 生产留档仍需等真实 CloudBase、微信开放平台、有赞、企微、外部 Webhook 和对象存储配置完成后重新生成。

### 11.67 B7 第六十七段实现记录

本轮已完成：

1. `releaseEvidenceArchive` Module 对外补齐按 `archiveId` 取回留档详情的只读 Interface，返回留档摘要、当时保存的脱敏 `pack` 和 `validation`。
2. 新增 `GET /api/v1/admin/release-evidence-pack/archive?archiveId=...`，用于发布后复盘和附件补下载；不存在的留档返回 404。
3. Element Plus「开发发布」页最近留档表新增行级下载动作，下载的是对应留档时刻的证据包，不会被当前刷新后的发布状态覆盖。
4. Domain/API 测试和最终验收 `release_evidence_pack` smoke 覆盖留档详情取回、下载数据脱敏和 validation 状态。

本轮未完成但已保留：

1. 留档详情仍是系统自动证据，不包含产品/运营/研发手写签字；最终签字仍在发布记录模板中人工确认。
2. 真实生产留档详情仍需在生产环境重新生成后下载归档。

### 11.68 B7 第六十八段实现记录

本轮已完成：

1. 新增 `releaseSignoff` Module，支持产品、运营、研发三类发布签字，签字必须绑定已有发布证据包留档。
2. 发布记录 `signoffs` 从静态占位改为读取目标环境最新签字状态；未签字角色仍显示 `PENDING`。
3. 新增 `POST /api/v1/admin/release-signoffs`，要求 `CONFIG_WRITE` capability、稳定 `request_id`、合法角色、合法状态和匹配的 `archiveId`。
4. Store 默认快照新增 `releaseSignoffs`，快照校验覆盖 `signoff_id` 与 `request_id`；数据库 Schema 新增 `release_signoff` 表结构。
5. Element Plus「开发发布」页新增发布签字卡片，可选择留档、角色、状态和备注，并展示三类签字状态。
6. Domain/API 测试和最终验收 `release_evidence_pack` smoke 覆盖签字记录、幂等、审计和发布记录汇总。

本轮未完成但已保留：

1. 签字记录是后台操作证据，不替代真实组织流程中的最终负责人确认。
2. 生产签字仍需等真实生产证据包留档后，由产品、运营、研发分别在生产后台记录。

### 11.69 B7 第六十九段实现记录

本轮已完成：

1. `releaseSignoff` Module 新增发布签字 Gate，按产品、运营、研发三类角色计算 `READY/NEEDS_REVIEW/BLOCKED`。
2. 发布记录新增 `signoffGate`，生产目标缺少任一签字会进入发布阻塞，灰度目标缺少签字会进入待确认；任一角色 `REJECTED` 会直接阻塞。
3. 发布证据包新增 `summary.signoffGateStatus` 与 `evidence.signoffGate`，JSON/Markdown 留档均可看到签字 Gate、待签角色和绑定留档。
4. Element Plus「开发发布」页在发布签字卡片新增 Gate 摘要、待签/拒绝数量和当前提示，避免只看明细漏掉角色。
5. Domain/API 测试和最终验收 `release_record`、`release_evidence_pack` smoke 覆盖签字 Gate 初始待确认、产品签字后计数变化和三方通过后的 Gate READY。

本轮未完成但已保留：

1. Gate 只校验系统内签字记录，真实组织签字责任仍需在生产证据包留档后由对应负责人执行。
2. 生产 Gate 的最终 READY 仍依赖真实 CloudBase、微信开放平台、有赞、企微、外部通道和对象存储配置完成后重新生成证据并三方签字。

### 11.70 B7 第七十段实现记录

本轮已完成：

1. 新增 `adminTransitionReadiness` Module，集中判断 Element Plus Admin 模块覆盖、`admin/dist`、`backend/public/admin-dist`、`/admin-legacy` 回退和旧后台下线批准状态。
2. 发布记录新增 `evidence.adminTransitionReadiness`，并把 Admin 迁移阻塞/提醒纳入 `mustFixBeforeRelease`、`mustConfirmForGray` 和最终确认清单。
3. 发布证据包新增 `summary.adminTransitionStatus` 与 `evidence.adminTransitionReadiness`，JSON/Markdown 留档可看到 Admin 迁移 Gate、模块覆盖和部署包状态。
4. Element Plus「开发发布」页新增 Admin 迁移 Gate 卡片，展示模块覆盖、部署包、旧后台回退和下线批准状态。
5. Domain/API 测试和最终验收 `release_record`、`release_evidence_pack` smoke 覆盖 Admin 迁移 Gate；独立测试覆盖未批准下线、批准下线和缺少 backend-only dist 的三种状态。

本轮未完成但已保留：

1. 本段不删除 `backend/public/admin.html`、`admin.css`、`admin.js` 或 `/admin-legacy`；正式删除仍需生产稳定期和 `ROOT_LEGACY_ADMIN_DEPRECATION_APPROVED=true`。
2. 旧静态后台相关历史补迁操作入口仍需等生产下线批准后再决定保留、迁移或删除。

### 11.71 B7 第七十一段实现记录

本轮已完成：

1. 新增 `productionCutoverReadiness` Module，把微信开放平台认证、CloudBase unionid 透传、Root 会员中心 appId、有赞字段、企微字段、CloudBase Job、外部通道、导出存储和回滚演练拆成 10 个生产切换证明项。
2. 发布记录新增 `evidence.productionCutoverReadiness`，生产目标缺少证明变量会进入 `BLOCKED`，灰度目标缺少证明变量会进入 `NEEDS_REVIEW`。
3. 发布证据包新增 `summary.productionCutoverStatus` 与 `evidence.productionCutoverReadiness`，JSON/Markdown 留档和 `npm run calibrate --prefix backend` 均可看到生产切换 Gate。
4. Element Plus「开发发布」页新增生产切换 Gate 卡片，展示分组、证明变量、负责人角色、阻塞和提醒。
5. API/Domain/证据包测试和最终验收 `release_record` / `release_evidence_pack` smoke 覆盖生产切换 Gate。

本轮未完成但已保留：

1. Gate 只记录生产切换证明是否已完成，不替代微信开放平台、有赞、企微、CloudBase、对象存储和外部通道的真实控制台验收。
2. 生产目标要解除 Gate，需在生产环境注入对应 `ROOT_CUTOVER_*` 证明变量，并重新生成发布证据包、留档和三方签字。

### 11.72 B7 第七十二段实现记录

本轮已完成：

1. 新增 `productionCutoverProof` Module，用稳定 `request_id` 记录生产切换证明项的 `VERIFIED` / `REJECTED` 状态，并统一做 evidence ref 与备注脱敏。
2. Store、seed 与 SQL schema 新增 `productionCutoverProofs` / `production_cutover_proof`，并把 `proof_id`、`request_id` 纳入快照重复校验。
3. 新增 `GET /api/v1/admin/production-cutover-proofs` 与 `POST /api/v1/admin/production-cutover-proofs`，写入 Interface 要求 `CONFIG_WRITE` 能力、幂等 request id 和审计记录。
4. 发布记录的生产切换 Gate 已读取最新证明记录；证明项可来自 `ROOT_CUTOVER_*` 环境变量或后台 `VERIFIED` 记录，最新 `REJECTED` 记录会让该项进入阻塞。
5. Element Plus「开发发布」页的生产切换 Gate 卡片新增证明记录表单，可选择证明项、状态、证据引用和备注，并在表格中展示证明来源与最近记录时间。
6. Domain/API/证据包测试和最终验收 smoke 已覆盖证明记录、幂等、脱敏、审计和发布记录联动。

本轮未完成但已保留：

1. 后台证明记录是 operator 留证入口，不替代微信开放平台认证、有赞字段校准、企微字段校准、CloudBase Job 控制台创建、对象存储配置和回滚演练本身。
2. 正式生产切换仍需补齐真实外部验收链接、截图或执行记录，再由产品、运营、研发重新生成发布证据包并签字。

### 11.73 B7 第七十三段实现记录

本轮已完成：

1. 新增 `consultationWeworkWriteback` Module，把咨询跟进待办的企微联系回写收口为独立 Interface，支持人工记录、自动 Adapter、幂等 `request_id`、状态摘要、审计和用户咨询状态联动。
2. 新增 `weworkContactWritebackAdapter` Adapter，支持 `WEWORK_CONTACT_WRITEBACK_URL`、token 位置、method、额外参数、结果状态路径、外部回执路径和成功值配置，便于后续对接真实企微联系结果回执。
3. Store、seed 与 SQL schema 新增 `consultationWeworkWritebacks` / `consultation_wework_writeback`，快照校验覆盖 `writeback_id` 与 `request_id` 重复，避免运营重复点击造成多次回写。
4. 新增 `GET /api/v1/admin/consultation-wework-writebacks` 与 `POST /api/v1/admin/consultation-wework-writebacks`，写入 Interface 要求 `REVIEW_RESOLVE` 能力、稳定 request id 和审计记录；自动模式失败会记录失败证据但不关闭待办。
5. Element Plus 用户生命周期详情抽屉新增“企微联系回写”，可选择人工或 `WEWORK_CONTACT_WRITEBACK` Adapter，填写外部联系人 ID、状态和备注后写回，并按权限禁用按钮。
6. Production Env Matrix、发布记录环境 presence 和生产切换 Gate supporting env 已纳入 `WEWORK_CONTACT_WRITEBACK_URL`，让发布前能识别企微联系回写是否完成真实生产配置。
7. Domain/API/Admin 自检和最终验收脚本已覆盖企微联系回写记录、重复 request id、待办关闭、敏感信息脱敏、写回列表查询和 release smoke。

本轮未完成但已保留：

1. 真实企微联系回写 URL、token、模板、外部联系人字段和回执字段仍需生产配置、小流量验收和发布证据留档。
2. 企微会话内容自动拉取、复核页更细解释模板仍按后续运营增强批次推进；咨询 SLA 超时提醒、顾问工作台和升级链路已在 B7 第七十五至七十七段接入。

### 11.74 B7 第七十四段实现记录

本轮已完成：

1. 新增 `consultationAdvisorAssignment` Module，把咨询跟进待办的顾问分配收口为独立 Interface，支持人工指定、自动候选池分配、幂等 `request_id`、历史分配流水和审计。
2. Store、seed 与 SQL schema 新增 `consultationAdvisorAssignments` / `consultation_advisor_assignment`，快照校验覆盖 `assignment_id` 与 `request_id` 重复。
3. 新增 `GET /api/v1/admin/consultation-advisor-assignments` 与 `POST /api/v1/admin/consultation-advisor-assignments`，写入 Interface 要求 `REVIEW_RESOLVE` 能力和稳定 request id。
4. 顾问分配结果写入 `CONSULTATION_FOLLOW` 待办 metadata，并由 Consultation Follow-up Presenter 输出 `assignedAdvisorId`、`assignedAdvisorName`、`assignedAdvisorRole` 和 `assignmentId`，页面不需要理解待办内部结构。
5. Element Plus 用户生命周期详情抽屉新增“顾问分配”，可选择人工指定或自动分配；自动分配可从 `ROOT_CONSULTATION_ADVISORS` 或页面候选字符串中选择当前活跃分配数较少的顾问。
6. Production Env Matrix 和发布记录环境 presence 已纳入 `ROOT_CONSULTATION_ADVISORS`，让发布前能识别自动分配候选池是否已配置。
7. Domain/API/Admin 自检和最终验收脚本已覆盖顾问分配、重复 request id、自动分配、生命周期展示、审计和 release smoke。

本轮未完成但已保留：

1. 真实企业微信组织架构、企业微信 SSO、顾问在线状态和真实会话内容自动拉取仍需生产字段与权限校准后接入。
2. 咨询 SLA 超时提醒、咨询顾问工作台和 SLA 升级链路已在 B7 第七十五至七十七段接入；复核解释模板已在 B7 第七十八段接入。

### 11.75 B7 第七十五段实现记录

本轮已完成：

1. 新增 `consultationSla` Module，把 `CONSULTATION_FOLLOW` 待办的 SLA 状态计算收口为独立 Interface，兼容历史待办，仅依赖 `created_at`、顾问分配 metadata 和可选 SLA 配置。
2. 新增 `GET /api/v1/admin/consultation-sla`，支持按 `rootUserId`、`advisorId`、`campaignId`、`status`、`slaMinutes` 和 `now` 查询超时、即将超时与正常跟进中的咨询列表。
3. Consultation Follow-up Presenter 已输出 `slaStatus`、`slaDueAt`、`slaOverdueMinutes` 等字段；Element Plus 用户生命周期详情抽屉新增“咨询 SLA”面板和刷新入口。
4. Operational Alerts 新增 `CONSULTATION_SLA_OVERDUE` 目标和默认规则 `op_alert_consultation_sla_overdue`，可通过运营数据页配置负责人、阈值、站内通知或 Webhook。
5. 用户生命周期指标新增 `overdueConsultations`；运营数据页目标类型下拉新增“咨询 SLA 超时”。
6. Production Env Matrix、发布记录和发布证据包已纳入 `ROOT_CONSULTATION_SLA_MINUTES`、`ROOT_CONSULTATION_SLA_DUE_SOON_MINUTES` 与咨询 SLA 负责人路由。
7. Domain/API/Admin 自检和最终验收脚本已覆盖 SLA 列表、超时分钟、顾问归属、运营预警命中、通知落账、发布证据路由和 release smoke。

本轮未完成但已保留：

1. 真实企微会话内容自动拉取、顾问在线状态、企业微信 SSO 和组织架构仍需生产字段与权限校准后接入。
2. 复核解释模板已在 B7 第七十八段接入；顾问工作台已在 B7 第七十六段接入，超时升级链路已在 B7 第七十七段接入。

### 11.76 B7 第七十六段实现记录

本轮已完成：

1. 新增 `consultationAdvisorWorkbench` Module，把咨询顾问负载、SLA 状态、未分配咨询和顾问候选池聚合收口为独立 Interface。
2. 新增 `GET /api/v1/admin/consultation-advisor-workbench`，支持按顾问、分配状态、SLA 状态、`slaMinutes`、`now` 和 `limit` 查询顾问工作台快照。
3. Element Plus 用户生命周期页新增“顾问工作台”抽屉，展示待跟进、已超时、即将超时、活跃顾问、未分配和最大超时，并可点击顾问筛选待办明细。
4. 顾问工作台复用 `consultationSla` 的 SLA Interface，不重复实现规则；后续接真实企微在线状态时只需在工作台 Module 内部补 Adapter。
5. Admin 自检、Domain/API 测试和最终验收脚本已覆盖顾问分组、未分配分组、配置候选池、超时状态、页面入口和 HTTP smoke。

本轮未完成但已保留：

1. 真实企微在线状态、排班、组织架构和 SSO 仍需生产字段与权限校准后接入顾问工作台内部 Adapter。
2. 复核解释模板已在 B7 第七十八段接入；会话内容自动拉取仍按后续生产字段校准批次推进；超时升级链路已在 B7 第七十七段接入。

### 11.77 B7 第七十七段实现记录

本轮已完成：

1. 新增 `consultationSlaEscalation` Module，把咨询 SLA 超时后的升级等级、负责人角色、处理动作和下次升级时间收口为独立 Interface。
2. 新增 `GET /api/v1/admin/consultation-sla-escalations`，支持按 root 用户、顾问、分配状态、活动、SLA 参数、升级等级和升级阶段查询。
3. 升级规则支持 `ROOT_CONSULTATION_SLA_ESCALATION_RULES` 配置；默认链路为 0 分钟顾问提醒、60 分钟运营升级、120 分钟负责人升级。
4. Operational Alerts 新增 `CONSULTATION_SLA_ESCALATION` 目标和默认规则 `op_alert_consultation_sla_escalation`，进入运营数据目标类型、通知 Job、发布记录负责人路由和发布证据包。
5. Element Plus 用户生命周期页“顾问工作台”抽屉新增“超时升级”区块，展示升级统计、负责人角色、顾问、用户、超时分钟、下次升级和处理动作。
6. Production Env Matrix、发布记录和最终验收脚本已纳入 `ROOT_CONSULTATION_SLA_ESCALATION_RULES`、升级查询、升级预警和负责人路由。

本轮未完成但已保留：

1. 真实企微在线状态、排班、组织架构、SSO 和会话内容自动拉取仍需生产字段与权限校准后接入。
2. 复核解释模板已在 B7 第七十八段接入。

### 11.78 B7 第七十八段实现记录

本轮已完成：

1. 新增 `manualReviewExplanation` Module，把复核标题、待处理原因、所需证据、用户下一步、处理结果文案和运营指引收口为同一 Interface。
2. Manual Review Module 输出 `explanation`、`explanationTitle`、`pendingReason`、`evidenceRequired`、`nextAction` 和 `operatorGuidance`；用户端请求不会暴露运营指引，Admin 工作台会展示运营指引。
3. 支持 `ROOT_MANUAL_REVIEW_EXPLANATION_TEMPLATES` 环境变量按 `FREE_ORDER_REVIEW`、`REWARD_REVIEW`、`MANUAL_REVIEW` 覆盖模板；不配置时使用默认运营口径。
4. 小程序 `subpkg/profile/pages/review/index` 新增解释卡、证据标签和下一步动作；Element Plus 奖励复核表新增解释模板列。
5. Production Env Matrix、发布记录、Admin 自检、小程序自检、Domain/API/release readiness 测试和最终验收脚本均已覆盖模板配置、用户端脱敏和后台运营指引。

本轮未完成但已保留：

1. 真实运营模板最终口径需在生产前通过 `ROOT_MANUAL_REVIEW_EXPLANATION_TEMPLATES` 校准，并由运营确认文案；模板结构校验与后台预览已进入 B7 第七十九段。
2. 真实企微在线状态、排班、组织架构、SSO 和会话内容自动拉取仍需生产字段与权限校准后接入。

### 11.79 B7 第七十九段实现记录

本轮已完成：

1. 扩展 `manualReviewExplanation` Module，新增 `validateManualReviewExplanationTemplates` 和 `listManualReviewExplanationTemplates`，把模板解析、字段类型、未知字段、占位符和敏感词检查收口到同一 Interface。
2. `GET /api/v1/admin/config-workbench` 新增 `manualReviewExplanationTemplates`，返回 `READY/NEEDS_REVIEW/BLOCKED`、错误/提醒列表和三类复核模板预览。
3. Element Plus Admin“奖励复核”页新增“复核解释模板校准”面板，展示模板来源、标题、用户解释、所需证据和运营指引。
4. Admin 自检、Domain/API 测试和最终验收 smoke 已覆盖模板校验、HTTP 工作台返回、无运营指引泄露和无效 JSON/敏感用户文案拦截。

本轮未完成但已保留：

1. 真实运营话术仍需运营在生产前确认；确认后通过 `ROOT_MANUAL_REVIEW_EXPLANATION_TEMPLATES` 注入，并以后台校准面板状态为上线检查依据。
2. 真实企微在线状态、排班、组织架构、SSO 和会话内容自动拉取仍需生产字段与权限校准后接入。

### 11.80 B7 第八十段实现记录

本轮已完成：

1. 新增 `legacyDataMigration` Module，对旧 `checkinSessions`、`checkinRecords`、`questionnaireResponses`、`couponEvents` 和 `refundWorkItems` 做只读迁移评估，不执行补迁写入。
2. 发布记录新增 `evidence.legacyDataMigration`，输出旧周期数量、旧打卡/问卷/券/退款事实、未桥接事实、奖励决策、人工复核决策、阻塞项、提醒项和下一步动作。
3. 发布证据包新增“旧数据迁移评估”证据段，并把旧数据评估状态纳入 `summary.legacyDataMigrationStatus`、阻塞/提醒聚合和证据包 validation。
4. Element Plus Admin“开发发布”页新增“旧数据迁移评估”卡片，运营可查看旧试饮周期、迁移决策、阻塞/提醒和建议动作。
5. Domain/API/证据包测试、Admin 自检和最终验收 smoke 已覆盖无旧数据 `READY`、有旧数据 `NEEDS_REVIEW`、缺失用户 `BLOCKED` 和只读 `writeMode=false`。

本轮未完成但已保留：

1. 生产环境旧 7 日试饮历史是否只读归档、选择性补迁为新任务事实，或转人工处理，仍需基于生产快照和运营口径决策。
2. 本轮没有提供真实写入补迁命令；如后续需要执行迁移，应先生成生产快照、走 dry-run、留存发布证据包，并由产品、运营、研发签字确认。

### 11.81 B7 第八十一段实现记录

本轮已完成：

1. 新增 `cloudbaseStoreReadiness` Module，把 CloudBase Store 生产决策、环境 ID、地域、当前 Store Adapter、MySQL 变量、备份计划、回滚计划和生产证明收口为发布前 Gate。
2. Production Env Matrix 新增 `cloudbase_store` 组，要求生产发布前明确 `ROOT_CLOUDBASE_STORE_DECISION`、CloudBase 环境/地域、备份计划和回滚计划。
3. 发布记录和发布证据包新增 `cloudbaseStoreReadiness` / `summary.cloudbaseStoreStatus`，并把阻塞项、提醒项和下一步动作纳入脱敏留档。
4. Element Plus Admin“开发发布”页新增“CloudBase Store 决策”卡片，运营和研发可在同一页面查看决策、Adapter 匹配、环境、备份回滚、阻塞项和建议动作。
5. Domain/API/证据包测试、Admin 自检和最终验收 smoke 已覆盖未决策、云托管 MySQL 决策、CloudBase Database 未实现 Adapter 等场景。

本轮未完成但已保留：

1. 真实 CloudBase 控制台环境 ID、地域、备份计划、回滚计划和生产证明引用仍需生产环境填写。
2. 当前没有实现 CloudBase Database 写入 Adapter；如果未来决定把 CloudBase Database 作为主 Store，需要单独实现 Adapter、迁移验证和回滚演练。

### 11.82 B7 第八十二段实现记录

本轮已完成：

1. 新增 `rootMemberCenterReadiness` Module，统一检查 Root 会员中心 appId、商品购买路径、活跃商品快照、商品级跳转目标和 appId 一致性。
2. Product Mirror 跳转目标优先读取 `ROOT_MEMBER_CENTER_APPID`、`ROOT_MEMBER_CENTER_PRODUCT_PATH` 和 `ROOT_MEMBER_CENTER_ENV_VERSION`，并保留旧 `ROOT_YOUZAN_*` 变量兼容。
3. 小程序 `config/env.js` 移除示例 appid/path fallback，未配置时由 `youzan-jump` 显性提示“Root 会员中心暂未配置”，避免误跳占位小程序。
4. 发布记录和发布证据包新增 `rootMemberCenterReadiness` / `summary.rootMemberCenterStatus`，把购买跳转缺口纳入阻塞、提醒、最终检查和脱敏留档。
5. Production Env Matrix 新增可选说明组 `root_member_center_jump`，用于提示生产环境确认购买跳转相关变量；商品级路径仍可由有赞商品快照提供。
6. Element Plus Admin“开发发布”页新增“Root 会员中心购买跳转”卡片，展示 Gate、活跃商品、可跳转商品、缺配置数量、商品级 appId/path 来源和下一步动作。
7. Domain/API/证据包测试、Admin 自检、小程序自检和最终验收 smoke 已覆盖缺 appId、缺路径、appId 冲突、新变量优先级和证据包留档。

本轮未完成但已保留：

1. 真实 Root 会员中心小程序 appid、商品路径和体验版跳转结果仍需在微信开放平台认证、应用绑定和有赞商品样本确认后写入生产环境或商品快照。
2. 真实有赞商品路径字段、SKU 字段和 Root 会员中心页面路径仍需 live 字段校准；本轮只完成配置 Gate，不做真实外部调用。

### 11.83 B7 第八十三段实现记录

本轮已完成：

1. 新增 `rootMemberCenterJumpProof` Module，记录商品级体验版跳 Root 会员中心的 `VERIFIED` / `REJECTED` 证明、appId/path 快照、证据引用、备注、操作人和审计。
2. 新增 `GET/POST /api/v1/admin/root-member-center-jump-proofs`，支持幂等写入、最新证明查询、证据引用脱 query、token/secret/openid/unionid/手机号脱敏。
3. `rootMemberCenterReadiness` Gate 已消费最新跳转证明：生产目标在 appId/path 已配置后缺证明会 `BLOCKED`，灰度目标为 `NEEDS_REVIEW`，`REJECTED` 或证明与当前配置不一致会提示重新实测。
4. Element Plus Admin“开发发布”页的 Root 会员中心购买跳转卡片已新增证明录入表单，并在商品检查表展示证明状态和证明时间。
5. 发布记录、发布证据包、Schema、Domain/HTTP Interface 测试、Admin 自检和最终验收 smoke 已覆盖证明记录、脱敏、幂等和 Gate 联动。

本轮未完成但已保留：

1. 真实 Root 会员中心 appId/path、真实体验版跳转截图或链接仍需在微信开放平台认证、应用绑定和有赞商品样本确认后由运营/研发录入。
2. 真实有赞商品路径字段、SKU 字段、订单字段和券字段仍需 live 字段校准。

### 11.84 B7 第八十四段实现记录

本轮已完成：

1. 新增 `legacyDataMigrationDecision` Module，记录旧 7 日历史数据生产处置策略：`NO_LEGACY_DATA`、`READ_ONLY_ARCHIVE`、`SELECTIVE_BACKFILL`、`MANUAL_REVIEW`。
2. 新增 `GET/POST /api/v1/admin/legacy-data-migration-decisions`，支持幂等写入、最新决策查询、快照引用、dry-run 引用、证据引用、备注、操作人、审计和敏感信息脱敏。
3. `legacyDataMigration` Gate 已联动最新决策：生产目标存在旧数据但没有 `APPROVED` 决策会 `BLOCKED`，灰度目标缺决策为 `NEEDS_REVIEW`，`REJECTED` 或旧数据与 `NO_LEGACY_DATA` 决策不匹配会阻塞。
4. Element Plus Admin“开发发布”页的旧数据迁移评估卡片已新增决策录入表单，并在摘要中展示生产决策状态。
5. 发布记录、发布证据包、Schema、Domain/HTTP Interface 测试、Admin 自检和最终验收 smoke 已覆盖决策记录、脱敏、幂等和 Gate 联动。

本轮未完成但已保留：

1. 本轮不执行写入型补迁；若真实生产选择 `SELECTIVE_BACKFILL`，仍必须先冻结生产快照、跑 dry-run、重新生成证据包并完成签字。
2. 旧数据执行历史已在 B7 第八十五段推进为可录入 Interface；真实生产执行证据仍需上线前按生产决策补录到发布证据中。

### 11.85 B7 第八十五段实现记录

本轮已完成：

1. 新增 `legacyDataMigrationExecution` Module，记录旧数据生产处置执行历史：`NO_OP_CONFIRMED`、`ARCHIVE_CONFIRMED`、`BACKFILL_EXECUTED`、`MANUAL_REVIEW_CONFIRMED`。
2. 新增 `GET/POST /api/v1/admin/legacy-data-migration-executions`，支持幂等写入、最新执行查询、执行引用、证据引用、影响周期/事实数量、备注、操作人、审计和敏感信息脱敏。
3. `legacyDataMigration` Gate 已联动最新执行历史：生产目标存在旧数据时，只有最新 `APPROVED` 决策与匹配动作的 `VERIFIED` 执行历史同时存在，旧数据 Gate 才能进入 `READY`。
4. Element Plus Admin“开发发布”页的旧数据迁移评估卡片已新增执行历史录入表单，并在摘要中展示执行历史状态。
5. 发布记录、发布证据包、Schema、Domain/HTTP Interface 测试、Admin 自检和最终验收 smoke 已覆盖执行历史、脱敏、幂等和 Gate 联动。

本轮未完成但已保留：

1. 本轮仍不直接写入生产旧数据；系统只记录生产处置执行结果和证据。
2. 真实生产执行、截图/链接、CloudBase/对象存储留档和产品/运营/研发签字仍需在上线环境完成后录入。

### 11.86 B7 第八十六段实现记录

本轮已完成：

1. 新增 `actionAdapterCalibration` Module，把有赞发券、有赞券状态查询、企业微信标签写入和企业微信联系回写拆成动作类 Adapter 校准 Gate。
2. 新增 `GET /api/v1/admin/action-adapter-calibration`，按 `production` / `gray` 目标输出配置检查、真实执行证据检查、阻塞/提醒统计和回滚口径。
3. 发布记录新增 `evidence.actionAdapterCalibration`，并把动作 Adapter 阻塞/提醒纳入 `mustFixBeforeRelease`、`mustConfirmForGray` 和最终检查。
4. 发布证据包新增 `summary.actionAdapterCalibrationStatus` 与 `evidence.actionAdapterCalibration`，JSON/Markdown、`npm run release:evidence` 和 `npm run calibrate` 均可看到动作 Adapter 校准结果。
5. Element Plus Admin“开发发布”页新增“外部动作 Adapter 校准”卡片，展示动作状态、Adapter 类型、阻塞、提醒和检查结果。
6. Domain/HTTP Interface 测试、发布证据包测试、Admin 自检和最终验收 smoke 已覆盖动作 Adapter 校准 Interface、发布记录聚合和证据包留档。

本轮未完成但已保留：

1. 真实 `YOUZAN_COUPON_SEND_URL`、`YOUZAN_COUPON_STATUS_URL`、`WEWORK_TAG_APPLY_URL`、`WEWORK_CONTACT_WRITEBACK_URL`、token、字段映射和模板仍需在生产环境注入。
2. 真实有赞发券、券状态查询、企业微信打标签和联系回写需要用小批量账号执行，并把成功回执留存在对应运行记录后重新生成发布证据包。

### 11.87 B7 第八十七段实现记录

本轮已完成：

1. 新增 `adminLegacyDeprecationDecision` Module，记录旧静态后台下线 `APPROVED` / `REJECTED` 决策。
2. 新增 `GET/POST /api/v1/admin/admin-legacy-deprecation-decisions`，支持幂等写入、最新决策查询、证据引用、回滚引用、备注、操作人、审计和敏感信息脱敏。
3. `adminTransitionReadiness` Gate 已从单纯环境变量升级为“决策记录优先，环境变量兼容兜底”；最新 `REJECTED` 决策会提示继续保留 `/admin-legacy`。
4. 发布记录和发布证据包新增 `evidence.adminTransitionReadiness.legacyDeprecationDecision`，Markdown 报告会展示下线决策状态与来源。
5. Element Plus Admin“开发发布”页的 Admin 迁移 Gate 卡片已新增旧后台下线决策录入表单，并展示决策状态和来源。
6. Domain/HTTP Interface 测试、发布证据包测试、Admin 自检和最终验收 smoke 已覆盖下线决策记录、脱敏、幂等和发布记录联动。

本轮未完成但已保留：

1. 本轮不删除 `backend/public/admin.html`、`admin.css`、`admin.js` 或 `/admin-legacy`；生产稳定且运营确认无日常依赖后，再录入真实 `APPROVED` 决策并执行文件删除。
2. 若生产下线前发现 Element Plus Admin 漏能力或回滚演练不充分，应录入 `REJECTED` 决策，继续保留 `/admin-legacy` 回退入口。

### 11.88 B7 第八十八段实现记录

本轮已完成：

1. 新增 `productionEvidenceIntake` Module，把未做事项台账 T-001 到 T-010 映射为生产证据收口项。
2. 该 Module 复用现有发布 Gate：生产切换、Root 会员中心购买跳转、有赞/企微 Adapter 校准、CloudBase Store、旧后台下线决策和旧数据迁移，不另起一套判断口径。
3. 发布记录新增 `evidence.productionEvidenceIntake`，输出 10 条证据项、负责人、来源 Gate、状态、下一步动作、阻塞和提醒。
4. 发布证据包新增 `summary.productionEvidenceIntakeStatus` 与 `evidence.productionEvidenceIntake`，Markdown 报告新增“生产证据收口”章节。
5. Element Plus Admin“开发发布”页新增“生产证据收口”卡片，集中展示 T-001 到 T-010 的状态和下一步动作。
6. Domain/HTTP Interface 测试、发布证据包测试、Admin 自检和最终验收 smoke 已覆盖生产证据收口项数量、留档和下线决策联动。

本轮未完成但已保留：

1. 生产证据收口只汇总和指引，不伪造真实证明；T-001 到 T-010 仍需在外部认证、Root 会员中心、有赞、企微、CloudBase 和真机预览完成后录入。
2. 若某个底层 Gate 已有更严格判断，以底层 Gate 为准；收口板块只降低运营追踪成本。

### 11.89 B7 第八十九段实现记录

本轮已完成：

1. 补齐新版 `questionnaire_answer` Module：新增 `submitQuestionnaireAnswer`、`getQuestionnaireAnswerStatus`、答卷幂等、必填题校验、分值范围校验和需要跟进判断。
2. 新增用户端 HTTP Interface：`POST /api/v1/questionnaire/answers` 与 `GET /api/v1/questionnaire/answers/status`，用于 myRoot 活动问卷，不要求存在旧 `checkin_session` 或订单。
3. 小程序 `subpkg/task/pages/questionnaire/index` 已从直接写 `task_event` 改为提交新版答卷，后端通过答卷生成 `QUESTIONNAIRE` 任务事实。
4. 新版问卷若触发 `needsContact`、`worse` 等跟进条件，会创建 `QUESTIONNAIRE_FOLLOW` 运营待办，不再依赖订单或打卡周期。
5. Element Plus 用户生命周期详情抽屉新增“新版问卷答卷”摘要与最近答卷表，运营可按用户追溯问卷提交记录。
6. Domain/API 测试、Admin 自检、小程序自检和最终验收 smoke 已覆盖新版问卷答卷、任务进度、后台摘要和幂等。

本轮未完成但已保留：

1. 旧 `/api/v1/questionnaire/submit` 仍保留给历史 7 日试饮和 Day8 退款链路，不在本轮删除。
2. 更复杂的问卷题型、问卷后台可视化编辑和分支题逻辑如后续需要，应继续在 Questionnaire Module 内扩展 Interface，而不是写进页面。

### 11.90 B7 第九十段实现记录

本轮已完成：

1. 重构 `pages/home/index` 的 `activity` 状态：首页不再围绕订单启动作为主体，改为展示 myRoot 活动标题、参与状态、必做任务进度和完成度。
2. 首页新增“今日建议”卡片，消费 `Task Progress` Presenter 后的任务展示模型，按任务类型跳转打卡、问卷、咨询、分享或商品页。
3. 首页新增任务进度摘要和最近任务列表，用户可从首页进入完整任务中心。
4. 首页新增 Root 会员中心商品镜像摘要，展示 myRoot 商品快照，并跳商品详情/商品页处理购买跳转。
5. 首页新增订单、咨询、奖励快捷入口；订单仍可查看，但不再作为参与活动的前置入口。
6. 小程序自检新增首页重构契约，要求首页读取任务进度和商品镜像，并保留任务/商品/奖励入口。

本轮未完成但已保留：

1. 旧 `checkin` / `daily` 状态仍保留原展示，用于历史 7 日试饮和日常记录兼容；后续若彻底切到运营任务机制，可再把旧打卡周期展示合并到任务进度页。
2. 首页视觉可继续结合真机预览微调间距和图片裁切，但不影响当前活动入口、任务入口和商品入口能力。

### 11.91 B7 第九十一段实现记录

本轮已完成：

1. Settlement Module 的规则条件从“平铺数组”扩展为兼容旧配置的条件树：旧数组仍按隐式 AND 评估，显式 `{ logic: "AND" | "OR", conditions: [...] }` 可表达多条件组合。
2. 规则发布 Interface 接受数组或对象两种 `conditions`，发布前按叶子条件数量校验，避免空规则被发布。
3. 结算预览返回 `conditionTree`，同时保留旧页面使用的 `conditions` 与 `missingConditions`；显式 OR 已满足时不会把未命中的分支误报为缺失条件。
4. 后台配置 Presenter 的规则条件数量改为按条件树叶子节点统计，运营在配置工作台能看到真实配置复杂度。
5. Domain/API 测试覆盖 OR 规则树发布、打卡事实命中、结算预览达标、缺失条件清空和后台规则数量展示。

本轮未完成但已保留：

1. 拖拽式多层条件树可视化编辑器已在 B7 第一百段接入，继续复用 Settlement Module 的同一 Interface。
2. 售后追回和库存回补仍属于后续运营风控规则，不混入本轮条件树实现。

### 11.92 B7 第九十二段实现记录

本轮已完成：

1. Element Plus Admin 的「运营配置 / 结算规则」页新增规则生成器，可选择全部满足或任一满足，并勾选打卡、问卷、分享、咨询、购买等条件。
2. 规则生成器可配置打卡天数、问卷类型、分享次数和指定商品 ID，并可组合有赞券、免单机会、积分、标签等奖励。
3. 生成器输出仍是规则 JSON，发布仍走 `POST /api/v1/admin/campaign-rules/publish`，没有新增前端私有规则路径。
4. 默认规则模板改为使用 Settlement Module 已支持的 `conditionType`、`minCount`、`questionnaireType` 等字段，版本号默认值修正为 `1`。
5. Admin 自检新增 AND/OR 规则生成器契约，避免运营配置页退回纯手写 JSON。

本轮未完成但已保留：

1. B7 第一百段已把轻量生成器升级为拖拽式条件树编辑器；复杂嵌套仍可在规则 JSON 中继续精修。
2. 生成器输出可选 `stockLimit/quotaKey` 与免单抽取比例字段；售后追回和库存回补已在 B7 第九十六段进入 Reward Recovery Module，生成器本身不承接追回配置。

### 11.93 B7 第九十三段实现记录

本轮已完成：

1. Reward Grant Module 新增奖励上限保护：奖励配置可带 `stockLimit`、`maxCount`、`quota` 或 `quotaLimit`，并可用 `quotaKey` / `inventoryKey` / `budgetKey` 指定统计口径。
2. 上限判断发生在奖励生成前；用户达标和结算记录不受影响，超过上限的奖励返回 `skipped=true`、`status=SKIPPED` 和 `skippedReason`，不创建 `reward_grant` 或 `reward_delivery_job`。
3. 已生成过的同一用户奖励仍按幂等键返回既有 `reward_grant`，不会因为库存已满而把重复结算误判为跳过。
4. `reward_grant` 记录新增 `quota_key` 与 `quota_limit`，`schema.sql` 同步补字段，后台和后续导出可追溯奖励上限来源。
5. Element Plus Admin 规则生成器新增“奖励上限”，填 0 表示不限量，填正数时生成的奖励 JSON 会自动带 `stockLimit` 和 `quotaKey`。
6. Domain/API/Admin 自检和最终验收覆盖奖励上限、HTTP 发布、跳过结果和后台生成器字段。

本轮未完成但已保留：

1. 本段只做上限保护；独立库存池、预占记录和复核拒绝释放已在 B7 第九十四段接入。
2. 免单机会概率抽取和黑名单已在 B7 第九十五段接入；售后追回和库存回补已在 B7 第九十六段接入。

### 11.94 B7 第九十四段实现记录

本轮已完成：

1. 新增 Reward Inventory Module，提供奖励库存池、库存预占、库存释放和库存使用统计 Interface。
2. Store 默认快照新增 `rewardInventoryPools` 与 `rewardInventoryReservations`，`schema.sql` 新增 `reward_inventory_pool`、`reward_inventory_reservation`，并让 `reward_grant` 关联 `inventory_reservation_id`。
3. Reward Grant Module 创建限量奖励前先预占库存；预占失败时返回 `SKIPPED`，不创建 `reward_grant` 或 `reward_delivery_job`。
4. 同一奖励幂等重算会返回已有奖励和已有预占，不会重复占用库存。
5. 人工复核拒绝限量奖励时会释放对应库存 reservation，让后续达标用户可重新获得名额。
6. Domain/API 测试覆盖限量奖励预占、超限跳过、重复结算不重复占用、复核拒绝释放和释放后重新发放。

本轮未完成但已保留：

1. 生产多实例下的强事务锁仍需由生产 Store Adapter 通过数据库事务、唯一约束或行级锁增强；当前 Module 已集中 seam，便于替换 Implementation。
2. 免单机会概率抽取和黑名单已在 B7 第九十五段接入；售后追回和库存回补已在 B7 第九十六段接入。

### 11.95 B7 第九十五段实现记录

本轮已完成：

1. Reward Grant Module 新增奖励资格判断：支持 `chanceRate`、`selectionRate`、`lotteryRate`、`winRate`、`probability` 等字段做确定性抽取。
2. 抽取使用 `root_user_id + campaign_id + rule_version + reward_key` 生成确定性分数，避免同一用户重复结算时随机结果漂移。
3. 奖励配置支持 `blockedRootUserIds`、`blacklistRootUserIds`、`excludedRootUserIds` 等黑名单字段；命中时跳过奖励但不改变达标结算事实。
4. 0% 抽取、未抽中、黑名单命中均返回 `SKIPPED`、`skipped=true` 和 `skippedReason`，不创建 `reward_grant`、`reward_delivery_job` 或人工复核。
5. Element Plus Admin 规则生成器新增“免单抽取”比例，低于 100% 时生成 `chanceRate`。
6. Domain/API/Admin 自检覆盖 0% 抽取、黑名单跳过、HTTP 发布配置和后台生成器字段。

本轮未完成但已保留：

1. 更复杂的分层抽取和多级追回审批仍保留为后续深风控。

### 11.96 B7 第九十六段实现记录

本轮已完成：

1. 新增 Reward Recovery Module，提供奖励追回、撤销、台账记录、库存回补和人工复核关闭 Interface。
2. Store 默认快照新增 `rewardRecoveryRecords`，`schema.sql` 新增 `reward_recovery_record`，并给 `reward_grant` 补充 `recovery_status`、`recovery_reason`、`recovery_record_id` 和 `recovered_at` 字段。
3. 本地退款审批 `approveRefund` 已接入追回 Interface：退款通过后会追回该用户可追回奖励，释放对应库存 reservation，并返回 `rewardRecovery` 摘要。
4. 未发放奖励会被置为 `REVOKED` 并取消待发放任务；已发放或有外部凭证的奖励会进入 `RECOVERY_PENDING`，为后续真实外部追回动作留 seam。
5. 限量奖励被追回后会释放库存，后续达标用户可重新获得释放出的名额。
6. Domain/API 测试覆盖退款通过后的奖励追回、人工复核关闭、库存释放和释放后重新发放。

本轮未完成但已保留：

1. 真实 Root 会员中心售后字段、退款状态、部分退款、多包裹售后和有赞游标策略仍属于 D-012，需要 live sample 校准后接入 Commerce Mirror Module。
2. 多级追回审批、外部券撤销回执和积分/标签反向动作仍可复用 Reward Recovery Module 的台账与状态字段继续扩展。

### 11.97 B7 第九十七段实现记录

本轮已完成：

1. 新增 WeWork Touch Module，把自动企微触达拆成计划、队列、频控、执行和审计 Interface；默认扫描 `CONSULTATION_FOLLOW`、`QUESTIONNAIRE_FOLLOW`、`DAY8_QUESTIONNAIRE_PENDING` 和 `MANUAL_REVIEW_REQUIRED` 这类 OPEN 运营待办。
2. Store 默认快照新增 `weworkTouchJobs`，`schema.sql` 新增 `wework_touch_job`，记录待办、用户、外部联系人、模板、触达状态、幂等键、执行次数、外部回执和错误信息。
3. 新增 `weworkTouchAdapter` Adapter，支持 `WEWORK_TOUCH_SEND_URL`、token、method、额外参数、结果字段映射和成功值配置；未配置真实 URL/token 时可用 `MANUAL` / `LOCAL` 模式本地确认。
4. 新增 HTTP Interface：`GET /api/v1/admin/wework-touch-jobs`、`POST /api/v1/admin/wework-touch-jobs/plan`、`POST /api/v1/admin/wework-touch-jobs/run` 和 `POST /api/v1/jobs/wework-touch-due`，执行模式要求稳定 `request_id` 并写入审计。
5. 新增 `npm run wework-touch --prefix backend`，并把 `wework_touch_due` 写入 CloudBase Job Manifest 和 Production Env Matrix，默认每 10 分钟扫描、默认 24 小时同类触达冷却、每批 20 条。
6. 企微线索暂缺 `externalContactId` 时会生成 `BLOCKED` Job；后续补链后同一幂等键可重新激活为 `PENDING`，避免路演补数据后队列永久卡死。
7. Domain/API 测试和最终验收 smoke 已覆盖触达计划、BLOCKED 补链激活、命令行 Job 执行、待办完成、脱敏审计、CloudBase Manifest 和 Production Env Matrix。

本轮未完成但已保留：

1. 真实企微自动发送 URL、token、method、模板内容、回执字段和小批量成功执行证据仍需生产环境配置；本地已稳定 seam，后续只替换 Adapter 配置。
2. 更细的话术分层、顾问在线状态、企业微信 SSO、组织架构和会话内容自动拉取仍按后续运营增强批次推进。

### 11.98 B7 第九十八段实现记录

本轮已完成：

1. 新增 Order After-Sales Module，把 Root 会员中心订单售后同步拆成售后记录、状态映射、订单镜像摘要、退款工作项联动、奖励追回和审计 Interface。
2. Store 默认快照新增 `orderAfterSalesRecords`，`schema.sql` 新增 `order_after_sales_record`，并给 `youzan_order` 补充 `after_sales_status`、`after_sales_no`、`refund_status`、`refund_amount` 和 `after_sales_updated_at`。
3. 新增 HTTP Interface：`GET /api/v1/admin/order-after-sales`、`POST /api/v1/admin/order-after-sales/upsert` 和 `POST /api/v1/admin/order-after-sales/sync`，写入模式要求稳定 `request_id`，支持单条售后和批量售后记录同步。
4. 售后原始状态通过 `ROOT_AFTER_SALES_STATUS_MAP` 映射到内部状态；`ROOT_AFTER_SALES_RECOVERY_STATUSES` 控制哪些状态触发 Reward Recovery，`ROOT_AFTER_SALES_FOLLOW_STATUSES` 控制哪些状态生成 `ORDER_AFTER_SALES_FOLLOW` 待办。
5. 命中 `REFUNDED` / `PARTIAL_REFUND` 后，已存在的退款工作项会同步置为 `PAID`，关联奖励会复用 Reward Recovery Module 按 `order_id` / `youzanOrderNo` / `sessionId` 等证据追回或撤销，库存 reservation 会按既有追回 Interface 回补，避免同一用户跨订单误追回。
6. `reward_grant` 已补可选 `order_id`，用于把活动奖励承诺和订单售后事实建立显式关联；旧数据缺少关联字段时，仅在单一候选奖励场景保留兼容兜底。
7. 用户订单 payload 已返回售后摘要，后台 Dashboard 也能读取售后记录；Domain/API 测试和最终验收 smoke 已覆盖售后申请、退款成功、批量同步、用户订单摘要、奖励追回和快照校验。

本轮未完成但已保留：

1. 真实 Root 会员中心售后列表 URL、字段路径、游标、部分退款枚举、多包裹/拆单归属仍需生产 live sample 校准；本地 Interface 已稳定，后续只补 Adapter field map。
2. 复杂多级售后审批、外部券撤销回执和售后与客服会话联动仍可继续复用 Order After-Sales 与 Reward Recovery 的 seam 扩展。

### 11.99 B7 第九十九段实现记录

本轮已完成：

1. Questionnaire Module 新增分支题可见规则，支持 `visibleIf` / `visible_if` / `showIf`，可用 `field + equals / in / notEquals / exists / truthy / GT / GTE / LT / LTE` 表达简单规则，也支持 `AND / OR` 条件组。
2. 问卷必填校验已改为“当前答案下可见题”的必填校验；隐藏题不再阻塞提交，显示出的 `required: true` 分支题会被后端统一拦截。
3. 默认 `DAY4_MIDPOINT` 与 `DAY8_SUMMARY` 增加 `needsContact === true` 时显示的 `contactReason` 分支题，作为运营跟进原因的结构化输入。
4. 小程序新版活动问卷页和旧 7 日打卡问卷页均接入同一前端分支规则 Module，按答案动态展示题目并只校验当前可见必填项。
5. Domain/API 测试覆盖可见分支题缺失失败、正常提交、幂等提交、任务事实桥接和生命周期问卷摘要；小程序校验和最终验收 smoke 已同步更新。

本轮未完成但已保留：

1. 后台规则拖拽编辑器已在 B7 第一百段完成；当前后台已可配置、重排、启停和分组 AND/OR 条件树。
2. 更复杂的问卷分支版本发布、题库复用、分支预览和问卷 A/B 仍可在 Questionnaire Module 的分支 Interface 上继续扩展。

### 11.100 B7 第一百段实现记录

本轮已完成：

1. Element Plus Admin「运营配置 / 结算规则」页新增规则拖拽编辑器，替代原轻量勾选条件区；运营可新增条件、新增分组、启停节点、上移/下移，并用 HTML5 拖放在同层重排。
2. 条件树编辑器支持根节点 `AND / OR`、分组节点 `AND / OR`、打卡天数、连续打卡、阶段问卷、分享次数、完成咨询和购买商品六类条件。
3. 编辑器编译结果仍写入 `ruleForm.payloadText`，发布继续走 `POST /api/v1/admin/campaign-rules/publish` 和 Settlement Module 的 `conditions` Interface，不新增前端私有规则路径。
4. 分组节点输出 `{ logic, label, conditions }`，根节点为 `AND` 时继续输出旧兼容数组，根节点为 `OR` 时输出显式条件树，旧规则版本无需迁移。
5. Admin 自检已新增拖拽规则树契约，Admin build 和最终验收会覆盖该页面不退回纯手写 JSON。

本轮未完成但已保留：

1. 更复杂的跨层拖拽、可视化条件预览、规则版本 diff 和运营审批流仍属于后台体验增强，不影响当前本地开发完成判断。

## 12. 开发顺序建议

### 第一阶段：P0 地基

1. DEV-0001 到 DEV-0004。
2. DEV-1001 到 DEV-1005。
3. 最小注册授权页和用户生命周期后台查询。

交付标准：

- 用户可进入 myRoot，生成 `root_user_id`。
- 无 `unionid` 时继续使用，不阻塞。
- 不要求订单绑定。

### 第二阶段：P1 路演可用

1. DEV-2001 到 DEV-2005。
2. DEV-3001 到 DEV-3007。
3. DEV-4001 到 DEV-4012 的用户端页面。

交付标准：

- 企微推送进入 myRoot。
- 用户看活动、看商品、跳 Root 会员中心购买。
- 用户可打卡、问卷、分享、咨询。
- 20 左右并发下不依赖外部有赞实时返回。

### 第三阶段：P2 结算可用

1. DEV-5001 到 DEV-5006。
2. DEV-6003 到 DEV-6008 的后台最小版本。

交付标准：

- 运营可配置 7/14/21 天规则。
- 条件和奖励都可配置。
- 用户达标后生成结算记录和奖励记录。
- 免单机会和异常进入人工复核。
- 运营可在过渡后台完成单人预览和复核关闭；批量动作进入下一轮。

### 第四阶段：P3 运营增强

1. DEV-6009 到 DEV-6010。
2. DEV-7001 到 DEV-7007。

交付标准：

- 有赞商品、订单、客户、优惠券逐步自动化。
- `unionid` 认证通过后完成补链。
- 后台能查看 Adapter 运行、失败重试和数据漏斗。

## 13. 测试与验收矩阵

| 测试层 | 覆盖内容 | 命令或方式 |
| --- | --- | --- |
| Backend Unit | Identity、Task Progress、Settlement、Reward Grant | `cd backend && npm test` |
| Backend HTTP | 登录、商品、任务、结算、后台写操作 | `backend/tests/api.test.js` |
| Mini Program Static | 页面路径、基础语法、路由 | `cd miniprogram && npm run check` |
| End-to-End 手工 | 企微进入、授权、商品跳转、打卡、问卷、结算 | 微信开发者工具 |
| Adapter Sample | 有赞商品、订单、客户、券样本 | 后台 Adapter 样本预览 |
| Release | 全量检查 | `npm run verify` |

必须补充的测试场景：

1. 无订单用户完成打卡和问卷。
2. 用户跳转有赞购买但订单未同步，前台仍可继续任务。
3. 同一用户重复提交今日打卡，不重复计数。
4. 7 天规则、14/21 天规则和任选互动 OR 规则用同一条件 Interface 配置。
5. 奖励发放重复调用不会生成重复 `reward_grant`。
6. 奖励配置带 `stockLimit/quotaKey` 时，超过上限不会继续生成 `reward_grant`。
7. `unionid` 后补链不会创建第二个用户。
8. 有赞 Adapter 失败不会影响首页、任务中心和奖励页读取。

## 14. 未做事项台账

| 编号 | 未做事项 | 放入批次 | 触发条件 |
| --- | --- | --- | --- |
| T-001 | 微信开放平台认证后的 `unionid` 实测，使用 CloudBase 身份透传探针留存脱敏证据 | B7 | 认证通过 |
| T-002 | Root 会员中心小程序跳转参数实测与证明录入 | B2/B4/B7 | B7.83 已提供证明记录 Interface；拿到正式 appid、页面路径和体验版跳转截图/链接后录入 |
| T-003 | 有赞商品字段样本 | B2/B7 | 有赞云商品权限可用 |
| T-004 | 有赞订单字段样本 | B7 | 订单权限可用 |
| T-005 | 有赞券发放与状态查询真实执行证据 | B5/B7 | B7.86 已提供动作 Adapter 校准 Gate；优惠券权限和 URL/token 可用后执行小批量发券/状态查询并重新生成证据包 |
| T-006 | 企微咨询跳转、标签写入、联系回写和自动触达真实执行证据 | B4/B7 | B7.86 已提供动作 Adapter 校准 Gate，B7.97 已提供自动触达队列与 Job；确认企微活码/客服链接、标签 ID、回写/触达 URL、token、模板后执行小批量校准 |
| T-007 | OPLUS SANS 小程序字体加载验证 | B4 | 开发者工具真机预览 |
| T-008 | 旧静态后台下线决策 | B6/B7 | B7.87 已提供下线决策记录 Interface；Element Plus Admin 灰度稳定且 `/admin-legacy` 无日常依赖后录入真实 `APPROVED` 决策，删除前必须填写证据引用和回滚引用 |
| T-009 | CloudBase 环境与生产 Store Adapter 生产配置 | B1/B7/生产 | B7.81 已接入决策 Gate；生产前配置 `ROOT_CLOUDBASE_*` 变量、备份/回滚计划和证明引用 |
| T-010 | 旧 7 日试饮历史数据迁移执行决策与真实执行历史 | B7/生产 | B7.84 已提供决策记录 Interface，B7.85 已提供执行历史记录 Interface；生产前录入只读归档、选择性补迁或人工处理决策，并补录真实执行证据 |

## 15. 立即下一步

本地开发动作当前已推进到 B7 第一百段。后续继续开发时按两类处理：

1. 本地既定开发动作已收口；后续新增需求单独拆分。
2. 不纳入当前本地开发完成判断：T-001 到 T-010 的微信开放平台、有赞、企微、CloudBase、字体真机预览和生产证据补录。
3. 每次继续开发前先从延期台账选择一项，完成后同步 `development_breakdown.md`、`release_readiness.md` 和延期台账。
