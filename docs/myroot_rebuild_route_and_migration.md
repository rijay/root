# myRoot 重构路径映射与迁移策略

版本：V0.1
日期：2026-06-19
状态：B0/B1/B2/B3/B4/B5/B6/B7 第八十五段已接入，`MYROOT_REBUILD_ENABLED` 可灰度
关联拆包：[myroot_rebuild_development_breakdown_v1.md](./myroot_rebuild_development_breakdown_v1.md)

## 1. Feature Flag

`MYROOT_REBUILD_ENABLED` 用于灰度新 myRoot 重构流程。

| 值 | 行为 |
| --- | --- |
| 未设置或非 `false` | 使用新 myRoot 路由，未完成授权/画像用户进入 `pages/register/index` |
| `false` | 保留旧流程，未完成用户回到 `pages/home/index` |

该开关目前控制登录返回的 `nextRoute` 和 `/api/v1/user/state` 的 `route`。数据写入仍会补齐新身份模型，避免灰度期间产生两套主键。

## 2. Canonical 页面映射

| 业务页面 | Canonical 路径 | 旧路径处置 |
| --- | --- | --- |
| 活动首页 | `pages/home/index` | 保留并逐步替换旧 7 日试饮首页内容 |
| 商品与购买跳转 | `pages/products/index` | B2 已新增；旧首页店铺入口已改为进入商品页 |
| 任务中心 | `pages/tasks/index` | B4 已新增；旧打卡入口继续保留为历史兼容 |
| 结算奖励 | `pages/rewards/index` | B5 已接入真实结算状态、奖励承诺和人工复核记录 |
| 注册授权 | `pages/register/index` | 已从旧身体画像问卷改为授权页 |
| 商品详情 | `pages/product-detail/index` | B2 已新增；后续如页面体积增大再迁入 subpackage |
| 打卡提交 | `subpkg/task/pages/checkin/index` | B4 已新增，旧 `subpkg/checkin/pages/today/index` 暂保留 |
| 阶段问卷 | `subpkg/task/pages/questionnaire/index` | B4 已新增，新旧问卷均可写任务事实 |
| 有赞订单同步 | `subpkg/profile/pages/orders/index` | B7 第二十二段已新增同步说明、状态解释和异常退路 |
| 用户咨询 | `subpkg/profile/pages/support/index` | B7 第二十一段已新增咨询主题、任务事实记录和客服入口；B7 第二十三段已新增咨询跟进状态 |
| 状态复核 | `subpkg/profile/pages/review/index` | B7 第二十段已新增，展示复核原因、结算和奖励状态；B7 第二十四段已新增 SLA、预计处理时间和运营备注；B7 第七十八段已新增复核解释模板和证据说明；B7 第七十九段已新增后台模板校准面板 |
| 进度详情 | `subpkg/task/pages/progress/index` | B4 已新增 |

## 3. 旧流程冻结策略

1. 旧 7 日试饮打卡、退款、优惠券路径暂不删除，保证现有测试与历史用户可回归。
2. 新用户主流程不再要求订单匹配才能参与 myRoot 任务。
3. 旧 `pages/order/match` 不再作为新主流程前置入口，后续只作为历史订单手动处理页或被订单同步页替代。
4. 旧身体画像问卷不再放在 `pages/register/index`，后续作为可配置问卷进入 Task Progress Module。

## 4. 数据迁移策略

本轮采用兼容式迁移：

1. 新增 `rootUsers`、`wechatIdentities`、`userContactMethods`、`userLifecycleEvents`。
2. 旧 `users.user_id` 与新 `root_user_id` 暂时保持同值，保护订单、打卡、问卷、后台详情等旧引用。
3. 新登录写入时自动补齐新身份数据；旧用户再次登录时自动补齐 `rootUsers` 和联系人证据。
4. 历史 `checkinSessions`、`couponEvents`、`refundWorkItems` 暂不批量写入补迁；B3 已开始把新提交桥接到 `campaign_participant` 与 `task_event`，B5 已提供 `settlement_record` 与 `reward_grant`，B7 第八十段已提供只读旧数据迁移评估并纳入发布记录/证据包，B7 第八十四段已提供旧数据生产处置决策记录，B7 第八十五段已提供旧数据生产处置执行历史记录；真实写入型补迁仍需生产快照、dry-run、签字和真实生产执行证据。
5. B6 第一段已提供后台运营配置工作台，B6 第二段已新增 `admin/` Element Plus Admin 首个运营配置 Module，B6 第三段已新增用户生命周期 Module，B6 第四段已新增批量结算动作，B6 第五段已新增最小角色权限、批量复核和审计检索；B7 第一段已新增奖励发放人工确认/失败重试闭环，B7 第二段已接出有赞优惠券 HTTP Adapter，B7 第三段已接出有赞商品/SKU 同步 Adapter，B7 第四段已接出有赞客户镜像与订单补链 Adapter，B7 第五段已接出有赞券状态查询与回写 Adapter，B7 第六段已接出企微标签发放 Adapter，B7 第七段已接出有赞订单增量同步运营入口，B7 第八段已接入 Element Plus Adapter 运行页，B7 第九段已接入运行详情与重跑动作，B7 第十段已接入运行取样评审明细和 `runId` 深链，B7 第十一段已接入有赞客户镜像与订单补链排查 UI，B7 第十二段已接入有赞券状态查询 UI，B7 第十三段已接入企微标签 UI，B7 第十四段已接入 Adapter 人工回滚动作，B7 第十五段已接入字段级快照回滚，B7 第十六段已接入原始样本行排查，B7 第十七段已接入真实 Adapter 失败重试策略，B7 第十八段已接入运营数据漏斗首版，B7 第十九段已接入运营趋势、预警、导出和自动刷新，B7 第二十段已接入用户端状态复核页，B7 第二十一段已接入用户端咨询页，B7 第二十二段已接入用户端订单同步页，B7 第二十三段已接入咨询跟进状态，B7 第二十四段已接入复核 SLA 与运营备注展示，B7 第二十五段已接入 Adapter 到期自动重试调度器，B7 第二十六段已接入 CloudBase/cron 可调用的 Adapter 重试 Job Interface，B7 第二十七段已接入运营图表化与来源分群留存，B7 第二十八段已接入运营预警阈值配置与 Job Interface，B7 第二十九段已接入预警负责人路由与 Adapter 重试耗尽告警，B7 第三十段已接入运营预警命令行运行器，B7 第三十一段已接入 CloudBase Job 发布 Manifest，B7 第三十二段已接入 Production Env Matrix，B7 第三十三段已接入 CloudBase 身份透传探针，B7 第三十四段已接入 Element Plus 开发发布页，B7 第三十五段已接入 Element Plus 菜单级权限隐藏，B7 第三十六段已把 `/admin` 接为 Element Plus Admin 主入口并保留 `/admin-legacy` 回退，B7 第三十七段已补 backend-only 部署包内置 Admin dist，B7 第三十八段已接入 Element Plus 按钮级权限提示与写入 Interface 能力补强，B7 第三十九段已接入用户生命周期完整筛选，B7 第四十段已接入用户生命周期筛选 CSV 导出，B7 第四十一段已接入用户生命周期当前列表批量结算入口，B7 第四十二段已接入用户生命周期常用筛选，B7 第四十三段已接入用户生命周期筛选全量批量结算入口，B7 第四十四段已接入用户生命周期结算队列，B7 第四十五段已接入生命周期结算队列 CloudBase/cron 自动调度，B7 第四十六段已接入生命周期结算队列失败/卡住站内预警，B7 第四十七段已接入外部预警 Webhook Adapter，B7 第四十八段已接入生命周期结算队列超时清理，B7 第四十九段已接入用户生命周期团队共享筛选与排序置顶，B7 第五十段已接入用户生命周期定时导出，B7 第五十一段已接入用户生命周期复制筛选，B7 第五十二段已接入用户生命周期导出字段脱敏，B7 第五十三段已接入用户生命周期导出下载审批，B7 第五十四段已接入用户生命周期导出外部交付 Interface，B7 第五十五段已接入用户生命周期导出对象存储文件 Adapter，B7 第五十六段已接入用户生命周期导出过期清理，B7 第五十七段已接入 Element Plus 导出过期清理入口，B7 第五十八段已接入用户生命周期导出签名下载链接，B7 第五十九段已接入用户生命周期导出 Webhook 投递增强，B7 第六十段已接入用户生命周期导出交付重试/死信，B7 第六十一段已接入用户生命周期导出通道健康聚合，B7 第六十二段已接入用户生命周期导出交付健康预警，B7 第六十三段已接入发布记录外部通道与负责人证据，B7 第六十四段已接入发布证据包，B7 第六十五段已接入发布证据包后台入口，B7 第六十六段已接入发布证据包留档，B7 第六十七段已接入发布证据包留档取回，B7 第六十八段已接入发布签字记录，B7 第六十九段已接入发布签字 Gate，B7 第七十段已接入 Admin 迁移 Gate，B7 第七十一段已接入生产切换 Gate，B7 第七十二段已接入生产切换证明记录，B7 第七十三段已接入企微联系回写，B7 第七十四段已接入咨询顾问分配，B7 第七十五段已接入咨询 SLA 超时提醒，B7 第七十六段已接入咨询顾问工作台，B7 第七十七段已接入咨询 SLA 超时升级链路，B7 第七十八段已接入复核解释模板，B7 第七十九段已接入复核解释模板校准面板，B7 第八十段已接入旧数据迁移评估，B7 第八十一段已接入 CloudBase Store 决策 Gate，B7 第八十二段已接入 Root 会员中心购买跳转 Gate，B7 第八十三段已接入 Root 会员中心跳转证明记录，B7 第八十四段已接入旧数据生产处置决策记录；旧静态后台实际删除仍等生产稳定期和下线批准。

## 5. 当前已完成

| 编号 | 内容 | 状态 |
| --- | --- | --- |
| DEV-0001 | Canonical 路由确认 | 已完成本表 |
| DEV-0002 | 回归基线 | 已通过后端测试和小程序静态检查 |
| DEV-0003 | Feature Flag | 已接入 `MYROOT_REBUILD_ENABLED` |
| DEV-0004 | 数据迁移策略 | 已完成兼容式策略 |
| DEV-2001 | 商品镜像模型 | 已新增商品、SKU、活动商品关系和跳转日志 |
| DEV-2002 | 商品页 | 已新增 `pages/products/index` |
| DEV-2003 | 商品详情页 | 已新增 `pages/product-detail/index` |
| DEV-2004 | 有赞跳转 Interface | 已新增小程序 `youzan-jump` 工具 Module |
| DEV-2005 | 商品导入 MVP | 已新增后台手工 upsert HTTP Interface |
| DEV-3001 | Campaign 基础模型 | 已新增活动定义、参与记录和加入活动 Interface |
| DEV-3002 | Task Definition 模型 | 已支持打卡、问卷、分享、咨询、购买任务类型 |
| DEV-3003 | Task Event 幂等写入 | 已新增任务事实幂等键和重复提交保护 |
| DEV-3004 | 进度快照 | 已新增任务进度计算和快照写入 |
| DEV-4002 | 商品与购买跳转 | 已纳入 4 Tab |
| DEV-4003 | 任务中心 | 已新增 `pages/tasks/index` |
| DEV-4004 | 结算奖励 | 已新增 `pages/rewards/index` 并接入结算状态 |
| DEV-4007 | 打卡提交 | 已新增 `subpkg/task/pages/checkin/index` |
| DEV-4008 | 阶段问卷 | 已新增 `subpkg/task/pages/questionnaire/index` |
| DEV-4009 | 有赞订单同步 | 已新增同步说明、订单状态解释、物流明细和异常退路 |
| DEV-4010 | 用户咨询 | 已新增咨询主题、微信客服入口、`CONSULTATION` 任务事件和跟进状态 |
| DEV-4011 | 状态复核 | 已新增 `subpkg/profile/pages/review/index`，奖励页和“我的”页均可进入，已展示复核解释模板和证据说明 |
| DEV-4012 | 进度详情 | 已新增 `subpkg/task/pages/progress/index` |
| DEV-ADMIN-B7-ROLLBACK | Adapter 人工回滚动作 | 已新增运行级回滚 HTTP Interface、Element Plus 回滚按钮、幂等和审计 |
| DEV-ADMIN-B7-SNAPSHOT-ROLLBACK | Adapter 字段级快照回滚 | 已支持订单、履约、客户镜像和企微线索的导入前字段恢复 |
| DEV-ADMIN-B7-REVIEW-ROWS | 原始样本行排查 | 已支持 review rows、行筛选、关键字搜索和 raw/mapped JSON 对照 |
| DEV-ADMIN-B7-RETRY | 真实 Adapter 失败重试策略 | 已新增 retry 状态、尝试次数、建议重试时间、来源失败运行和页面展示 |
| DEV-ADMIN-B7-ANALYTICS | 运营数据漏斗 | 已新增后台只读漏斗、瓶颈、分布、最近活动、趋势、预警、CSV 导出和自动刷新 |
| DEV-ADMIN-B7-ALERTS | 运营预警阈值与 Job | 已新增预警规则配置、页面阈值表单、Job 预览/执行、通知记录、幂等和审计 |
| DEV-ADMIN-B7-ALERT-ROUTING | 预警负责人路由 | 已新增负责人字段、路由 Key、Adapter 重试耗尽告警、通知责任人快照和页面配置 |
| DEV-ADMIN-B7-ALERT-CLI | 运营预警命令行 Job | 已新增 `npm run operational-alerts --prefix backend`，支持 dry-run/execute、request_id 和报告退出码 |
| DEV-ADMIN-B7-CLOUDBASE-JOBS | CloudBase Job 发布 Manifest | 已新增 `npm run jobs:manifest --prefix backend`，集中校验定时 Job 频率、命令、环境变量和安全策略 |
| DEV-ADMIN-B7-PROD-ENV | 生产环境变量矩阵 | 已新增 `npm run production-env --prefix backend`，集中校验微信、MySQL、CloudBase Job、有赞、物流和企微变量 |
| DEV-ADMIN-B7-CLOUDBASE-IDENTITY | CloudBase 身份透传探针 | 已新增 `GET /api/v1/admin/cloudbase-identity-probe`，用于认证通过后验证 openid/unionid header 且只返回脱敏预览 |
| DEV-ADMIN-B7-RELEASE-WORKBENCH | Element Plus 开发发布页 | 已新增 release Module，集中展示发布记录、上线闸口、Production Env Matrix 和 CloudBase 身份探针 |
| DEV-ADMIN-B7-MENU-ACCESS | Element Plus 菜单级权限 | 已新增 `GET /api/v1/admin/me` 和按 capabilities 渲染菜单，viewer/finance/operator/admin 可见入口与后端能力一致 |
| DEV-ADMIN-B7-ADMIN-ENTRY | Element Plus Admin 主入口 | 已将 `/admin` 接到 Element Plus build，`/admin-legacy` 保留旧静态后台，`/admin/assets` 与旧 `/assets` 分离 |
| DEV-ADMIN-B7-ADMIN-BUNDLE | Admin build 部署包 | 已新增 `deploy:prepare-admin`，把 `admin/dist` 复制到 `backend/public/admin-dist`，backend-only 云托管镜像可直接服务 `/admin` |
| DEV-ADMIN-B7-BUTTON-ACCESS | Element Plus 按钮级权限 | 已新增前端 Admin Access Module，配置、Adapter、运营数据页的写按钮按 capabilities 禁用/提示，并补后端写入 Interface 能力校验 |
| DEV-ADMIN-B7-LIFECYCLE-FILTERS | 用户生命周期完整筛选 | 已新增活动、任务进度、咨询、结算、奖励、卡点、严重度和待办筛选，并由后端 Presenter 统一口径 |
| DEV-ADMIN-B7-LIFECYCLE-EXPORT | 用户生命周期筛选导出 | 已新增筛选结果 CSV 导出，复用后端生命周期筛选口径并进入 Element Plus 用户页 |
| DEV-ADMIN-B7-LIFECYCLE-SETTLEMENT | 生命周期列表批量结算 | 已把生命周期当前列表接入既有批量结算预览/执行 Interface，权限、幂等和审计继续由后端统一处理 |
| DEV-ADMIN-B7-LIFECYCLE-PRESETS | 用户生命周期常用筛选 | 已新增按操作人隔离的常用筛选保存、套用、更新、删除和审计 |
| DEV-ADMIN-B7-LIFECYCLE-PRESET-SHARING | 用户生命周期团队共享筛选与排序置顶 | 已新增团队共享、置顶、排序、跨操作人可见、创建者修改保护和 Element Plus 入口 |
| DEV-ADMIN-B7-LIFECYCLE-FILTER-BATCH | 用户生命周期筛选全量批量结算 | 已新增按当前筛选条件选人、独立 `selectionLimit`、预览/执行 Interface、Element Plus 入口、权限、幂等和审计 |
| DEV-ADMIN-B7-LIFECYCLE-JOBS | 用户生命周期结算队列 | 已新增筛选快照队列、分批执行、失败重试、取消、进度抽屉、权限、幂等和审计 |
| DEV-ADMIN-B7-LIFECYCLE-SCHEDULER | 生命周期结算队列自动调度 | 已新增 `POST /api/v1/jobs/lifecycle-settlement-due`、命令行 Runner、CloudBase Manifest 条目、调度预览/执行入口和最终验收 smoke |
| DEV-ADMIN-B7-LIFECYCLE-ALERTS | 生命周期结算队列预警 | 已新增失败/卡住两个 Operational Alerts 目标类型、默认规则、站内通知、负责人路由、页面配置和最终验收 smoke |
| DEV-ADMIN-B7-ALERT-WEBHOOK | 外部预警 Webhook Adapter | 已新增签名 Webhook Adapter、生产默认环境变量、规则级 URL 覆盖、外部回执/错误展示和最终验收 smoke |
| DEV-ADMIN-B7-LIFECYCLE-CLEANUP | 生命周期结算队列超时清理 | 已新增 `POST /api/v1/jobs/lifecycle-settlement-cleanup`、命令行 Runner、CloudBase Manifest 条目、Production Env Matrix 阈值变量、清理预览/执行入口和最终验收 smoke |
| DEV-ADMIN-B7-LIFECYCLE-SCHEDULED-EXPORT | 用户生命周期定时导出 | 已新增导出记录 Module、`POST /api/v1/jobs/lifecycle-users-export`、命令行 Runner、CloudBase Manifest 条目、Production Env Matrix 变量、Element Plus 导出记录抽屉和最终验收 smoke |
| DEV-ADMIN-B7-LIFECYCLE-PRESET-COPY | 用户生命周期复制筛选 | 已新增复制常用筛选 Interface、团队模板复制为个人副本、越权复制保护、审计和 Element Plus 复制按钮 |
| DEV-ADMIN-B7-LIFECYCLE-EXPORT-SENSITIVITY | 用户生命周期导出字段脱敏 | 已新增导出策略 Module、默认脱敏、admin 显式原文、operator 降级、摘要/审计策略字段、CloudBase 变量和 Element Plus 策略展示 |
| DEV-ADMIN-B7-LIFECYCLE-EXPORT-APPROVAL | 用户生命周期导出下载审批 | 已新增审批状态、审批 Interface、`DATA_EXPORT_APPROVE` 能力、审批审计、Element Plus 审批动作、CloudBase 审批变量和最终验收 smoke |
| DEV-ADMIN-B7-LIFECYCLE-EXPORT-DELIVERY | 用户生命周期导出外部交付 Interface | 已新增交付 Module、交付状态、`/deliver` Interface、审批前拦截、Element Plus 交付动作、CloudBase 交付变量和最终验收 smoke |
| DEV-ADMIN-B7-LIFECYCLE-EXPORT-OBJECT-STORAGE | 用户生命周期导出对象存储文件 Adapter | 已新增 `putObject` Adapter seam、本地对象目录写入、metadata 文件、对象 key 清洗、CloudBase 对象目录变量和最终验收 smoke |
| DEV-ADMIN-B7-LIFECYCLE-EXPORT-CLEANUP | 用户生命周期导出过期清理 | 已新增 `deleteObject` Adapter seam、`POST /api/v1/jobs/lifecycle-user-exports-cleanup`、命令行 Runner、CloudBase Manifest 条目、Production Env Matrix 变量和最终验收 smoke |
| DEV-ADMIN-B7-LIFECYCLE-EXPORT-CLEANUP-UI | 用户生命周期导出过期清理页面入口 | 已新增 Element Plus 导出记录抽屉清理预览/执行按钮、权限禁用、结果提示和最终验收入口检查 |
| DEV-ADMIN-B7-LIFECYCLE-EXPORT-SIGNED-DOWNLOAD | 用户生命周期导出签名下载链接 | 已新增公开 signed-download Interface、HMAC 签名、TTL、CloudBase/Production Env 变量、Domain/API 测试和最终验收 smoke |
| DEV-ADMIN-B7-LIFECYCLE-EXPORT-WEBHOOK | 用户生命周期导出 Webhook 投递增强 | 已新增 signed download payload、导出/请求头、通道/模板变量、响应摘要、Domain/API 测试和最终验收 smoke |
| DEV-ADMIN-B7-LIFECYCLE-EXPORT-DELIVERY-RETRY | 用户生命周期导出交付重试/死信 | 已新增 `RETRY_SCHEDULED`/`DEAD_LETTER` 状态、到期重试 Job、命令行 Runner、CloudBase/Production Env 变量、Domain/API 测试和最终验收 smoke |
| DEV-ADMIN-B7-LIFECYCLE-EXPORT-DELIVERY-ALERTS | 用户生命周期导出交付健康预警 | 已新增 `LIFECYCLE_EXPORT_DELIVERY_HEALTH` 预警目标、死信/到期重试默认规则、负责人路由、Webhook payload 字段、Element Plus 规则选项、Domain/API 测试和最终验收 smoke |
| DEV-ADMIN-B7-RELEASE-CHANNEL-EVIDENCE | 发布记录外部通道与负责人证据 | 已新增发布记录 `externalChannelReadiness`、顶层阻塞字段、发布校准报告章节、Element Plus 阻塞项展示、Domain/API 测试和最终验收 smoke |
| DEV-ADMIN-B7-RELEASE-EVIDENCE-PACK | 发布证据包 | 已新增 `releaseEvidencePack` Module、`npm run release:evidence --prefix backend`、脱敏校验、专用测试和最终验收 smoke |
| DEV-ADMIN-B7-LEGACY-DATA-MIGRATION | 旧 7 日历史数据迁移评估 | 已新增只读 `legacyDataMigration` Module，纳入发布记录、发布证据包、Element Plus 发布页、Domain/API 测试和最终验收 smoke |
| DEV-ADMIN-B7-LEGACY-DATA-MIGRATION-DECISION | 旧数据生产处置决策记录 | 已新增 `legacyDataMigrationDecision` Module、`GET/POST /api/v1/admin/legacy-data-migration-decisions`、Element Plus 决策表单、审计、脱敏、幂等和旧数据 Gate 联动 |
| DEV-ADMIN-B7-LEGACY-DATA-MIGRATION-EXECUTION | 旧数据生产处置执行历史记录 | 已新增 `legacyDataMigrationExecution` Module、`GET/POST /api/v1/admin/legacy-data-migration-executions`、Element Plus 执行表单、审计、脱敏、幂等和旧数据 Gate 联动 |
| DEV-ADMIN-B7-CLOUDBASE-STORE | CloudBase Store 决策 Gate | 已新增 `cloudbaseStoreReadiness` Module，纳入 Production Env Matrix、发布记录、发布证据包、Element Plus 发布页、Domain/API 测试和最终验收 smoke |
| DEV-ADMIN-B7-ROOT-MEMBER-CENTER-JUMP | Root 会员中心购买跳转 Gate | 已新增 `rootMemberCenterReadiness` Module，纳入 Product Mirror 变量优先级、小程序占位配置校验、发布记录、发布证据包、Element Plus 发布页、Domain/API 测试和最终验收 smoke |
| DEV-ADMIN-B7-ROOT-MEMBER-CENTER-JUMP-PROOF | Root 会员中心跳转证明记录 | 已新增 `rootMemberCenterJumpProof` Module、`GET/POST /api/v1/admin/root-member-center-jump-proofs`、Element Plus 证明表单、审计、脱敏、幂等和购买跳转 Gate 联动 |
| DEV-ADMIN-B7-RELEASE-EVIDENCE-PACK-UI | 发布证据包后台入口 | 已新增 `GET /api/v1/admin/release-evidence-pack`、Element Plus 发布页证据包区块、JSON 下载、API 测试和最终验收 HTTP smoke |
| DEV-ADMIN-B7-RELEASE-EVIDENCE-ARCHIVE | 发布证据包留档 | 已新增 `releaseEvidenceArchive` Module、`POST /api/v1/admin/release-evidence-pack/archive`、最近留档表、审计、Schema、测试和最终验收 smoke |
| DEV-ADMIN-B7-RELEASE-EVIDENCE-ARCHIVE-DETAIL | 发布证据包留档取回 | 已新增 `GET /api/v1/admin/release-evidence-pack/archive?archiveId=...`、Element Plus 最近留档行级下载、Domain/API 测试和最终验收 smoke |
| DEV-ADMIN-B7-RELEASE-SIGNOFF | 发布签字记录 | 已新增 `releaseSignoff` Module、`POST /api/v1/admin/release-signoffs`、证据留档绑定、签字审计、Element Plus 发布签字卡片、Domain/API 测试和最终验收 smoke |
| DEV-ADMIN-B7-RELEASE-SIGNOFF-GATE | 发布签字 Gate | 已新增 `signoffGate` 发布判断摘要，纳入发布记录、发布证据包、Element Plus 发布页、Domain/API 测试和最终验收 smoke |
| DEV-ADMIN-B7-ADMIN-TRANSITION-GATE | Admin 迁移 Gate | 已新增 `adminTransitionReadiness` Module，纳入发布记录、发布证据包、Element Plus 发布页、Domain/API 测试和最终验收 smoke |
| DEV-ADMIN-B7-PRODUCTION-CUTOVER-GATE | 生产切换 Gate | 已新增 `productionCutoverReadiness` Module，纳入发布记录、发布证据包、发布校准报告、Element Plus 发布页、Domain/API 测试和最终验收 smoke |
| DEV-ADMIN-B7-PRODUCTION-CUTOVER-PROOF | 生产切换证明记录 | 已新增 `productionCutoverProof` Module、`GET/POST /api/v1/admin/production-cutover-proofs`、Element Plus 证明表单、审计、脱敏、幂等和发布 Gate 联动 |
| DEV-ADMIN-B7-LIFECYCLE-EXPORT-DELIVERY-HEALTH | 用户生命周期导出通道健康聚合 | 已新增通道健康 Interface、Element Plus 健康摘要、通道维度表、失败原因聚合、Domain/API 测试和最终验收 smoke |
| DEV-5001 | 规则版本模型 | 已新增 `campaign_rule_version` |
| DEV-5002 | 条件评估器 | 已支持 7/14/21 天等规则配置 |
| DEV-5003 | 结算记录 | 已新增 `settlement_record` 与状态查询 |
| DEV-5004 | 奖励承诺 | 已新增 `reward_grant` 与 `reward_delivery_job` |
| DEV-5005 | 奖励页 | 已接入真实结算/奖励/复核记录 |
| DEV-5006 | 人工复核 | 已新增 `manual_review_item` 后端第一段 |
| DEV-6003 | 活动配置 | 已在 `/admin` 运营配置 tab 提供过渡后台入口 |
| DEV-6004 | 任务配置 | 已在 `/admin` 运营配置 tab 提供过渡后台入口 |
| DEV-6005 | 商品镜像管理 | 已在 `/admin` 运营配置 tab 提供过渡后台入口 |
| DEV-6006 | 规则版本编辑 | 已支持规则 JSON 发布、版本展示和审计 |
| DEV-6007 | 结算预览与执行 | 已支持单人/批量结算预览与执行，批量执行带二次确认和 request_id 审计 |
| DEV-6008 | 奖励与复核 | 已支持奖励队列查看和人工复核关闭 |
| DEV-ADMIN-B6-EP | Element Plus Admin 骨架 | 已新增 `admin/` Vite/Vue/Element Plus 工程、校验脚本与 build 验证 |
| DEV-ADMIN-B6-LIFE | 用户生命周期页 | 已新增身份、UnionID、任务、结算、奖励和卡点工作台 |
| DEV-ADMIN-B6-BATCH | 批量结算 | 已新增批量预览、确认执行、幂等和审计 |
| DEV-ADMIN-B6-ACCESS | 最小角色权限 | 已新增多 token 角色能力模型，高风险后台写入按能力校验 |
| DEV-ADMIN-B6-REVIEW | 批量复核 | 已新增批量复核 HTTP Interface、Element Plus 多选处理、二次确认和幂等 |
| DEV-ADMIN-B6-AUDIT | 审计检索 | 已新增 Element Plus 审计记录页和批量复核/批量结算审计查询 |
| DEV-7005-A | 奖励发放人工 Adapter | 已新增奖励发放/失败重试 HTTP Interface、Element Plus 发放队列、审计和幂等 |
| DEV-7005-B | 有赞优惠券 HTTP Adapter | 已新增可配置发券 URL、token、字段路径和自动 Adapter 模式 |
| DEV-7002-A | 有赞商品/SKU 同步 Adapter | 已新增可配置商品 HTTP Adapter、预览/确认同步 Interface、Element Plus 商品同步入口、审计和幂等 |
| DEV-7004-A | 有赞客户镜像与补链 Adapter | 已新增客户镜像 Module、客户样本/HTTP Adapter、订单 yzUid 自动补链、客户镜像查询和校准检查 |
| DEV-7005-C | 有赞券状态查询 Adapter | 已新增可配置状态查询 URL、token、字段路径、人工回写、状态回写、审计和 Element Plus 查询 UI |
| DEV-7006-A | 企微标签发放 Adapter | 已新增可配置标签写入 URL、token、标签 ID、企微外部联系人匹配、人工回写和审计 |
| DEV-7006-B | 企微标签发放 UI | 已新增 Element Plus 标签提示、外部联系人提示、填入标签动作和发放字段提交 |
| DEV-ADMIN-B7-CONSULTATION-WEWORK-WRITEBACK | 企微联系回写 | 已新增咨询跟进待办写回 Module、`WEWORK_CONTACT_WRITEBACK` Adapter、后台查询/写入 Interface 和生命周期详情抽屉 |
| DEV-ADMIN-B7-CONSULTATION-ADVISOR-ASSIGNMENT | 咨询顾问分配 | 已新增顾问分配 Module、自动候选池、后台查询/写入 Interface 和生命周期详情抽屉 |
| DEV-ADMIN-B7-CONSULTATION-SLA | 咨询 SLA 超时提醒 | 已新增 SLA Module、后台查询 Interface、生命周期详情 SLA 面板和 `CONSULTATION_SLA_OVERDUE` 预警目标 |
| DEV-ADMIN-B7-CONSULTATION-ADVISOR-WORKBENCH | 咨询顾问工作台 | 已新增顾问工作台 Module、后台查询 Interface、顾问负载抽屉和未分配咨询分组 |
| DEV-ADMIN-B7-CONSULTATION-SLA-ESCALATION | 咨询 SLA 超时升级链路 | 已新增升级 Module、后台查询 Interface、顾问工作台升级区块和 `CONSULTATION_SLA_ESCALATION` 预警目标 |
| DEV-ADMIN-B7-MANUAL-REVIEW-EXPLANATION | 复核解释模板 | 已新增解释模板 Module、用户端证据说明、后台运营指引、可配置环境变量和后台模板校准面板 |
| DEV-7003-A | 有赞订单增量运营入口 | 已新增订单增量预览/确认同步 HTTP Interface、Adapter 选择、游标提交、审计和幂等 |
| DEV-ADMIN-B7-ADAPTER | Adapter 运行页 | 已新增 Element Plus Adapter catalog、订单增量同步、有赞客户镜像排查、运行台账筛选、游标查看、运行详情、取样评审明细、`runId` 深链、重跑动作和重试状态排查 |

## 6. 待后续批次处理

1. B7 第八十五段已接入旧数据生产处置执行历史记录；生产环境仍需把真实执行截图、链接或 CloudBase/对象存储留档录入后台。

1. B6/B7 后续补旧静态后台实际删除动作；团队共享筛选和排序置顶已在 B7 第四十九段接入，定时导出已在 B7 第五十段接入，复制筛选已在 B7 第五十一段接入，导出字段脱敏已在 B7 第五十二段接入，导出下载审批已在 B7 第五十三段接入，导出外部交付 Interface 已在 B7 第五十四段接入，导出对象存储文件 Adapter 已在 B7 第五十五段接入，导出过期清理已在 B7 第五十六段接入，导出过期清理页面入口已在 B7 第五十七段接入，导出签名下载链接已在 B7 第五十八段接入，导出 Webhook 投递增强已在 B7 第五十九段接入，导出交付重试/死信已在 B7 第六十段接入，导出通道健康聚合已在 B7 第六十一段接入，导出交付健康预警已在 B7 第六十二段接入，发布记录外部通道证据已在 B7 第六十三段接入，发布证据包已在 B7 第六十四段接入，发布证据包后台入口已在 B7 第六十五段接入，发布证据包留档已在 B7 第六十六段接入，发布证据包留档取回已在 B7 第六十七段接入，发布签字记录已在 B7 第六十八段接入，发布签字 Gate 已在 B7 第六十九段接入，Admin 迁移 Gate 已在 B7 第七十段接入，生产切换 Gate 已在 B7 第七十一段接入，生产切换证明记录已在 B7 第七十二段接入，企微联系回写已在 B7 第七十三段接入，咨询顾问分配已在 B7 第七十四段接入，咨询 SLA 超时提醒已在 B7 第七十五段接入，咨询顾问工作台已在 B7 第七十六段接入，咨询 SLA 超时升级链路已在 B7 第七十七段接入，复核解释模板已在 B7 第七十八段接入，复核解释模板校准面板已在 B7 第七十九段接入，旧 7 日历史数据迁移评估已在 B7 第八十段接入，CloudBase Store 决策 Gate 已在 B7 第八十一段接入，Root 会员中心购买跳转 Gate 已在 B7 第八十二段接入，Root 会员中心跳转证明记录已在 B7 第八十三段接入，旧数据生产处置决策记录已在 B7 第八十四段接入。
2. B4/B7 后续继续细化真实订单字段、售后状态、多包裹和游标口径；用户咨询页后续只保留企微真实 URL/token/模板校准、真实组织架构/企微会话字段校准和自动回写策略；状态复核页后续只保留真实运营模板口径校准。
3. B7 后续只保留真实生产校准项：Root 会员中心真实 appId/path 和体验版跳转证明录入、订单增量 live 字段/游标、券状态正式字段、企微标签字段、企微联系回写 URL/token/模板、正式有赞字段映射、正式 CloudBase 控制台触发器、告警渠道、CloudBase Store 生产变量/证明、真实外部交付 URL/模板、生产证明变量、旧 7 日历史数据真实执行证据录入。
4. 正式上线前需要用真实 CloudBase 环境调用 `GET /api/v1/admin/cloudbase-identity-probe`，验证 `x-wx-openid`、`x-wx-unionid` 透传；Element Plus 开发发布页已提供同一探针入口，真实 unionid 仍等待微信开放平台认证与应用绑定。
