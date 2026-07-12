# ROOT 后台运营工作台开发拆单

版本：V0.1
日期：2026-05-24
依据：[admin_ops_ui_ux_design.md](./admin_ops_ui_ux_design.md)、[admin_ops_ui_ux_design_review.md](./admin_ops_ui_ux_design_review.md)
状态：开发拆单；myRoot 重构 B7 第一百段已接入 Element Plus Admin、发布证据链、新版问卷答卷追溯、问卷分支题、Settlement AND/OR 条件树、后台 AND/OR 规则生成器、规则拖拽编辑器、奖励上限保护、奖励库存预占/释放、免单抽取与黑名单、奖励售后追回/库存回补、企微自动触达队列、订单售后状态镜像与追回联动、生产切换 Gate、生产证据收口、CloudBase Store 决策 Gate、旧数据迁移评估、旧数据生产处置决策记录、旧数据生产处置执行历史记录、旧静态后台下线决策记录、Root 会员中心购买跳转 Gate、Root 会员中心跳转证明记录、动作 Adapter 校准 Gate、生命周期运营能力和咨询/企微运营闭环；本地既定开发动作已收口，不再展开外部生产证据补录。
范围：`admin/` Element Plus Admin、`backend/public/admin.html`、`backend/public/admin.css`、`backend/public/admin.js`、后台运营相关后端 Module 与 HTTP Interface

2026-06-19 更新：

- myRoot 重构早期已在旧静态后台中新增 `运营配置` tab，先承接活动、任务、商品镜像、规则发布、单人结算预览、奖励队列和人工复核关闭；当前旧静态后台入口为 `/admin-legacy`。
- 已新增 `admin/` Vite/Vue/Element Plus 工程，首个 `ConfigWorkbench` Module 复用 Backend Admin Interface 承接运营配置。
- 已新增 `UserLifecycle` Module，复用 Backend Admin Interface 查看用户身份、UnionID、任务进度、结算奖励和当前运营卡点。
- 用户生命周期页已新增活动、任务进度、咨询状态、结算状态、奖励状态、当前卡点、严重度和待办筛选，筛选口径由后端 Presenter 统一输出。
- 用户生命周期页已新增筛选结果 CSV 导出，导出字段复用后端生命周期筛选口径；默认字段策略为 `MASKED`，admin 可显式请求 `RAW`，operator 等角色请求原文会降级。
- 用户生命周期页已新增导出记录抽屉，可按当前筛选生成定时导出记录、查看导出人数/截断状态/字段策略/审批状态/过期时间、下载 CSV 并记录下载审计；`POST /api/v1/jobs/lifecycle-users-export` 与 `npm run lifecycle-users-export --prefix backend` 可供 CloudBase/cron 定时生成记录，默认保留 7 天，`ROOT_LIFECYCLE_EXPORT_SENSITIVITY` 默认 `MASKED`，`ROOT_LIFECYCLE_EXPORT_APPROVAL_REQUIRED` 可要求下载先审批。
- 用户生命周期页已新增导出下载审批动作，admin/finance 具备 `DATA_EXPORT_APPROVE` 能力，可通过或拒绝待审批导出；operator 可生成默认脱敏导出但不能审批高风险下载。
- 用户生命周期页已新增导出交付状态和交付动作，当前默认生成内部下载链接交付记录；后端已提供 `POST /api/v1/admin/lifecycle-user-exports/deliver`，并支持 `ROOT_LIFECYCLE_EXPORT_OBJECT_DIR` 本地对象目录 Adapter；`WEBHOOK` 交付可携带 signed download payload、导出/请求头、通道/模板、响应摘要和签名预览，真实 COS/S3、邮件/企微平台 URL/模板后续复用同一交付 Interface。
- 用户生命周期导出已新增过期清理 Job、页面入口、签名下载链接、Webhook 投递增强、交付重试/死信、通道健康聚合和交付健康预警：`GET /api/v1/admin/lifecycle-user-exports/delivery-health`、`POST /api/v1/jobs/lifecycle-user-exports-cleanup`、`POST /api/v1/jobs/lifecycle-user-exports-delivery-retry`、`POST /api/v1/jobs/operational-alerts`、`npm run lifecycle-user-exports-cleanup --prefix backend`、`npm run lifecycle-user-exports-delivery-retry --prefix backend` 与 `npm run operational-alerts --prefix backend` 支持健康摘要、失败原因聚合、dry-run/execute、对象目录清理、失败保留记录、交付到期重试、`DEAD_LETTER`、默认预警规则、负责人路由、审计和 CloudBase Manifest；签名下载由 `ROOT_LIFECYCLE_EXPORT_DOWNLOAD_SECRET` 与 `ROOT_LIFECYCLE_EXPORT_SIGNED_DOWNLOAD_*` 控制，Webhook 投递由 `ROOT_LIFECYCLE_EXPORT_DELIVERY_WEBHOOK_CHANNEL`、`ROOT_LIFECYCLE_EXPORT_DELIVERY_WEBHOOK_TEMPLATE`、`ROOT_LIFECYCLE_EXPORT_DELIVERY_TIMEOUT_MS` 控制，交付重试由 `ROOT_LIFECYCLE_EXPORT_DELIVERY_RETRY_BATCH_SIZE`、`ROOT_LIFECYCLE_EXPORT_DELIVERY_MAX_ATTEMPTS`、`ROOT_LIFECYCLE_EXPORT_DELIVERY_RETRY_DELAY_SECONDS` 控制，外部运营预警由 `ROOT_OPERATIONAL_ALERT_WEBHOOK_*` 控制，真实 COS/S3/CloudBase 对象存储删除 Adapter、对象存储原生签名 URL、真实邮件/企微模板和控制台触发器仍待生产配置。
- 用户生命周期页已新增当前列表批量结算入口，复用既有批量结算预览/执行 Interface，权限、幂等与审计仍由后端统一处理。
- 用户生命周期页已新增常用筛选保存、套用、更新、复制和删除，按 Admin 操作人隔离，并写入保存/复制/删除审计；团队共享筛选和排序置顶已接入，其他操作人可套用团队筛选，也可复制为个人副本继续修改，但不能覆盖或删除创建者模板。
- 用户生命周期页已新增按当前筛选条件全量选人的批量结算入口，支持独立 `selectionLimit`、筛选预览、筛选执行和截断提示。
- 用户生命周期页已新增筛选结算队列，支持每批数量、队列抽屉、执行下一批、重试失败项、取消队列、调度预览和调度执行；`POST /api/v1/jobs/lifecycle-settlement-due` 与 `npm run lifecycle-settlement --prefix backend` 可供 CloudBase/cron 自动推进已创建队列；异常队列已进入 Operational Alerts 的失败/卡住站内预警，外部预警 Webhook Adapter 已接入；队列抽屉也已新增清理预览和超时清理，`POST /api/v1/jobs/lifecycle-settlement-cleanup` 与 `npm run lifecycle-settlement-cleanup --prefix backend` 可保守重置卡住队列，真实外部通道值和 CloudBase 控制台触发器仍待生产配置。
- 已新增批量结算能力，批量执行要求 `request_id` 与二次确认，并写入 `BATCH_SETTLEMENT_EXECUTE` 审计。
- 已新增最小角色权限、批量复核和审计检索页；批量复核要求 `request_id` 与二次确认，并写入 `BATCH_MANUAL_REVIEW_RESOLVE` 审计。
- 已新增奖励发放人工确认和失败重试，要求 `request_id` 与二次确认，并写入 `REWARD_DELIVERY_BATCH_EXECUTE` 审计。
- 已接出有赞优惠券 HTTP Adapter Seam；Element Plus Admin 默认人工确认，运营显式选择自动 Adapter 时才调用真实发券 Implementation。
- 已接出有赞券状态查询 HTTP Adapter Seam；后台 `POST /api/v1/admin/reward-delivery/status-query` 支持人工回写和自动查询，并已接入 Element Plus Admin 的奖励复核 Tab，记录状态查询审计。
- 已接出有赞商品/SKU HTTP Adapter Seam；Element Plus Admin 的“商品镜像”Tab 已支持商品同步预览、确认同步、二次确认和 `YOUZAN_PRODUCT_SYNC` 审计。
- 已接出有赞客户镜像 HTTP Adapter Seam；`GET /api/v1/admin/youzan-customers` 可查询客户镜像、补链状态和同 `yzUid` 订单摘要，订单导入时可用 `youzanYzUid` 触发 `AUTO_YOUZAN_CUSTOMER` 补链。
- 已接出企微标签 HTTP Adapter Seam；`WEWORK_TAG` 发放任务可走人工确认或真实企微标签写入 Implementation。
- Element Plus Admin 的“奖励复核”Tab 已支持企微标签发放 UI，展示标签/外部联系人提示，并可把 `externalContactId`、`tagId`、`tagName` 填入发放表单。
- 已新增有赞订单增量同步运营入口；`POST /api/v1/admin/orders/increment-preview` 与 `POST /api/v1/admin/orders/increment-execute` 支持预览、二次确认、游标提交、幂等和 `YOUZAN_ORDER_INCREMENT_SYNC` 审计。
- 已新增 Element Plus Admin 的 `AdapterRunPage`，支持订单增量预览/确认导入、有赞客户镜像排查、Adapter catalog、运行台账筛选、游标查看、运行详情、取样评审明细、`runId` 深链、重跑动作、重试状态排查和到期自动重试预览/执行。
- 已新增 Adapter 人工回滚动作；`POST /api/v1/admin/external-adapters/rollback` 支持按运行撤回本次 `IMPORT` 新建数据、回退安全游标、幂等和 `EXTERNAL_ADAPTER_RUN_ROLLBACK` 审计。
- Adapter 回滚已补齐字段级 before snapshot；订单、履约、有赞客户镜像和企微线索被错误更新后，可通过同一回滚动作恢复导入前字段。
- Adapter 运行详情已补齐原始样本行排查，可筛选问题行、错误、警告和已导入行，并对照 raw/mapped JSON。
- Adapter 运行台账已补齐 `retry_status`、`retry_attempt`、`retry_source_run_id`、`retry_reason` 和 `next_retry_at`，运营可区分可重试失败与需人工处理失败。
- 已新增 Adapter 到期自动重试调度器；`POST /api/v1/admin/external-adapters/retry-due` 支持 dry-run 预览和批量执行，跳过已有后续重试子运行或同一 Adapter 已有更新成功运行的旧失败记录。
- 已新增 `POST /api/v1/jobs/adapter-retry-due` 与 `npm run adapter-retry --prefix backend`，CloudBase 定时触发或运维 cron 可复用同一个到期重试 Interface，执行模式要求稳定 `request_id`。
- Element Plus Admin 已新增“运营数据”页，复用 Backend Admin Interface 查看路演漏斗、商品跳转、任务完成、结算奖励、瓶颈项、日期趋势、页面内预警、漏斗图表、趋势图表和来源分群留存，并支持 CSV 导出和自动刷新。
- 运营数据页已新增可配置预警规则、阈值表单、预警 Job 预览/执行和通知记录；`POST /api/v1/admin/operational-alert-rules/upsert` 与 `POST /api/v1/jobs/operational-alerts` 复用同一 Operational Alerts Module。
- 运营预警规则已新增负责人、联系方式、路由 Key 和 `ADAPTER_RETRY_EXHAUSTED` 目标类型；真实 Adapter 达到最大重试次数后会进入同一预警 Job，并在通知记录中保留负责人快照。
- 已新增 `npm run operational-alerts --prefix backend`，CloudBase 定时任务或运维 cron 可复用同一个运营预警 Job Interface，支持 dry-run/execute、稳定 `request_id` 和报告退出码。
- 外部预警推送已新增签名 Webhook Adapter，支持生产默认 URL/密钥/通道/模板/超时、规则级 URL 覆盖、外部回执/错误展示和命令行失败报告；真实企微/钉钉/短信 URL、密钥和模板仍需生产环境注入。
- 已新增 `npm run jobs:manifest --prefix backend`，把 Adapter 重试 Job、运营预警 Job、企微自动触达 Job、生命周期结算队列调度 Job、生命周期结算队列超时清理 Job 和用户生命周期定时导出 Job 的 CloudBase 频率、命令、环境变量、dry-run/execute 策略集中到发布 Manifest Module。
- 已新增 `npm run production-env --prefix backend`，把正式微信登录、MySQL、CloudBase Job、有赞、物流、企微、生命周期结算队列活动口径、清理阈值、定时导出口径和外部预警变量集中到 Production Env Matrix，并接入发布记录 evidence。
- 发布记录已新增外部通道与负责人证据，`GET /api/v1/admin/release-record` 会输出外部预警 Webhook、生命周期导出交付变量、预警负责人路由和导出交付健康摘要；发布校准报告也会输出“外部通道与负责人”章节。
- 已新增 `npm run release:evidence --prefix backend`，把发布记录、Production Env Matrix、CloudBase Job Manifest、Adapter 校准和外部通道负责人证据汇总为脱敏发布证据包，正式生产留档时不输出真实 token、secret、openid、unionid 或手机号原文。
- 已新增 `GET /api/v1/admin/release-evidence-pack` 与 Element Plus「开发发布」页证据包区块，运营和研发可在页面查看脱敏证据包状态、阻塞/提醒、留证命令并下载 JSON 留档。
- 已新增发布证据包后台留档：`POST /api/v1/admin/release-evidence-pack/archive` 可保存当前脱敏证据包，写入 `releaseEvidenceArchives` 和 `RELEASE_EVIDENCE_ARCHIVE_CREATE` 审计，Element Plus「开发发布」页可查看最近留档。
- 已新增发布证据包留档取回：`GET /api/v1/admin/release-evidence-pack/archive?archiveId=...` 可下载历史留档时刻的脱敏证据包，Element Plus「开发发布」页最近留档表已提供行级下载。
- 已新增发布签字记录：`POST /api/v1/admin/release-signoffs` 可将产品、运营、研发签字绑定到证据包留档，写入 `releaseSignoffs` 和 `RELEASE_SIGNOFF_RECORD` 审计，Element Plus「开发发布」页可查看并记录签字状态。
- 已新增发布签字 Gate：`releaseSignoff` Module 会按产品、运营、研发签字计算 `signoffGate`，生产缺签阻塞、灰度缺签待确认、拒绝签字阻塞，并纳入发布记录、发布证据包和 Element Plus「开发发布」页。
- 已新增动作 Adapter 校准 Gate：`actionAdapterCalibration` Module 会检查有赞发券、有赞券状态查询、企业微信标签写入和企业微信联系回写的运行配置与真实执行证据，结果纳入发布记录、发布证据包、发布校准报告和 Element Plus「开发发布」页。
- 已新增 Admin 迁移 Gate：`adminTransitionReadiness` Module 会检查 Element Plus Admin 模块覆盖、source dist、backend-only dist、`/admin-legacy` 回退和旧后台下线批准，结果纳入发布记录、发布证据包和 Element Plus「开发发布」页。
- 已新增生产切换 Gate：`productionCutoverReadiness` Module 会把微信开放平台、CloudBase unionid、Root 会员中心 appId、有赞、企微、CloudBase Job、外部通道、导出存储和回滚演练拆成生产证明项，结果纳入发布记录、发布证据包、发布校准报告和 Element Plus「开发发布」页。
- 已新增生产切换证明记录：`productionCutoverProof` Module、`GET/POST /api/v1/admin/production-cutover-proofs` 和 Element Plus 证明表单可记录 `VERIFIED` / `REJECTED` 证明，发布记录会把最新后台证明与 `ROOT_CUTOVER_*` 环境变量一起纳入 Gate 判断。
- 已新增 CloudBase Store 决策 Gate：`cloudbaseStoreReadiness` Module 会检查生产 Store 决策、CloudBase 环境 ID、地域、当前 Store Adapter、MySQL 变量、备份计划、回滚计划和生产证明，结果纳入 Production Env Matrix、发布记录、发布证据包和 Element Plus「开发发布」页。
- 已新增 Root 会员中心购买跳转 Gate：`rootMemberCenterReadiness` Module 会检查活跃商品、Root 会员中心 appId、商品购买路径和 appId 一致性，结果纳入 Product Mirror、发布记录、发布证据包、Production Env Matrix 可选说明组和 Element Plus「开发发布」页。
- 已新增旧 7 日历史数据迁移评估：`legacyDataMigration` Module 会只读评估旧 `checkinSessions`、旧打卡/问卷/券/退款事实与新任务/奖励/复核记录的桥接情况，结果纳入发布记录、发布证据包和 Element Plus「开发发布」页；真实补迁写入仍需生产快照、dry-run 和签字确认。
- 已新增 `GET /api/v1/admin/cloudbase-identity-probe`，用后台口令保护 CloudBase 身份透传探针，验证 `x-wx-openid`/`x-wx-unionid` 时只返回脱敏预览，不创建用户。
- Element Plus Admin 已新增“开发发布”页，复用发布记录、上线闸口和 CloudBase 身份透传探针 Interface，集中展示发布建议、阻塞项、Production Env Matrix 和探针状态。
- 已新增 `GET /api/v1/admin/me`，Element Plus Admin 根据当前 operator 的 capabilities 隐藏不可访问菜单，并展示 operator/role/local 状态。
- 已新增前端 Admin Access Module，配置、Adapter、运营数据页的写入按钮按 capabilities 禁用并显示缺权提示；后端也补齐订单补链确认、Adapter 重跑、样本导入、批次确认和修正应用等写入 Interface 的能力校验。
- Element Plus Admin build 已接入后端 `/admin` 主入口；`/admin-legacy` 保留旧静态后台，`/admin/assets` 从 `admin/dist/assets` 读取，dist 缺失时 `/admin` 回退旧后台。
- 已新增 `deploy:prepare-admin` 发布准备命令，把 `admin/dist` 复制到 `backend/public/admin-dist`；后端也支持 `ROOT_ADMIN_DIST_DIR` 指定 Admin build 目录。
- B7 第二十段已补齐用户端状态复核页；后台侧人工复核处理仍沿用现有奖励复核 Interface。
- B7 第二十四段已补齐 Manual Review SLA、预计处理时间和用户可见运营备注；B7 第七十八段已补齐复核解释模板、用户端证据说明和后台运营指引；B7 第七十九段已补齐模板校验与后台预览。
- B7 第二十一段已补齐用户端咨询页和 `CONSULTATION` 任务事实记录；B7 第二十三段已补齐 `CONSULTATION_FOLLOW` 待办、用户可见跟进状态和生命周期页待跟进指标；B7 第七十三段已新增企微联系回写 Module、`WEWORK_CONTACT_WRITEBACK` Adapter、`GET/POST /api/v1/admin/consultation-wework-writebacks` 和生命周期详情抽屉写回入口；B7 第七十四段已新增咨询顾问分配 Module、`GET/POST /api/v1/admin/consultation-advisor-assignments` 和生命周期详情抽屉分配入口；B7 第七十五段已新增咨询 SLA Module、`GET /api/v1/admin/consultation-sla`、`CONSULTATION_SLA_OVERDUE` 预警目标和生命周期详情抽屉 SLA 面板；B7 第七十六段已新增咨询顾问工作台 Module、`GET /api/v1/admin/consultation-advisor-workbench` 和用户生命周期页顾问工作台抽屉；B7 第七十七段已新增咨询 SLA 超时升级 Module、`GET /api/v1/admin/consultation-sla-escalations`、`CONSULTATION_SLA_ESCALATION` 预警目标和顾问工作台升级区块；B7 第七十八段已新增复核解释模板并接入奖励复核表，B7 第七十九段已新增模板校验和后台预览，真实 URL/token/模板、组织架构、在线状态和会话字段仍待生产校准。
- B7 第二十二段已补齐用户端订单同步页；后台侧订单增量和客户镜像排查仍沿用现有 Adapter 运行与客户镜像 Interface。
- 旧静态后台仍通过 `/admin-legacy` 保留回退；删除旧后台待生产稳定期和 `ROOT_LEGACY_ADMIN_DEPRECATION_APPROVED=true` 后决策。B7 第八十四段已接入发布证据链、CloudBase Store 决策 Gate、Root 会员中心购买跳转 Gate、Root 会员中心跳转证明记录、旧数据生产处置决策记录、生命周期运营能力、咨询/企微闭环和 Element Plus Admin 主入口；订单增量 live 校准、Root 会员中心 appId/path 与体验版跳转证明录入、企微联系回写真实 URL/token/模板校准、真实组织架构/企微会话字段校准、正式 CloudBase 控制台触发器创建、CloudBase Store 生产变量/证明配置、真实 CloudBase 身份透传实测、真实生产切换证明执行、真实告警渠道值和旧 7 日历史数据真实执行历史仍以 [myroot_rebuild_development_breakdown_v1.md](./myroot_rebuild_development_breakdown_v1.md) 的 B7 记录为准。
- B7 第八十五段已补旧数据生产处置执行历史记录；真实生产执行截图、链接或 CloudBase/对象存储留档仍需上线环境录入。
- B7 第八十六段已补动作 Adapter 校准 Gate；真实有赞发券、券状态查询、企微打标签和联系回写仍需生产 URL/token/字段映射与小批量成功回执。
- B7 第八十七段已补旧静态后台下线决策记录；Element Plus Admin 灰度稳定后，需在「开发发布」页录入真实 `APPROVED` 决策、证据引用和回滚引用，再安排删除 `/admin-legacy`。
- B7 第八十八段已补生产证据收口卡片；T-001 到 T-010 的外部证据可在「开发发布」页集中追踪，但真实证据仍需外部生产环境录入。
- B7 第八十九段已补新版问卷答卷追溯：小程序阶段问卷提交 `questionnaire_answer`，后端桥接 `QUESTIONNAIRE` 任务事实，用户生命周期详情抽屉可查看最近答卷摘要。
- B7 第九十一段已补 Settlement AND/OR 条件树：规则发布仍走既有后台 Interface，配置工作台按条件树叶子节点统计条件数量，旧平铺条件数组继续作为隐式 AND。
- B7 第九十二段已补后台 AND/OR 规则生成器：运营可在结算规则页勾选条件和奖励并生成规则 JSON，发布仍走 Settlement Module 的规则发布 Interface。
- B7 第九十三段已补奖励上限保护：规则生成器可输出 `stockLimit/quotaKey`，Reward Grant Module 超限时跳过奖励生成但不改变用户达标结算事实。
- B7 第九十四段已补奖励库存预占/释放：Reward Inventory Module 记录库存池与 reservation，复核拒绝限量奖励时释放库存名额。
- B7 第九十五段已补免单抽取与黑名单：规则生成器可输出 `chanceRate`，Reward Grant Module 对概率抽取、黑名单命中输出稳定 `SKIPPED`，不创建奖励、发放任务或人工复核。
- B7 第九十六段已补奖励售后追回/库存回补：Reward Recovery Module 记录追回台账，退款通过后撤销/追回奖励并释放限量库存名额。
- B7 第九十七段已补企微自动触达队列：WeWork Touch Module 统一计划、频控、队列、执行和审计；`POST /api/v1/jobs/wework-touch-due` 与 `npm run wework-touch --prefix backend` 可供 CloudBase/cron 执行，缺 `externalContactId` 会进入 `BLOCKED` 并支持补链后重新激活。
- B7 第九十八段已补订单售后状态镜像：Order After-Sales Module 记录售后单、状态映射、订单售后摘要、退款工作项同步和 Reward Recovery 联动；`GET/POST /api/v1/admin/order-after-sales*` 支持单条和批量同步。

## 1. 目标

把现有 `/admin` 从开发验收面板改造为 ROOT 小程序运营工作台。

本轮交付目标：

- 默认进入「今日运营」。
- 顶部提供 6 个 tab：今日运营、用户管理、订单匹配、打卡与反馈、免单与售后、开发与发布。
- 开发与发布内容从默认首页迁移到独立 tab。
- 新增面向运营的有赞订单手动匹配流程。
- 保持现有后台能力可用，不破坏上线闸口、Adapter 校准、真实样本导入和发布记录。

## 2. 开发原则

- 旧静态后台继续保留 `admin.html`、`admin.css`、`admin.js` 作为回退；新增运营能力优先迁入 `admin/` Element Plus Admin。
- 先做信息架构和可执行路径，再补视觉细节。
- 新增后端能力优先做深 Module，让页面只消费整理好的展示数据。
- 订单匹配能力不散落在页面逻辑里，应有独立 Module 承接预览、风险判断和确认写入。
- 不引入复杂权限、多运营账号和大型 BI 能力。

## 3. 现有能力盘点

### 可直接复用

- `GET /api/v1/admin/dashboard`
- `POST /api/v1/jobs/daily-audit`
- `POST /api/v1/jobs/adapter-retry-due`
- `GET /api/v1/admin/users/:userId/detail`
- `POST /api/v1/admin/users/:userId/follow`
- `POST /api/v1/admin/orders/sync`
- `POST /api/v1/admin/orders/fulfillment`
- `GET /api/v1/admin/tasks`
- `POST /api/v1/admin/tasks/:taskId/complete`
- `POST /api/v1/admin/tasks/:taskId/resolve`
- `POST /api/v1/admin/refunds/:refundId/approve`
- `POST /api/v1/admin/coupons/:couponId/use`
- `GET /api/v1/admin/launch-readiness`
- `GET /api/v1/admin/adapter-calibration`
- `GET /api/v1/admin/release-record`
- `GET /api/v1/admin/external-adapters`
- `GET /api/v1/admin/external-sample-reviews`
- `POST /api/v1/admin/external-samples/preview`
- `POST /api/v1/admin/external-samples/import`

### 需要新增或扩展

- 今日运营展示数据整理。
- 待匹配订单统计与列表。
- 异常反馈统计。
- 订单匹配搜索。
- 订单匹配预览。
- 订单匹配确认写入。
- 批量粘贴订单的运营入口。
- 前端 tab 状态与路由锚点。

## 4. 目标 Module 与 Interface

### 4.1 Admin Ops Presenter Module

位置建议：`backend/src/adminOpsPresenter.js`

Interface：

- `buildOpsDashboard(data, dateText)`
- `buildTaskPriority(task)`
- `buildOpsMetrics(data, summary)`
- `buildRiskFeedbackSummary(data)`

职责：

- 把今日运营需要的指标、待办优先级、待匹配订单和异常反馈整理成页面可直接渲染的数据。
- 保持运营展示文案与内部状态解耦。
- 让 `adminDashboard` 不继续膨胀成混杂实现。

### 4.2 Admin Order Matching Module

位置建议：`backend/src/adminOrderMatching.js`

Interface：

- `searchOrderMatchingCandidates(data, query)`
- `previewOrderMatch(data, body)`
- `confirmOrderMatch(data, body, dateText)`
- `bulkPasteOrders(data, body, dateText)`

职责：

- 搜索候选订单与候选用户。
- 判断手机号不一致、订单已绑定、用户已有活跃订单等风险。
- 输出匹配预览。
- 执行确认匹配或确认改绑。
- 复用现有 Order Fulfillment Module 写入订单和物流状态。

### 4.3 Admin View State Module

位置建议：`backend/public/admin.js` 内部对象，暂不拆文件。

Interface：

- `setActiveTab(tabId)`
- `renderActiveTab(data)`
- `refreshData()`
- `openUserDetail(userId)`
- `openOrderMatch(input)`

职责：

- 控制 6 个 tab 的显示、刷新、锚点和局部渲染。
- 避免每个按钮自行拼 DOM 和请求。

## 5. Batch 0：基线与结构准备

目标：先稳住现有后台，建立可迭代的页面结构。

任务：

- `DEV-ADMIN-0001` 记录当前后台截图和现有面板清单。
- `DEV-ADMIN-0002` 在 `admin.html` 建立 6 个 tab 的容器骨架。
- `DEV-ADMIN-0003` 在 `admin.js` 增加 tab 状态与渲染入口。
- `DEV-ADMIN-0004` 在 `admin.css` 增加 ROOT 后台设计变量、顶部栏、tab、工作区布局。
- `DEV-ADMIN-0005` 将现有渲染函数先迁移到对应 tab 容器，不改变数据逻辑。

验收：

- `/admin` 能正常打开。
- 6 个 tab 可以切换。
- 原有所有面板仍能渲染。
- 默认 tab 为「今日运营」。

验证：

- `npm test --prefix backend`
- `npm run verify`
- 本地打开 `http://127.0.0.1:8787/admin` 手动切换 6 个 tab。

## 6. Batch 1：今日运营工作台

目标：完成默认首页，运营者能一眼看到今天要处理什么。

任务：

- `DEV-ADMIN-1001` 新增 Admin Ops Presenter Module。
- `DEV-ADMIN-1002` 扩展 `adminDashboard` 返回 `opsDashboard`。
- `DEV-ADMIN-1003` 增加今日指标：今日应打卡、今日已打卡、今日未打卡、待处理任务、待匹配订单、待审核免单、已送达待开始、异常反馈。
- `DEV-ADMIN-1004` 增加待办优先级映射与运营文案。
- `DEV-ADMIN-1005` 今日运营 tab 渲染指标条、高优先级待办、订单匹配提醒、免单待审、异常反馈、已送达待开始。
- `DEV-ADMIN-1006` 待办动作文案调整为 `复制跟进话术`、`标记已联系`、`生成跟进待办`、`标记完成`、`跳过`。
- `DEV-ADMIN-1007` 点击指标后跳转到对应 tab 或筛选列表。

验收：

- 首屏不出现上线闸口、Adapter 校准、发布记录和真实样本导入。
- 今日运营指标与设计稿的数据定义一致。
- 高优先级待办按物流异常、订单冲突、异常反馈、免单待审、已送达未开始、今日未打卡、优惠券未使用排序。
- `联系用户` 文案不再出现。

后端测试：

- Admin Ops Presenter Module 的指标统计。
- 待匹配订单统计。
- 待审核免单统计。
- 已送达待开始统计。
- 待办优先级排序。

前端验证：

- 今日运营 tab 空状态。
- 有待办状态。
- 指标点击跳转。

## 7. Batch 2：订单匹配核心流程

目标：完成手动匹配有赞订单的主流程。

任务：

- `DEV-ADMIN-2001` 新增 Admin Order Matching Module。
- `DEV-ADMIN-2002` 新增订单匹配搜索 HTTP Interface。
- `DEV-ADMIN-2003` 新增订单匹配预览 HTTP Interface。
- `DEV-ADMIN-2004` 新增订单匹配确认 HTTP Interface。
- `DEV-ADMIN-2005` 前端实现订单匹配三列工作台。
- `DEV-ADMIN-2006` 前端实现“录入/更新订单”模式。
- `DEV-ADMIN-2007` 前端实现“匹配给用户”模式。
- `DEV-ADMIN-2008` 前端实现风险提示和二次确认。
- `DEV-ADMIN-2009` 前端实现匹配成功反馈。

建议 HTTP Interface：

- `GET /api/v1/admin/order-matching/search?q=&type=`
- `POST /api/v1/admin/order-matching/preview`
- `POST /api/v1/admin/order-matching/confirm`

预览返回建议：

- `order`
- `user`
- `risks`
- `recommendedAction`
- `writeEffects`
- `canConfirm`
- `requiresSecondConfirm`

风险类型建议：

- `ORDER_BOUND_TO_OTHER_USER`
- `PHONE_MISMATCH`
- `USER_HAS_ACTIVE_ORDER`
- `ORDER_NOT_DELIVERED`
- `FULFILLMENT_EXCEPTION`

验收：

- 可通过订单号搜索订单。
- 可通过手机号搜索用户和订单。
- 可只录入订单，不绑定用户。
- 可选择已有订单和用户生成匹配预览。
- 手机号不一致时必须出现风险提示。
- 订单已绑定其他用户时默认不可直接覆盖。
- 确认改绑必须填写备注。
- 已送达订单匹配后进入已送达待开始。
- 物流异常订单匹配后生成售后待办。

后端测试：

- 搜索候选订单。
- 搜索候选用户。
- 匹配预览无风险。
- 手机号不一致风险。
- 订单已绑定其他用户风险。
- 用户已有活跃订单风险。
- 确认匹配写入 `user_id`、`matched_at`、`match_source`。
- 确认改绑需要备注。
- 已送达匹配生成待办。
- 物流异常匹配生成待办。

前端验证：

- 三列工作台布局。
- 预览区风险态。
- 成功态按钮：查看用户详情、继续匹配下一单、返回今日运营。

## 8. Batch 3：批量粘贴订单

目标：把运营临时订单录入和开发样本导入分开。

任务：

- `DEV-ADMIN-3001` 在订单匹配 tab 增加 `批量粘贴订单`入口。
- `DEV-ADMIN-3002` 复用 External Adapter Sample Module 的订单解析能力，但不展示 Adapter 准入内容。
- `DEV-ADMIN-3003` 批量粘贴只支持 `YOUZAN_ORDER`。
- `DEV-ADMIN-3004` 粘贴后展示可写入订单、错误行、提醒行。
- `DEV-ADMIN-3005` 确认写入后进入待匹配订单列表。

建议 Interface：

- 可复用 `POST /api/v1/admin/external-samples/preview` 和 `import`，但前端文案与结果渲染走运营语义。
- 如复用导致字段过重，再在 Admin Order Matching Module 里封装 `bulkPasteOrders`。

验收：

- 运营 tab 不出现 Adapter、准入、状态映射、取样评审。
- `真实样本导入` 只在开发与发布 tab 出现。
- 批量粘贴订单后，可继续匹配给用户。

## 9. Batch 4：用户管理与用户详情重组

目标：让运营者能快速判断用户卡点。

任务：

- `DEV-ADMIN-4001` 用户管理 tab 增加搜索与筛选。
- `DEV-ADMIN-4002` 用户列表展示用户、手机号、当前状态、最近打卡、累计记录、订单状态、待办数。
- `DEV-ADMIN-4003` 用户详情改为运营视角分组。
- `DEV-ADMIN-4004` 用户详情顶部固定展示当前状态、当前卡点、下一步建议动作。
- `DEV-ADMIN-4005` 身体反馈画像仅展示参与原因、肠道状态、改善方式。
- `DEV-ADMIN-4006` 用户详情里提供 `生成跟进待办`。
- `DEV-ADMIN-4007` 后台运营日期展示接入中文日期格式。

验收：

- 用户详情不再把日常便型作为画像核心字段。
- 运营者打开用户详情后能看到“这个用户现在卡在哪”。
- 日期不直接展示 `YYYY-MM-DD`，开发与发布 tab 原始日志除外。

测试：

- `getAdminUserDetail` 返回字段不破坏。
- 用户详情空数据渲染。
- 画像字段展示。
- 日期展示格式。

## 10. Batch 5：打卡与反馈、免单与售后

目标：把运营常用处理入口从当前混合列表中拆清楚。

任务：

- `DEV-ADMIN-5001` 打卡与反馈 tab 渲染今日打卡列表。
- `DEV-ADMIN-5002` 打卡与反馈 tab 渲染异常反馈列表。
- `DEV-ADMIN-5003` 打卡与反馈 tab 支持生成跟进待办、复制跟进话术、标记已联系、标记已处理。
- `DEV-ADMIN-5004` 免单与售后 tab 渲染免单审核列表。
- `DEV-ADMIN-5005` 免单审核增加资格依据展示。
- `DEV-ADMIN-5006` 审核通过增加确认弹层和备注。
- `DEV-ADMIN-5007` 售后异常列表承接物流异常、订单冲突、用户反馈不适、收货信息不一致、免单争议。

验收：

- 免单审核前能看到完成天数、Day8、订单匹配、物流送达、断卡、重复退款等依据。
- 高风险动作需要确认。
- 跟进动作不暗示系统自动联系用户。

测试：

- 免单列表渲染。
- 审核通过流程。
- 跟进待办创建。
- 标记任务完成。

## 11. Batch 6：开发与发布 tab 迁移

目标：保留现有开发能力，但不占默认首页。

任务：

- `DEV-ADMIN-6001` 将上线闸口迁移到开发与发布 tab。
- `DEV-ADMIN-6002` 将发布记录迁移到开发与发布 tab。
- `DEV-ADMIN-6003` 将 Adapter 校准迁移到开发与发布 tab。
- `DEV-ADMIN-6004` 将真实 Adapter 接入迁移到开发与发布 tab。
- `DEV-ADMIN-6005` 将真实样本导入、Adapter 准入、取样评审台账迁移到开发与发布 tab。
- `DEV-ADMIN-6006` 开发与发布 tab 保留 Adapter、Interface、Implementation、Seam 等开发词。
- `DEV-ADMIN-6007` 其他运营 tab 不展示开发校准词。

验收：

- 默认首页不出现开发内容。
- 原有开发与发布能力仍可使用。
- 真实样本导入仍支持预览、导入、状态映射和评审台账。

回归：

- 真实样本导入路径。
- Adapter 准入展示。
- 上线闸口展示。
- 发布记录展示。

## 12. Batch 7：视觉收口与回归

目标：达到可继续上线审核前联调的后台质量。

任务：

- `DEV-ADMIN-7001` 移除大 hero，改为轻量顶部工作台。
- `DEV-ADMIN-7002` 统一 ROOT 色彩、按钮、状态、表格、面板、空状态。
- `DEV-ADMIN-7003` 检查桌面宽屏布局，不要求移动端完整适配。
- `DEV-ADMIN-7004` 检查所有异步动作的 loading、success、error。
- `DEV-ADMIN-7005` 文案检查：运营 tab 不出现自动触达承诺。
- `DEV-ADMIN-7006` 运行后端测试、最终验证和浏览器手工回归。

验收：

- 后台视觉与 ROOT 品牌一致。
- 信息密度适合运营重复使用。
- 页面没有明显重叠、溢出、空白断层。
- 所有 P0/P1 路径可操作。

验证命令：

```bash
npm test --prefix backend
npm run verify
```

手工回归：

- 打开 `http://127.0.0.1:8787/admin`。
- 切换 6 个 tab。
- 执行今日 Summary。
- 查看用户详情。
- 完成一个待办。
- 录入一个手动订单。
- 预览一次订单匹配。
- 完成一次无风险匹配。
- 验证一个风险匹配会进入二次确认。
- 查看开发与发布 tab 的上线闸口和真实样本导入。

## 13. 推荐执行顺序

1. Batch 0：后台 tab 骨架。
2. Batch 1：今日运营。
3. Batch 2：订单匹配核心流程。
4. Batch 3：批量粘贴订单。
5. Batch 6：开发与发布迁移。
6. Batch 4：用户管理与详情。
7. Batch 5：打卡反馈、免单售后。
8. Batch 7：视觉收口与回归。

说明：

- Batch 6 可提前，是因为它主要迁移现有面板，风险低，但能快速清空默认首页。
- Batch 4 和 Batch 5 可并行设计，但开发时建议在订单匹配稳定后再做。

## 14. 开发前待确认

以下问题不阻塞开工，但进入 Batch 2 前建议确认：

1. 订单改绑是否允许运营直接操作，还是只允许“确认改绑并备注”。
2. 批量粘贴订单是否首版只支持 CSV/TSV，不支持 JSON。
3. `标记已联系` 是否直接完成待办，还是只记录一次联系事件。
4. 免单拒绝是否本轮需要做，还是仅保留审核通过。
5. 后台是否需要在云托管生产环境增加最小访问保护。

## 15. 最小可交付版本

若要压缩首版范围，最小可交付版本建议只做：

- Batch 0
- Batch 1
- Batch 2
- Batch 6
- Batch 7 的基础回归

这样可以先交付一个真正可用的 ROOT 运营后台：

- 默认运营首页。
- 开发内容隔离。
- 手动匹配有赞订单。
- 现有后台能力不丢失。

## 16. B7.83 追加记录

「开发发布」页已新增 Root 会员中心跳转证明录入：运营或研发可选择商品，记录 `VERIFIED` / `REJECTED`、证据引用和备注；后台会脱敏 token、secret、openid、unionid 和手机号，并把最新证明纳入发布记录与证据包 Gate。

## 17. B7.84 追加记录

「开发发布」页已新增旧数据生产处置决策录入：运营或研发可记录只读归档、选择性补迁、人工处理或无旧数据的 `APPROVED` / `REJECTED` 决策；后台会脱敏证据、快照、dry-run 和备注引用，并把最新决策纳入旧数据迁移 Gate。

## 18. B7.85 追加记录

「开发发布」页已新增旧数据生产处置执行历史录入：运营或研发可记录无旧数据确认、只读归档完成、选择性补迁完成或人工处理完成的 `VERIFIED` / `FAILED` 结果；后台会脱敏执行引用、证据引用和备注，并要求生产目标存在旧数据时同时具备 `APPROVED` 决策和匹配动作的 `VERIFIED` 执行历史。

## 19. B7.86 追加记录

「开发发布」页已新增外部动作 Adapter 校准卡片：运营或研发可查看有赞发券、有赞券状态查询、企业微信标签写入和企业微信联系回写的配置检查、真实执行证据检查、阻塞和提醒。后台新增 `GET /api/v1/admin/action-adapter-calibration`，并把结果纳入发布记录、发布证据包、发布校准报告和最终验收；生产前仍需录入真实 URL/token/字段映射并执行小批量校准。

## 20. B7.87 追加记录

「开发发布」页的 Admin 迁移 Gate 已新增旧静态后台下线决策录入：运营或研发可记录 `APPROVED` / `REJECTED` 决策；`APPROVED` 必须填写下线证据引用和回滚引用。后台新增 `GET/POST /api/v1/admin/admin-legacy-deprecation-decisions`，并把最新决策纳入发布记录、发布证据包、Admin 迁移 Gate、审计和最终验收；生产稳定前仍保留 `/admin-legacy`。

## 21. B7.88 追加记录

「开发发布」页已新增生产证据收口卡片：运营或研发可集中查看 T-001 到 T-010 的外部证据状态、负责人、来源 Gate 和下一步动作。后台新增 `productionEvidenceIntake` Module，并把结果纳入发布记录、发布证据包、Markdown 报告和最终验收；真实 unionid、Root 会员中心、有赞、企微、CloudBase、旧数据和真机字体证据仍需生产环境补录。

## 22. B7.89 追加记录

用户生命周期详情抽屉已新增“新版问卷答卷”：展示用户最近 6 份 `questionnaire_answer`、问卷 ID、版本、提交时间、是否需要跟进和答案摘要。小程序阶段问卷页已改用 `POST /api/v1/questionnaire/answers`，后端统一做问卷定义校验、答卷留存、任务事实桥接和 `QUESTIONNAIRE_FOLLOW` 待办生成。

## 23. B7.91 追加记录

运营配置中的规则发布 Interface 已支持 AND/OR 条件树，后台配置工作台展示的 `conditionCount` 改为统计叶子条件数量；旧平铺数组规则仍按隐式 AND 处理，现有规则版本无需迁移。B7 第一百段已接入可视化规则拖拽编辑器，并继续复用 Settlement Module 的同一 Interface。

## 24. B7.92 追加记录

「运营配置 / 结算规则」页已新增 AND/OR 规则生成器：运营可选择全部满足或任一满足，勾选打卡、问卷、分享、咨询、购买条件，并组合有赞券、免单机会、积分和标签奖励。生成器只负责生成规则 JSON，发布仍通过 `POST /api/v1/admin/campaign-rules/publish`，不新增前端私有规则路径。

## 25. B7.93 追加记录

「运营配置 / 结算规则」页的规则生成器已新增“奖励上限”，可生成 `stockLimit` 与 `quotaKey`；后端 Reward Grant Module 会在奖励生成前按同活动同 quota 统计有效奖励数，超限时返回 `SKIPPED` 和跳过原因，不创建 `reward_grant` 或发放任务。独立库存预占/释放已在 B7.94 接入，免单抽取与黑名单已在 B7.95 接入，售后追回和库存回补已在 B7.96 接入。

## 26. B7.94 追加记录

后端已新增 Reward Inventory Module：限量奖励生成前会创建库存 reservation，`reward_grant` 记录关联 `inventory_reservation_id`；人工复核拒绝限量奖励时释放 reservation，后续达标用户可重新获得库存名额。该能力不依赖真实有赞或企微字段。

## 27. B7.95 追加记录

Reward Grant Module 已新增奖励资格判断：`chanceRate`、`selectionRate`、`lotteryRate`、`winRate`、`probability` 会转成确定性抽取分数，同一用户、活动、规则版本和奖励 Key 的抽取结果稳定；`blockedRootUserIds`、`blacklistRootUserIds`、`excludedRootUserIds` 命中时跳过奖励但保留达标结算事实。Element Plus Admin 规则生成器新增“免单抽取”比例，低于 100% 时输出 `chanceRate`。

## 28. B7.96 追加记录

后端已新增 Reward Recovery Module：退款或售后事实可调用同一追回 Interface，写入 `rewardRecoveryRecords`，同步更新 `reward_grant` 的 recovery 状态；未发放奖励直接撤销，已发放奖励进入待外部追回。退款审批通过时会自动释放限量奖励 reservation，让后续达标用户可获得回补库存。

## 29. B7.97 追加记录

后端已新增 WeWork Touch Module：`GET /api/v1/admin/wework-touch-jobs`、`POST /api/v1/admin/wework-touch-jobs/plan`、`POST /api/v1/admin/wework-touch-jobs/run` 和 `POST /api/v1/jobs/wework-touch-due` 支持咨询、问卷、Day8 收尾和人工复核待办的自动触达队列。`wework_touch_job` 记录模板、外部联系人、状态、幂等键和回执；`WEWORK_TOUCH` Adapter 支持真实 URL/token/字段映射，未配置时可用 `MANUAL` 模式本地确认。CloudBase Job Manifest、Production Env Matrix、Domain/API 测试和最终验收 smoke 已覆盖，真实企微发送配置与小批量回执仍归入生产证据。

## 30. B7.98 追加记录

后端已新增 Order After-Sales Module：`GET /api/v1/admin/order-after-sales`、`POST /api/v1/admin/order-after-sales/upsert` 和 `POST /api/v1/admin/order-after-sales/sync` 支持 Root 会员中心售后状态镜像。`order_after_sales_record` 保留售后单历史，`youzan_order` 保留当前售后摘要；`ROOT_AFTER_SALES_STATUS_MAP` 负责原始状态映射，`ROOT_AFTER_SALES_RECOVERY_STATUSES` 负责奖励追回触发，`ROOT_AFTER_SALES_FOLLOW_STATUSES` 负责售后跟进待办。退款成功类状态会同步本地退款工作项并复用 Reward Recovery Module 按订单证据追回奖励，`reward_grant.order_id` 用于避免同一用户跨订单误追回。真实售后 URL、游标、字段路径、多包裹/拆单样本仍归入生产校准。

## 31. B7.100 追加记录

「运营配置 / 结算规则」页已从轻量生成器升级为规则拖拽编辑器：运营可新增条件、新增分组、启停节点、上移/下移，并用 HTML5 拖放在同层重排。编辑器支持根节点和分组节点 `AND / OR`，条件覆盖打卡天数、连续打卡、阶段问卷、分享次数、完成咨询和购买商品。生成结果仍写入规则 JSON，发布仍通过 `POST /api/v1/admin/campaign-rules/publish`，不新增前端私有规则路径。
