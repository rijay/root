# ROOT 7 日打卡上线前验收清单

更新日期：2026-07-11
状态：P0/P1 本地实现、CloudBase MySQL 真实部署、20 并发写、双实例、滚动重启、关系表、小程序云调用、9 个定时 Job dry-run 和数据库隔离恢复均已验证；正式发布仍由真机购买跳转、真实外部 Adapter、execute 校准、完整业务回滚和签字 Gate 阻塞。既有产品、运营、Adapter、后台和发布 Gate 能力继续有效，本轮新增连接池、数据库级迁移锁、快照修订号行锁、提交后响应、核心关系表同事务同步和 `/ready` 证明；发布 Gate 不再接受只有 `ROOT_STORE_ADAPTER=mysql`、但无连接和迁移证据的配置。

最新生产只读状态与 `v0.5.6` 数据最小化迁移见 [2026-07-12 正式上线检查点](./formal_launch_checkpoint_2026-07-12.md)。

## 1. 当前结论

当前代码已经覆盖白板流程中的核心闭环：

1. 线下获客和企业微信承接先按人工记录处理。
2. 有赞订单先按 seed、手工同步、后台录入或订单增量运营入口处理。
3. 物流送达是 Day1 启动前置条件。
4. Day4 问卷不阻塞 Day5。
5. Day8 问卷是退款工作项前置条件。
6. daily audit 生成 Summary 和运营待办。
7. 后台可查看用户详情、反馈聚合、退款队列、优惠券转化。
8. Day6 优惠券不影响 Day7、Day8 和退款资格。

因此，当前版本适合：

1. 本地演示。
2. 小范围内部体验。
3. 运营流程试跑和话术校准。

当前版本不适合直接正式上线，除非先完成：

1. 体验版真机真实打开 Root 会员中心商品短链，并写入生产目标 `VERIFIED` 跳转证明；appId、购买路径和商品快照配置已完成。
2. 有赞订单和客户 Adapter 的真实字段、请求地址、token、数据路径、增量游标和小批量回执确认。
3. 有赞优惠券发放与状态查询 Adapter 的真实字段、券码路径、状态枚举和小批量回执确认。
4. 物流 Adapter 的真实字段、请求地址、密钥、数据路径和小批量回执确认。
5. 企业微信线索、标签、联系回写和自动触达 Adapter 的真实字段、凭据、外部联系人 ID、模板、顾问池、排班和小批量回执确认。
6. 真实外部 Adapter 就绪后，把 Job 从 dry-run 切到 execute，并验证负责人、告警路由、幂等和一键停用。
7. 完成包含外部 Adapter 回退、`MANUAL_SAMPLE`、字段快照一致性和运营人工兜底的完整业务回滚演练。
8. 确认数据保留、后台可见范围和外部通道负责人，并完成产品、运营、研发三方签字。

## 2. 自动验收

已新增 release smoke 测试：

```bash
npm test --prefix root_seven_day_checkin/backend
npm run check --prefix root_seven_day_checkin/miniprogram
```

覆盖：

1. `SHIPPED` 订单只能等待物流，不能误启动 Day1。
2. 物流改为 `DELIVERED` 后可启动 Day1。
3. Day4 待问卷不阻塞 Day5。
4. Day6 触发优惠券并可领取。
5. Day8 未提交时退款被阻断。
6. Day8 后生成退款工作项。
7. 已领取未使用优惠券进入 `COUPON_UNUSED` 待办。
8. 优惠券核销后自动关闭对应待办。
9. 退款通过后用户进入日常打卡。
10. 小程序 canonical 打卡路径指向 `subpkg/checkin/pages/*`。
11. JSON 文件 Adapter 能在 HTTP Interface 请求后保存变更，并在重启后恢复用户资料。
12. SQLite Adapter 能在 HTTP Interface 请求后事务保存变更，并在重启后恢复用户资料。
13. MySQL Adapter 可通过云托管 MySQL 环境变量启用，上线闸口会阻塞非 MySQL 的生产发布。
14. 有赞订单、物流状态和企业微信线索样本可先预览校验，再导入灰度数据仓库；样本支持 JSON、CSV 和表格文本。
15. 每次样本预览/导入会记录字段覆盖率、缺失项、未知状态枚举和决策状态。
16. 未知订单/物流状态可在后台保存映射，映射后重新预览样本。
17. 后台提供四类取样模板，避免运营导出字段缺失。
18. Adapter 准入会要求每类真实样本最新评审至少 3 条，且无未知枚举和必填字段缺口。
19. 上线闸口会把数据仓库 Adapter、微信登录密钥、后台访问口令、正式域名和样本评审转成 `READY`、`NEEDS_REVIEW`、`BLOCKED`。
20. 真实平台 Adapter 状态台会展示手工 Adapter、待配置真实 Adapter 和最近运行记录。
21. 真实平台 Adapter 运行失败也会落账；成功导入后会保存增量游标，下一次可从上次位置继续。
22. 有赞订单可通过可配置 HTTP Implementation 拉取，响应仍会进入样本校验、评审台账和 Adapter 准入。
23. 有赞客户可通过可配置 HTTP Implementation 拉取，响应仍会进入样本校验、客户镜像、用户补链和 Adapter 准入。
24. 有赞优惠券状态可通过可配置 HTTP Implementation 查询，也可由运营人工回写 `ISSUED/USED/EXPIRED/CANCELLED`，并进入奖励状态、外部状态和审计记录。
25. 物流状态可通过可配置 HTTP Implementation 拉取，响应仍会进入样本校验、履约更新、待办生成和 Adapter 准入。
26. 企业微信线索可通过可配置 HTTP Implementation 拉取，响应仍会进入样本校验、线索写入、人工匹配待办和 Adapter 准入。
27. 企业微信标签可通过可配置 HTTP Implementation 写入，也可由运营人工确认，并进入奖励发放、外部凭证和审计记录。
28. Adapter 校准会把样本准入、配置、真实 Adapter 状态、最近成功运行和游标转成只读检查结果。
29. 发布记录会把上线闸口、Adapter 校准、最近运行、签字位和回滚动作汇总成可评审凭证。
30. 有赞订单增量专用 Interface 可先预览再确认导入，执行要求 `request_id`、二次确认、幂等和 `YOUZAN_ORDER_INCREMENT_SYNC` 审计。
31. Element Plus Admin 的 Adapter 运行页可查看 Adapter 状态、运行台账、游标，并执行有赞订单增量预览/确认导入。
32. Adapter 运行台账支持运行详情抽屉、重新预览和重试导入，用于灰度校准时快速处理失败。
33. Adapter 运行详情可展开取样评审明细，并支持 `?module=adapters&runId=...` 深链定位某次运行。
34. Element Plus Admin 可查询有赞客户镜像，展示补链状态、同 `yzUid` 订单绑定摘要和下一步排查动作。
35. Element Plus Admin 可对有赞券发放任务执行自动状态查询或人工状态回写，并在奖励队列展示外部券状态。
36. Element Plus Admin 可对企微标签发放任务展示标签/外部联系人提示，并把 `externalContactId`、`tagId`、`tagName` 送入奖励发放 Interface。
37. Adapter `IMPORT` 运行可按 `run_id` 执行人工回滚，撤回本次新建的订单、履约、客户镜像或企微线索，并写入幂等审计。
38. Adapter 回滚可恢复本次导入前的订单、履约、有赞客户镜像和企微线索字段快照。
39. 取样评审详情可查看原始样本行、映射字段、错误和警告，用于真实平台字段校准。
40. 真实 Adapter 失败会记录 `MANUAL_REVIEW` 或 `RETRYABLE`，并保留尝试次数、建议重试时间和来源失败运行。
41. 后台运营数据漏斗可通过只读 Interface 汇总线索、注册、参与、商品跳转、订单、任务、结算和奖励发放，并展示瓶颈项。
42. 后台运营数据页可查看日期趋势、页面内预警，支持 CSV 导出和自动刷新。
43. 小程序状态复核页已纳入 canonical 路由、路由守卫、奖励页入口和个人中心入口静态校验。
44. 小程序咨询页已纳入客服入口、咨询主题、`CONSULTATION` 任务事件和可选任务进度 release smoke。
45. 小程序订单同步页已纳入同步说明、商品入口、人工协助退路和订单 Interface release smoke。
46. 咨询跟进状态已纳入 `GET /api/v1/user/consultations`、`CONSULTATION_FOLLOW` 待办和 Element Plus 生命周期页校验。
47. 状态复核页已纳入复核 SLA、预计处理时间、用户可见运营备注、复核解释模板、模板校准状态和 Manual Review Interface release smoke。
48. Adapter 到期自动重试调度器已纳入 `POST /api/v1/admin/external-adapters/retry-due`、dry-run 预览、批量执行、retry lineage 和最终验收 smoke。
49. Adapter 重试 Job 已纳入 `POST /api/v1/jobs/adapter-retry-due`、`npm run adapter-retry --prefix backend`、稳定 `request_id`、角色权限和最终验收 smoke。
50. 后台运营数据图表与来源分群留存已纳入 `GET /api/v1/admin/operational-analytics`、CSV 导出、Element Plus Admin 自检和最终验收 smoke。
51. 运营预警阈值配置与 Job 已纳入 `POST /api/v1/admin/operational-alert-rules/upsert`、`POST /api/v1/jobs/operational-alerts`、dry-run/execute、通知落账、幂等和最终验收 smoke。
52. 运营预警负责人路由、Adapter 重试耗尽告警、咨询 SLA 超时告警与咨询 SLA 升级告警已纳入 `GET /api/v1/admin/operational-analytics`、规则保存、通知负责人快照、`ADAPTER_RETRY_EXHAUSTED`、`CONSULTATION_SLA_OVERDUE`、`CONSULTATION_SLA_ESCALATION` 和最终验收 smoke。
53. 运营预警命令行 Job 已纳入 `npm run operational-alerts --prefix backend`、dry-run/execute、稳定 `request_id`、报告退出码和最终验收 smoke。
54. CloudBase Job 发布 Manifest 已纳入 `npm run jobs:manifest --prefix backend`、`ROOT_JOB_BASE_URL`、`ROOT_ADMIN_JOB_TOKEN`、11 个定时 Job 频率和最终验收 smoke。
55. Production Env Matrix 已纳入 `npm run production-env --prefix backend`、发布记录 evidence、发布校准报告和最终验收 smoke。
56. CloudBase 身份透传探针已纳入 `GET /api/v1/admin/cloudbase-identity-probe` 和最终验收 smoke；认证通过后用真实请求验证 `x-wx-openid`、`x-wx-unionid`，发布记录只保留脱敏预览。
57. Element Plus Admin 开发发布页已纳入发布记录、上线闸口、Production Env Matrix 摘要和 CloudBase 身份探针入口，并进入 Admin 自检与构建验证。
58. Element Plus Admin 菜单级权限已纳入 `GET /api/v1/admin/me`、角色 capabilities、Admin 自检和后端测试；正式环境的 viewer/finance/operator/admin 菜单可见性与后端能力一致。
59. Element Plus Admin 主入口已纳入 `/admin`、`/admin/assets`、`/admin-legacy` 和最终验收 smoke；构建产物缺失时 `/admin` 会回退旧后台，正式部署应携带 `admin/dist`。
60. backend-only Admin build 部署包已纳入 `deploy:prepare-admin`、`backend/public/admin-dist`、`ROOT_ADMIN_DIST_DIR` 和最终验收 `Backend admin dist bundle` 检查。
61. Element Plus Admin 按钮级权限已纳入前端 Admin Access Module、配置/Adapter/运营数据写按钮禁用提示、后端写入 Interface 能力校验、Admin 自检和后端 viewer 回归测试。
62. 用户生命周期完整筛选已纳入 `GET /api/v1/admin/lifecycle-users`、Element Plus 用户页筛选条、Domain/API 测试和最终验收 `lifecycle_filters` smoke。
63. 用户生命周期筛选导出已纳入 `GET /api/v1/admin/lifecycle-users/export`、Element Plus 用户页 `导出 CSV`、默认 `MASKED` 字段策略、admin 显式 `RAW`、operator 降级、导出下载审批、导出外部交付 Interface、Domain/API 测试和最终验收 `lifecycle_export` / `lifecycle_export_approval` / `lifecycle_export_delivery` smoke。
64. 用户生命周期当前列表批量结算已纳入 Element Plus 用户页、既有 `POST /api/v1/admin/settlement/batch-preview` / `batch-execute` Interface、`SETTLEMENT_EXECUTE` capability、Admin 自检和最终验收 `settlement_batch_preview` smoke；按筛选条件全量入口已在第 66 条补齐。
65. 用户生命周期常用筛选已纳入 `GET/POST /api/v1/admin/lifecycle-filter-presets*`、`adminLifecycleFilterPresets` 快照集合、Element Plus 用户页保存/套用/复制/删除、团队共享、置顶排序、跨操作人可见、创建者修改保护、团队模板复制为个人副本、越权复制保护、Domain/API 测试、Admin 自检和最终验收 `lifecycle_filter_presets` smoke。
66. 用户生命周期筛选全量批量结算已纳入 `POST /api/v1/admin/lifecycle-users/settlement-batch-preview` / `settlement-batch-execute`、独立 `selectionLimit`、Element Plus 用户页筛选预览/执行、Domain/API 测试、Admin 自检和最终验收 `lifecycle_filter_batch` smoke；手动分批队列已在第 67 条补齐。
67. 用户生命周期结算队列已纳入 `GET/POST /api/v1/admin/lifecycle-settlement-jobs*`、`adminLifecycleSettlementJobs` 快照集合、Element Plus 用户页队列抽屉、Domain/API 测试、Admin 自检和最终验收 `lifecycle_settlement_jobs` smoke；自动调度已在第 68 条补齐。
68. 用户生命周期结算队列自动调度已纳入 `POST /api/v1/jobs/lifecycle-settlement-due`、`npm run lifecycle-settlement --prefix backend`、CloudBase Job Manifest、Production Env Matrix、Element Plus 调度预览/执行入口、Domain/API 测试、Admin 自检和最终验收 `lifecycle_settlement_scheduler` smoke；真实 CloudBase 控制台触发器仍需生产配置。
69. 用户生命周期结算队列失败/卡住预警已纳入 Operational Alerts 的 `LIFECYCLE_SETTLEMENT_JOB_FAILED` / `LIFECYCLE_SETTLEMENT_JOB_STALLED`、默认规则、Element Plus 目标类型下拉、通知落账、Domain/API 测试、Admin 自检和最终验收 smoke；队列超时清理已在第 71 条补齐。
70. 外部预警 Webhook Adapter 已纳入 `WEBHOOK` 渠道、生产默认 URL/密钥/通道/模板/超时环境变量、HMAC-SHA256 签名、规则级 URL 覆盖、外部回执/错误展示、命令行失败报告、Domain/API 测试、Admin 自检和最终验收 smoke；真实企微/钉钉/短信 URL、密钥和模板仍需生产环境注入并验收。
71. 用户生命周期结算队列超时清理已纳入 `POST /api/v1/jobs/lifecycle-settlement-cleanup`、`npm run lifecycle-settlement-cleanup --prefix backend`、CloudBase Job Manifest、Production Env Matrix 阈值变量、Element Plus 清理预览/执行入口、Domain/API 测试、Admin 自检和最终验收 `lifecycle_settlement_cleanup` smoke；真实 CloudBase 控制台触发器、后台口令、清理阈值和执行历史仍需生产配置。
72. 用户生命周期定时导出已纳入 `GET/POST /api/v1/admin/lifecycle-user-exports*`、`GET /api/v1/admin/lifecycle-user-exports/delivery-health`、`POST /api/v1/jobs/lifecycle-users-export`、`npm run lifecycle-users-export --prefix backend`、`ROOT_LIFECYCLE_EXPORT_SENSITIVITY`、`ROOT_LIFECYCLE_EXPORT_APPROVAL_REQUIRED`、`ROOT_LIFECYCLE_EXPORT_DELIVERY_*`、`ROOT_LIFECYCLE_EXPORT_DOWNLOAD_SECRET`、`ROOT_LIFECYCLE_EXPORT_SIGNED_DOWNLOAD_*`、`ROOT_LIFECYCLE_EXPORT_OBJECT_*`、`ROOT_LIFECYCLE_EXPORT_OBJECT_DIR`、`ROOT_LIFECYCLE_EXPORT_DELIVERY_WEBHOOK_CHANNEL`、`ROOT_LIFECYCLE_EXPORT_DELIVERY_WEBHOOK_TEMPLATE`、`ROOT_LIFECYCLE_EXPORT_DELIVERY_TIMEOUT_MS`、`ROOT_LIFECYCLE_EXPORT_DELIVERY_RETRY_BATCH_SIZE`、`ROOT_LIFECYCLE_EXPORT_DELIVERY_MAX_ATTEMPTS`、`ROOT_LIFECYCLE_EXPORT_DELIVERY_RETRY_DELAY_SECONDS`、CloudBase Job Manifest、Production Env Matrix 导出口径变量、Element Plus 导出记录抽屉字段策略/审批/交付状态/通道健康展示、Domain/API 测试、Admin 自检和最终验收 `lifecycle_scheduled_export` / `lifecycle_export_object_storage` / `lifecycle_export_signed_download` / `lifecycle_export_webhook_delivery` / `lifecycle_export_delivery_retry` / `lifecycle_export_delivery_health` smoke；真实 CloudBase 控制台触发器、后台口令、活动口径、真实 COS/S3/CloudBase 对象存储 SDK Adapter、真实邮件/企微平台 URL/模板和执行历史仍需生产配置。
73. 用户生命周期导出过期清理已纳入 `POST /api/v1/jobs/lifecycle-user-exports-cleanup`、`npm run lifecycle-user-exports-cleanup --prefix backend`、`deleteObject` 对象存储 Adapter seam、`ROOT_LIFECYCLE_EXPORT_CLEANUP_LIMIT`、`ROOT_LIFECYCLE_EXPORT_OBJECT_CLEANUP_ENABLED`、CloudBase Job Manifest、Production Env Matrix、Domain/API 测试、Element Plus 导出记录抽屉清理预览/执行入口和最终验收 `lifecycle_export_cleanup` smoke；真实 COS/S3/CloudBase 对象存储删除 Adapter、对象存储原生签名 URL、对象生命周期规则、正式 CloudBase 控制台触发器和执行历史仍需生产配置。
74. 用户生命周期导出签名下载链接已纳入 `GET /api/v1/lifecycle-user-exports/:exportId/signed-download`、`ROOT_LIFECYCLE_EXPORT_DOWNLOAD_SECRET`、`ROOT_LIFECYCLE_EXPORT_SIGNED_DOWNLOAD_ENABLED`、`ROOT_LIFECYCLE_EXPORT_SIGNED_DOWNLOAD_TTL_SECONDS`、CloudBase Job Manifest、Production Env Matrix、Domain/API 测试和最终验收 `lifecycle_export_signed_download` smoke；链接不经过后台 admin 下载路径，但仍复用审批、过期保留、下载计数和审计。
75. 用户生命周期导出 Webhook 投递增强已纳入 `POST /api/v1/admin/lifecycle-user-exports/deliver`、signed download payload、导出/请求头、通道/模板环境变量、响应摘要、Domain/API 测试和最终验收 `lifecycle_export_webhook_delivery` smoke；真实邮件/企微 URL、模板内容、负责人名单和真实执行历史仍需生产环境注入和验收。
76. 用户生命周期导出交付重试/死信已纳入 `POST /api/v1/jobs/lifecycle-user-exports-delivery-retry`、`npm run lifecycle-user-exports-delivery-retry --prefix backend`、`RETRY_SCHEDULED`、`DEAD_LETTER`、`ROOT_LIFECYCLE_EXPORT_DELIVERY_RETRY_BATCH_SIZE`、`ROOT_LIFECYCLE_EXPORT_DELIVERY_MAX_ATTEMPTS`、`ROOT_LIFECYCLE_EXPORT_DELIVERY_RETRY_DELAY_SECONDS`、CloudBase Job Manifest、Production Env Matrix、Domain/API 测试和最终验收 `lifecycle_export_delivery_retry` smoke；真实 CloudBase 控制台触发器、真实邮件/企微平台 URL/模板、负责人名单和执行历史仍需生产配置。
77. 用户生命周期导出通道健康聚合已纳入 `GET /api/v1/admin/lifecycle-user-exports/delivery-health`、Element Plus 导出记录抽屉健康摘要、通道维度表、失败原因表、`RETRY_SCHEDULED` / `DEAD_LETTER` 状态展示、Domain/API 测试和最终验收 `lifecycle_export_delivery_health` smoke；真实通道 URL、模板、负责人名单和执行历史仍需生产配置。
78. 用户生命周期导出交付健康预警已纳入 Operational Alerts 的 `LIFECYCLE_EXPORT_DELIVERY_HEALTH` 目标类型、`op_alert_lifecycle_export_delivery_dead_letter` / `op_alert_lifecycle_export_delivery_due_retry` 默认规则、Element Plus 目标类型下拉、通知落账、Webhook payload 字段、Domain/API 测试和最终验收 `operational_alerts` smoke；真实邮件/企微/钉钉 URL、模板、负责人名单、签收策略和执行历史仍需生产环境注入并验收。
79. 发布记录外部通道证据已纳入 `GET /api/v1/admin/release-record` 的 `evidence.externalChannelReadiness`、顶层 `mustFixBeforeRelease` / `mustConfirmForGray` / `finalChecks`、Element Plus 开发发布页阻塞项展示、`npm run calibrate --prefix backend` 的“外部通道与负责人”章节、Domain/API 测试和最终验收 `release_record` smoke；真实负责人姓名/联系方式、外部 Webhook URL、模板、签收策略和执行历史仍需生产环境填写。
80. 发布证据包已纳入 `releaseEvidencePack` Module、`npm run release:evidence --prefix backend`、`GET /api/v1/admin/release-evidence-pack`、Element Plus 开发发布页证据包区块、JSON 下载、`POST /api/v1/admin/release-evidence-pack/archive`、`GET /api/v1/admin/release-evidence-pack/archive?archiveId=...`、`POST /api/v1/admin/release-signoffs`、`releaseEvidenceArchives` 留档、`releaseSignoffs` 签字、`signoffGate` 发布判断、`adminTransitionReadiness` Admin 迁移 Gate、`RELEASE_EVIDENCE_ARCHIVE_CREATE` 审计、`RELEASE_SIGNOFF_RECORD` 审计、历史留档下载、`--admin-token`、JSON/Markdown 输出、base_url 清洗、secret/身份原文泄露校验、专用测试和最终验收 `release_evidence_pack` HTTP smoke；真实生产证据仍需在 CloudBase、微信开放平台、有赞、企微和外部通道配置完成后重新生成、留档并记录签字，生产目标必须三方签字均通过后才可解除签字 Gate。
81. Admin 迁移 Gate 已纳入 `adminTransitionReadiness` Module、`GET /api/v1/admin/release-record` 的 `evidence.adminTransitionReadiness`、发布证据包 `summary.adminTransitionStatus`、Element Plus「开发发布」页 Admin 迁移卡片、Domain/API 测试和最终验收 `release_record` / `release_evidence_pack` smoke；旧静态后台仍保留 `/admin-legacy` 回退，正式删除需生产稳定期、下线证据和回滚引用。
82. 生产切换 Gate 已纳入 `productionCutoverReadiness` Module、`GET /api/v1/admin/release-record` 的 `evidence.productionCutoverReadiness`、发布证据包 `summary.productionCutoverStatus`、`npm run calibrate --prefix backend` 的“生产切换 Gate”章节、Element Plus「开发发布」页生产切换卡片、Domain/API 测试和最终验收 `release_record` / `release_evidence_pack` smoke；生产目标需补齐 `ROOT_CUTOVER_*` 证明变量后重新生成证据包、留档并签字。
83. 生产切换证明记录已纳入 `productionCutoverProof` Module、`GET/POST /api/v1/admin/production-cutover-proofs`、Element Plus「开发发布」页证明表单、审计、幂等、脱敏和生产切换 Gate 联动；证明来源可为 `ROOT_CUTOVER_*` 环境变量或后台最新 `VERIFIED` 记录，最新 `REJECTED` 记录会阻塞对应证明项，真实生产验收截图、链接和执行记录仍需人工补齐。
84. 企微联系回写已纳入 `consultationWeworkWriteback` Module、`WEWORK_CONTACT_WRITEBACK` Adapter、`GET/POST /api/v1/admin/consultation-wework-writebacks`、Element Plus 用户生命周期详情抽屉、Domain/API/Admin 自检和最终验收 `consultation_wework_writeback` smoke；真实 `WEWORK_CONTACT_WRITEBACK_URL`、token、模板、外部联系人字段、回执字段和执行历史仍需生产配置与验收。
85. 咨询顾问分配已纳入 `consultationAdvisorAssignment` Module、`GET/POST /api/v1/admin/consultation-advisor-assignments`、人工/自动候选池分配、Element Plus 用户生命周期详情抽屉、Domain/API/Admin 自检和最终验收 `consultation_advisor_assignment` smoke；若启用自动分配，需在生产确认 `ROOT_CONSULTATION_ADVISORS` 和真实组织架构口径。
86. 咨询 SLA 超时提醒已纳入 `consultationSla` Module、`GET /api/v1/admin/consultation-sla`、Element Plus 用户生命周期详情抽屉、`CONSULTATION_SLA_OVERDUE` 预警目标、Production Env Matrix、发布记录负责人路由、Domain/API/Admin 自检和最终验收 `consultation_sla_overdue` smoke；若调整 SLA，需在生产确认 `ROOT_CONSULTATION_SLA_MINUTES` 和 `ROOT_CONSULTATION_SLA_DUE_SOON_MINUTES`。
87. 咨询 SLA 超时升级链路已纳入 `consultationSlaEscalation` Module、`GET /api/v1/admin/consultation-sla-escalations`、Element Plus 顾问工作台升级区块、`CONSULTATION_SLA_ESCALATION` 预警目标、Production Env Matrix、发布记录负责人路由、Domain/API/Admin 自检和最终验收 `consultation_sla_escalation` smoke；若调整升级链路，需在生产确认 `ROOT_CONSULTATION_SLA_ESCALATION_RULES`、负责人路由和运营预警 Job 执行历史。
88. 旧 7 日历史数据迁移评估已纳入 `legacyDataMigration` Module、`GET /api/v1/admin/release-record` 的 `evidence.legacyDataMigration`、发布证据包 `summary.legacyDataMigrationStatus`、Element Plus「开发发布」页旧数据迁移卡片、Domain/API/证据包测试和最终验收 `legacy_data_migration_plan` smoke；当前只读评估不会写入补迁，真实生产执行需先确认生产快照、dry-run 和签字。
89. CloudBase Store 决策 Gate 已纳入 `cloudbaseStoreReadiness` Module、Production Env Matrix `cloudbase_store` 组、发布记录 `evidence.cloudbaseStoreReadiness`、发布证据包 `summary.cloudbaseStoreStatus`、Element Plus「开发发布」页 CloudBase Store 决策卡片、Domain/API/证据包/Admin 自检和最终验收 `release_record` / `release_evidence_pack` smoke；生产发布需补齐 `ROOT_CLOUDBASE_STORE_DECISION`、CloudBase 环境 ID、地域、备份计划、回滚计划和证明引用。
90. Root 会员中心购买跳转 Gate 已纳入 `rootMemberCenterReadiness` Module、Product Mirror 跳转变量优先级、Production Env Matrix `root_member_center_jump` 生产必过组、小程序占位 appid/path 校验、发布记录 `evidence.rootMemberCenterReadiness`、发布证据包 `summary.rootMemberCenterStatus`、Element Plus「开发发布」页购买跳转卡片、Domain/API/证据包/Admin/小程序自检和最终验收 smoke；生产必须显式配置 appId、商品购买路径和目标版本，并补体验版跳转证明。
91. 旧数据生产处置决策记录已纳入 `legacyDataMigrationDecision` Module、`GET/POST /api/v1/admin/legacy-data-migration-decisions`、Element Plus「开发发布」页旧数据决策表单、审计、脱敏、幂等、发布记录 `evidence.legacyDataMigration.decision`、发布证据包和最终验收 smoke；生产目标存在旧数据时必须记录 `APPROVED` 决策，真实写入型补迁仍需补生产快照、dry-run 和执行历史。
92. 旧数据生产处置执行历史记录已纳入 `legacyDataMigrationExecution` Module、`GET/POST /api/v1/admin/legacy-data-migration-executions`、Element Plus「开发发布」页旧数据执行表单、审计、脱敏、幂等、发布记录 `evidence.legacyDataMigration.execution`、发布证据包和最终验收 smoke；生产目标存在旧数据时必须同时具备 `APPROVED` 决策与匹配动作的 `VERIFIED` 执行历史，真实执行截图、链接或 CloudBase/对象存储留档仍需上线环境录入。
93. 动作 Adapter 校准 Gate 已纳入 `actionAdapterCalibration` Module、`GET /api/v1/admin/action-adapter-calibration`、发布记录 `evidence.actionAdapterCalibration`、发布证据包 `summary.actionAdapterCalibrationStatus` / `evidence.actionAdapterCalibration`、`npm run calibrate --prefix backend`、Element Plus「开发发布」页外部动作 Adapter 校准卡片、Domain/API/证据包/Admin 自检和最终验收 smoke；生产发布需补齐有赞发券、券状态查询、企业微信标签写入和企业微信联系回写的真实 URL/token/字段映射与小批量成功回执。
94. 旧静态后台下线决策记录已纳入 `adminLegacyDeprecationDecision` Module、`GET/POST /api/v1/admin/admin-legacy-deprecation-decisions`、Element Plus「开发发布」页 Admin 迁移 Gate 下线决策表单、审计、脱敏、幂等、发布记录 `evidence.adminTransitionReadiness.legacyDeprecationDecision`、发布证据包和最终验收 smoke；生产稳定前继续保留 `/admin-legacy`，准备删除时必须录入 `APPROVED` 决策、证据引用和回滚引用。
95. 生产证据收口已纳入 `productionEvidenceIntake` Module、发布记录 `evidence.productionEvidenceIntake`、发布证据包 `summary.productionEvidenceIntakeStatus` / `evidence.productionEvidenceIntake`、Element Plus「开发发布」页生产证据收口卡片、Domain/API/证据包/Admin 自检和最终验收 smoke；该板块统一追踪 T-001 到 T-010，但不替代底层 Gate 或真实外部验收。
96. 新版问卷答卷已纳入 `questionnaire_answer` 数据链、`POST /api/v1/questionnaire/answers`、`GET /api/v1/questionnaire/answers/status`、小程序阶段问卷页、Element Plus 用户生命周期详情抽屉、Domain/API/Admin/小程序自检和最终验收 `questionnaire_answer` smoke；该链路不依赖旧 `checkin_session` 或订单绑定。
97. myRoot 活动首页已改为读取活动、任务进度和商品镜像：`pages/home/index` 的活动态展示今日建议、任务摘要、Root 会员中心商品和订单/咨询/奖励快捷入口；小程序自检覆盖首页不得退回订单前置主体。
98. Settlement AND/OR 条件树已纳入 `campaign_rule_version.conditions_json`、后台规则发布、结算预览 `conditionTree`、旧平铺数组隐式 AND 兼容、Admin 规则条件数量统计和 Domain/API 测试；运营可配置“完成任一互动”等 OR 条件，不需要改小程序页面。
99. 后台 AND/OR 规则生成器已纳入 Element Plus Admin「结算规则」页和 Admin 自检；运营可用表单生成打卡、问卷、分享、咨询、购买条件及有赞券、免单机会、积分、标签奖励 JSON，发布仍复用 Settlement Module 规则 Interface。
100. 奖励上限保护已纳入 Reward Grant Module、`reward_grant.quota_key/quota_limit`、后台规则生成器、Domain/API/Admin 自检和最终验收；奖励配置带 `stockLimit/quotaKey` 时，超限用户仍可达标结算，但不会继续生成奖励记录或发放任务。
101. 奖励库存预占/释放已纳入 Reward Inventory Module、`reward_inventory_pool`、`reward_inventory_reservation`、`reward_grant.inventory_reservation_id`、复核拒绝释放和 Domain/API 测试；限量奖励可预占名额，复核拒绝后释放给后续达标用户。
102. 免单抽取与黑名单已纳入 Reward Grant Module、Element Plus Admin 规则生成器、Domain/API/Admin 自检和最终验收；`chanceRate` 等抽取字段会生成稳定抽取结果，黑名单命中或未抽中均返回 `SKIPPED`，不创建奖励、发放任务或人工复核。
103. 奖励售后追回/库存回补已纳入 Reward Recovery Module、`reward_recovery_record`、`reward_grant` recovery 字段、本地退款审批、库存释放、人工复核关闭和 Domain/API 测试；退款通过后会撤销或追回关联奖励，并把限量库存释放给后续达标用户。
104. 企微自动触达队列已纳入 WeWork Touch Module、`wework_touch_job`、`GET/POST /api/v1/admin/wework-touch-jobs*`、`POST /api/v1/jobs/wework-touch-due`、`npm run wework-touch --prefix backend`、CloudBase Job Manifest、Production Env Matrix、Domain/API 测试和最终验收 `wework_touch_job` smoke；真实 `WEWORK_TOUCH_SEND_URL`、token、模板、回执字段和小批量执行证据仍需生产配置。
105. 订单售后状态镜像与追回联动已纳入 Order After-Sales Module、`order_after_sales_record`、`youzan_order` 售后摘要字段、`GET/POST /api/v1/admin/order-after-sales*`、`ROOT_AFTER_SALES_STATUS_MAP`、`ROOT_AFTER_SALES_RECOVERY_STATUSES`、`ROOT_AFTER_SALES_FOLLOW_STATUSES`、退款工作项同步、按订单证据收敛的 Reward Recovery 联动、`reward_grant.order_id`、Domain/API 测试和最终验收 `order_after_sales` smoke；真实售后 URL、字段路径、游标、多包裹/拆单样本仍需生产校准。
106. 问卷分支题已纳入 Questionnaire Module、默认 DAY4/DAY8 问卷、后端可见题必填校验、小程序新版活动问卷页、小程序旧 7 日问卷页、Domain/API 测试、小程序校验和最终验收 smoke；当前支持字段比较、集合包含、存在性、布尔真值、数值大小和 AND/OR 条件组，复杂题库发布、后台分支预览和 A/B 仍按后续增强推进。
107. 规则拖拽编辑器已纳入 Element Plus Admin「结算规则」页、`ruleTree` 条件树、HTML5 同层拖放、节点启停、分组 AND/OR、打卡天数、连续打卡、阶段问卷、分享次数、咨询和购买条件、Admin 自检、Admin build 和最终验收；发布仍复用 Settlement Module 规则 Interface，不新增前端私有规则路径。

## 3. 手工验收矩阵

| 场景 | 初始条件 | 操作 | 期望结果 |
| --- | --- | --- | --- |
| 新用户等待物流 | 用户完成登录和画像，订单为 `SHIPPED` | 输入收货手机号并匹配订单 | 首页显示等待物流，不创建打卡周期 |
| 送达后启动 | 用户已匹配订单，后台更新物流为 `DELIVERED` | 用户回首页点击开始 | 创建 Day1 周期，后台待办不重复 |
| 无订单异常 | 用户完成画像但无匹配订单 | 点击开始打卡 | 用户端显示人工确认，后台出现 `MANUAL_REVIEW_REQUIRED` |
| Day4 不阻塞 | 用户完成 Day4 打卡 | 不提交 Day4 问卷，继续 Day5 | Day5 可打卡，后台有 Day4 待办 |
| Day8 阻断退款 | 用户完成 Day7，未提交 Day8 | 进入退款申请 | 不生成退款工作项，提示完成 Day8 |
| Day8 后退款 | 用户提交 Day8 | 后台查看退款列表并通过 | 生成退款工作项，通过后进入日常打卡 |
| Day6 优惠券 | 用户完成 Day6 打卡 | 回首页领取复购礼 | 展示券码，不阻塞 Day7 |
| 券未使用待办 | 用户领取券但未核销 | 运营执行 daily audit | 后台出现 `COUPON_UNUSED` 待办 |
| 复购点击 | 用户点击去店铺使用 | 后台查看待办和转化区 | 记录复购点击并生成 `REPURCHASE_INTENT` |
| 订单同步查看 | 用户进入订单与物流页 | 查看已同步或待同步状态 | 看到同步说明、订单状态解释、商品入口或人工协助退路 |
| 状态复核查看 | 用户完成活动条件并生成免单机会复核 | 从奖励页或“我的”页进入状态复核 | 展示待处理复核原因、预计处理时间、所需证据、下一步、最近结算和关联奖励，并可联系顾问 |
| 复核备注查看 | 运营在后台处理人工复核并填写用户可见备注 | 用户再次进入状态复核页 | 看到已处理状态、处理时间和运营备注 |
| 用户咨询记录 | 用户已登录并进入人工协助 | 选择咨询主题并联系顾问 | 打开客服入口，同时记录 `CONSULTATION` 任务事件，并在咨询页看到待跟进状态 |
| 咨询跟进处理 | 后台看到 `CONSULTATION_FOLLOW` 待办 | 运营完成待办并填写备注 | 用户再次进入咨询页时看到已跟进和处理说明 |
| 用户详情追溯 | 后台打开用户详情 | 查看订单、物流、打卡、问卷、退款、优惠券 | 信息在单页可追溯 |
| CloudBase 身份透传 | 微信开放平台认证完成，两个小程序已绑定同一开放平台 | 用真实 CloudBase 请求访问后台探针 | 返回 `READY`，只展示脱敏 openid/unionid 预览，不创建用户 |

## 4. 真实 Adapter 对接清单

详细样本格式见 [external_adapter_samples.md](./external_adapter_samples.md)，真实账号校准步骤见 [adapter_calibration_playbook.md](./adapter_calibration_playbook.md)。真实平台 Adapter 开发前，先用后台「真实样本导入」的取样模板补齐至少 3 条有赞订单、3 条有赞客户、3 条物流状态和 3 条企业微信线索样本；可直接粘贴 CSV 或从表格复制出来的文本。后台「Adapter 准入」会检查四类样本是否达到数量、必填字段和状态枚举要求；若出现 `NEEDS_MAPPING`，先保存状态映射并重新预览。「真实 Adapter 接入」会同时展示 `MANUAL_SAMPLE` 和未来真实平台 Adapter 的配置状态。

### 4.0 生产样本评审记录

2026-06-23 已在 CloudBase 生产环境 `myroot-prod-d5gl3gzg7115f149a` 通过 `PREVIEW` 写入四类真实样本评审；本次未执行 `IMPORT`，未生成业务订单、客户镜像、物流或企微线索业务导入数据。

1. `YOUZAN_ORDER`：最新评审 `rev_72f6337a80528f`，3/3 可预览导入，必填覆盖 `youzanOrderNo=100%`、`receiverPhone=100%`，状态为 `NEEDS_REVIEW`。提醒项为未写入 `rawAddressText`；本轮为降低生产样本 PII 扩散，地址仍保留在有赞原文，不进入本次样本 payload。
2. `YOUZAN_CUSTOMER`：最新评审 `rev_8359f6698052b4`，3/3 可预览导入，必填覆盖 `youzanYzUid=100%`，状态为 `NEEDS_REVIEW`。提醒项为暂缺 `unionid/phone/rootUserId`；微信开放平台认证和小程序绑定完成后再补 unionid 级强匹配样本。
3. `FULFILLMENT`：最新评审 `rev_786e371385bcde`，3/3 可预览导入，必填覆盖 `youzanOrderNo=100%`、`deliveryStatus=100%`，状态为 `READY`。本轮样本均为有赞订单当前 `未发货` 状态，已满足 Adapter 开发准入；后续发货后仍需补充已发货、已签收、异常件等状态用于扩展映射校准。
4. `WECHAT_LEAD`：最新评审 `rev_1e0febc9b56c75`，3/3 可预览导入，状态为 `READY`。本轮样本来自企业微信导出的 `客户列表.xlsx`，使用 `客户名称 -> 企业微信备注名`、`电话 -> 备注手机号`、`来源 -> 来源活动` 的映射完成预览；导出文件未包含 `external_userid/外部联系人ID` 列，后续真实企微 Adapter 校准仍需补取更稳定的外部联系人 ID。

当前 `GET /api/v1/admin/launch-readiness?target=production` 汇总为 `NEEDS_REVIEW`：0 个 blocker、2 个 warning、6 个 pass。下一步确认有赞订单样本不写入原始地址、以及有赞客户样本暂缺 unionid/phone/rootUserId 的提醒项是否可接受。

同日继续执行本地回归验证：`npm test --prefix backend -- --test-name-pattern='product|Product|YOUZAN|youzan|adapter|Adapter|root member|Root 会员中心'` 实际完成后端全量相关回归，152/152 通过，覆盖商品镜像、Root 会员中心跳转 Gate、有赞商品/订单/客户 Adapter、券发放与券状态 Adapter、企微动作 Adapter、Adapter 校准、发布记录和发布证据包脱敏；`npm run check --prefix miniprogram` 通过。该结果证明本地 Module Interface 未回退，但不等同于真实有赞生产拉取通过：T-003/T-004/T-005 仍需在生产环境注入有赞 URL、token、字段映射后执行小批量 `PREVIEW/IMPORT` 或动作校准，并把真实回执写入发布证据。

### 4.0.1 生产发布证据与 Admin 部署包记录

2026-06-23 已生成并留档一份生产发布证据包基线，留档 ID 为 `rel_evd_d620c87cb8edf7`，状态为 `BLOCKED`。该留档用于记录“真实样本准入已补齐，但 Root 会员中心购买跳转、真实平台 Adapter、动作 Adapter、生产切换证明和三方签字仍未完成”的当前状态；留档不代表发布批准。

同日已在本地执行 `npm run admin:check`、`npm run admin:build` 和 `npm run deploy:prepare-admin`，生成 `admin/dist` 并同步到 `backend/public/admin-dist`，共 5 个静态文件。该步骤只准备 backend-only Admin build 部署包；生产 `GET /api/v1/admin/release-record?target=production` 中的 Admin 迁移 Gate 需要在下一次 CloudBase 后端部署携带该目录后重新回读。

### 4.0.2 Root 会员中心商品跳转记录

2026-06-23 已按产品确认信息写入 Root 会员中心商品快照：小程序 AppID 为 `wxfb75c0b432670215`，商品 alias 为 `36ep2dcgnia7nf0`，商品名为 `ROOT益生元 7天身体重启计划`，包含 `便秘功效款 一周用量` 和 `日常调理款 一周用量` 两个 SKU，价格展示为 `¥99`，状态为 `ACTIVE`。本次先执行 `POST /api/v1/admin/products/sync-preview` 确认 1/1 可导入、0 error，再以 `request_id=root-member-center-product-sync-20260623-2148` 执行 `sync-execute` 写入生产商品镜像。

同日已记录生产切换证明 `root_member_center_appid`，证明 ID 为 `cutover_feb3687abf23d8`，状态为 `VERIFIED`，用于确认 Root 会员中心正式 AppID。由于 CloudBase 环境变量中暂未配置 `ROOT_MEMBER_CENTER_APPID` 或 `YOUZAN_MINIPROGRAM_APPID`，该生产切换项当前从 `BLOCKED` 降为 `NEEDS_REVIEW`；下一次 CloudBase 生产环境变量配置时应补 `ROOT_MEMBER_CENTER_APPID=wxfb75c0b432670215`。

Root 会员中心购买跳转 Gate 当前只剩体验版跳转证明阻塞：需要在 myRoot 商品页实际点击跳转至 Root 会员中心商品页后，通过 `POST /api/v1/admin/root-member-center-jump-proofs` 记录商品 `36ep2dcgnia7nf0` 的 `VERIFIED` 证明。该证明未实测前，本次不写入 `VERIFIED`。商品和 AppID 证明补齐后的生产发布证据包已再次留档，留档 ID 为 `rel_evd_bfe57fcebf8be9`，状态仍为 `BLOCKED`。

2026-06-23 已在 CloudBase 生产环境 `myroot-prod-d5gl3gzg7115f149a` 的 `myroot-api` 中补齐 `ROOT_MEMBER_CENTER_APPID=wxfb75c0b432670215`。生产 `GET /api/v1/admin/release-record?target=production` 回读显示 `root_member_center_appid` 已为 `READY`，`root_member_center_appid` 环境变量缺口已清空；整体发布记录仍为 `BLOCKED`，其中 Root 会员中心 Gate 仍等待体验版购买跳转证明，CloudBase unionid Gate 仍等待真实小程序运行时请求证明。

同日从微信开发者工具切换至 myRoot 商品页 `pages/products/index`，页面进入“正在同步商品...”状态但无法完成商品镜像加载；公网直连 `GET /api/v1/products` 与 `POST /api/v1/products/jump` 均返回 `登录已过期`，不能作为小程序跳转证明。当前 Root 会员中心购买跳转 Gate 的 AppID 与商品路径配置已经补齐，但体验版跳转证明仍无法验证：需要先恢复 myRoot 小程序到 CloudBase 生产环境的 `wx.cloud.callContainer` 访问能力，随后在已登录小程序运行态依次确认商品列表、商品详情、`去购买` 跳转到 Root 会员中心商品页，再通过 `POST /api/v1/admin/root-member-center-jump-proofs` 记录 `VERIFIED` 证明。

同日已用普通公网请求回读 `GET /api/v1/admin/cloudbase-identity-probe?appCode=MYROOT`，结果为 `BLOCKED`：`openidPresent=false`、`unionidPresent=false`、隐私保护检查为 `PASS`。这是预期结果，因为普通浏览器或公网请求不会携带 CloudBase 注入的微信身份 header，不可作为微信开放平台绑定失败的证据。真实 unionid 验证必须从 myRoot 小程序运行时通过 `wx.cloud.callContainer` 访问同一探针，确认 `x-wx-openid` 与 `x-wx-unionid` 均存在后，再记录 `cloudbase_unionid` 生产切换证明。

同日已把 myRoot 小程序生产调用目标从旧的 `express-x7te / prod-d3grtjkva76c93e00` 修正为当前生产 `myroot-api / myroot-prod-d5gl3gzg7115f149a`。后续在微信开发者工具或体验版执行 unionid 探针时，应以该配置为准，避免验证请求落到旧 CloudBase 环境。

同日已从微信开发者工具运行态启动真实小程序 CloudBase 身份探针，使用 AppID `wx7727a02565aed1c2`、环境 `myroot-prod-d5gl3gzg7115f149a`、服务 `myroot-api` 调用 `wx.cloud.callContainer` 访问 `GET /api/v1/admin/cloudbase-identity-probe?appCode=MYROOT`。结果为 `BLOCKED`：小程序端返回 `INVALID_HOST`，请求未进入后端探针，因此本次不能判断 `x-wx-openid` 或 `x-wx-unionid` 是否透传。下一步需先在微信开发者工具云开发控制台或 CloudBase 控制台完成 myRoot 小程序与目标 CloudBase 环境的关联、导入或同主体环境共享，再复测同一探针；复测通过前不记录 `cloudbase_unionid` 的 `VERIFIED` 生产切换证明。

同日继续核对微信开发者工具内置云开发控制台：myRoot AppID `wx7727a02565aed1c2` 下显示“未创建可用环境”，点击“使用已有腾讯云环境”后，腾讯云环境下拉显示“暂无可用腾讯云环境”；期间控制台还出现过“账号欠费”提示。该证据进一步确认 `INVALID_HOST` 的当前根因不是后端身份 Module 或 unionid 主键策略，而是小程序侧尚未具备可访问的云开发环境映射。需先处理腾讯云账号欠费、腾讯云账号与微信云开发账号绑定、以及 `myroot-prod-d5gl3gzg7115f149a` 对 myRoot 小程序的可见性，再继续身份透传复测。

2026-06-24 已在微信开发者工具内为 myRoot AppID `wx7727a02565aed1c2` 创建微信侧内测云开发环境 `myroot-test-d4gclpzxx286deda6`，环境名 `myroot-test`，套餐状态为“免费开发环境”。控制台资源生命周期显示为 `2026-06-24 00:31:15 - 2026-07-24 23:59:59`；当前可见用量为本日/本月调用次数 `1`、容量 `0 MB / 3 GB`、CDN 流量 `0 Bytes / 10 GB`、云函数资源使用量 `0 GBs / 15 万GBS`。小程序本地配置已将 `develop` 和 `trial` 指向该内测环境，`release` 继续指向生产 `myroot-prod-d5gl3gzg7115f149a`。该动作只解除开发版/体验版内测阻塞，不代表生产 CloudBase 账号解绑、生产环境关联或 `cloudbase_unionid` Gate 已完成；下一步需在内测环境创建/部署云托管服务并复测商品、订单、登录和身份探针。

同日已从浏览器云托管页面观察到内测服务路径 `cloudrun/service/express-i4c5`，说明当前内测部署使用 Express.js 模板默认服务名 `express-i4c5`。为避免内测小程序请求落到不存在的 `myroot-api`，本地小程序配置已将 `develop` / `trial` 的 `cloudServiceName` 临时对齐为 `express-i4c5`，`release` 仍保留生产服务名 `myroot-api`。正式生产不应沿用该模板服务名；后续如果重建或重命名内测服务为 `myroot-api`，需同步恢复小程序内测 Adapter 配置。

同日重新发布后，对公网地址 `https://express-i4c5-273927-8-1446487876.sh.run.tcloudbase.com/` 做只读验收：`/health` 返回 `{"code":0,"message":"ok","data":{"service":"root-checkin"}}`，`/` 与 `/admin-legacy` 返回旧静态后台，`/admin` 返回 Element Plus Admin 入口且引用 `/admin/assets/index-CNUUlP9w.js`、`/admin/assets/vue-lrdSF_Sb.js`、`/admin/assets/element-CxKgTGTD.js`、`/admin/assets/index-DlxjYqBd.css`。上述静态资源使用 `GET` 均返回 200，说明 `express-i4c5` 当前已运行本仓库 Root 后端 Implementation，旧的“模板页/404”结论已被本次复测替代。

同日继续用普通公网请求回读内测云托管 Interface：`GET /api/v1/admin/cloudbase-identity-probe?appCode=MYROOT` 返回 `BLOCKED`，这是公网请求不携带 CloudBase 注入 `x-wx-openid` / `x-wx-unionid` 的预期结果，不代表 unionid 主键策略失败；`GET /api/v1/admin/release-record?target=gray` 返回 `BLOCKED`，阻塞项仍集中在有赞、物流、企业微信等真实外部 Adapter、签字项与生产证明；`GET /api/v1/products` 返回 `401 登录已过期`，符合未登录用户 Interface。下一步必须从 myRoot 小程序运行态通过 `wx.cloud.callContainer` 访问同一身份探针，并在登录后复测商品展示、Root 会员中心购买跳转、订单展示和任务/结算短链路，才能把 `cloudbase_unionid`、Root 会员中心跳转证明和内测链路记录为通过证据。

同日已在微信开发者工具 Stable v2.01.2510290 的 myRoot 小程序运行态执行 unionid 探针，项目 AppID 为 `wx7727a02565aed1c2`，环境为 `myroot-test-d4gclpzxx286deda6`，云托管服务名为 `express-i4c5`。直接 `wx.cloud.callContainer` 调用 `GET /api/v1/admin/cloudbase-identity-probe?appCode=MYROOT` 返回 `cloud.callContainer:fail Error: errCode: -501000 | errMsg: Invalid host`，随后使用 `new wx.cloud.Cloud({ resourceAppid: "wx7727a02565aed1c2", resourceEnv: "myroot-test-d4gclpzxx286deda6" })` 的资源方调用写法复测同一路径，仍返回 `INVALID_HOST`。再用同一配置调用最小路径 `/health`，也由 CloudBase 网关返回 `{"code":"INVALID_HOST","message":"Invalid host","requestId":"b101c5f1-6f28-11f1-aad3-525400e9969b"}`，未进入 Root 后端 `/health`。因此本轮不能判断 `x-wx-openid` 或 `x-wx-unionid` 是否透传，当前阻塞点是小程序到该云托管服务的调用入口/环境关联/环境共享配置，而不是 Root 后端身份探针或 unionid 主键策略。

2026-06-28 已按最新策略确认：开发版/体验版继续使用微信开发者工具中的云开发环境 `myroot-test-d4gclpzxx286deda6`，不再尝试“无 env 直连”云托管。小程序本地配置已恢复为 `develop` / `trial` 使用 `cloudEnvId=myroot-test-d4gclpzxx286deda6`、`cloudServiceName=express-i4c5`，并将请求 Adapter 的 `cloudEnvId` 重新设为必填。微信开发者工具云开发控制台可见环境 `myroot-test`，套餐为免费开发环境；同日从小程序 Console 执行最小探针 `wx.cloud.callContainer({ config: { env: "myroot-test-d4gclpzxx286deda6" }, path: "/health", header: { "X-WX-SERVICE": "express-i4c5" } })`，返回 `MYROOT_TEST_HEALTH_FAIL {"errCode":-1,"errMsg":"cloud.callContainer:fail Error: errCode: -501000 | errMsg: Invalid host"}`。这证明当前已经回到正确 envId 口径，但 `myroot-test` 环境内仍没有形成可被小程序云调用命中的 `express-i4c5` 云托管入口；下一步应在微信开发者工具云开发控制台或微信云托管控制台确认 `express-i4c5` 是否真正部署在 `myroot-test-d4gclpzxx286deda6` 下、服务名是否一致、以及该环境是否启用了云托管调用能力，再复测 `/health` 和身份探针。

同日 17:29 已在 `myroot-test-d4gclpzxx286deda6` 内测环境重新部署云托管服务 `myroot-api`，部署 ID `001`，控制台状态为“正常”，生效流量 `100%`，默认公网域名为 `https://myroot-api-275663-7-1446487876.sh.run.tcloudbase.com`。本次部署使用 Root 后端 Implementation、端口 `80`、SQLite Store Adapter（`ROOT_STORE_ADAPTER=sqlite`，`ROOT_SQLITE_FILE=/tmp/root-checkin-internal-test.sqlite`），只用于微信开发者工具内测验收；正式上线仍需切到 MySQL Store Adapter 并配置后台访问口令。公网 `GET /health` 返回 `200` 与 `{"code":0,"message":"ok","data":{"service":"root-checkin"}}`；随后已把小程序 `develop` / `trial` 的 `cloudServiceName` 从 `express-i4c5` 改为 `myroot-api`，并通过 `npm run check --prefix miniprogram`。微信开发者工具 Stable v2.01.2510290 中，使用 myRoot AppID `wx7727a02565aed1c2` 执行 `wx.cloud.callContainer({ config: { env: "myroot-test-d4gclpzxx286deda6" }, path: "/health", header: { "X-WX-SERVICE": "myroot-api" } })` 返回 `MYROOT_TEST_HEALTH_OK`、`statusCode=200`、后端 `service=root-checkin`；执行 `GET /api/v1/admin/cloudbase-identity-probe?appCode=MYROOT` 返回 `MYROOT_TEST_IDENTITY_OK`，探针状态 `READY`，`openidPresent=true`，`unionidPresent=true`，`readyForUnionPrimaryKey=true`，`appCode=MYROOT`；执行 `POST /api/v1/auth/login` 返回 `MYROOT_TEST_LOGIN_OK`，`code=0`，`unionidStatus=LINKED`。该记录证明内测小程序到 `myroot-api` 云托管的调用 Seam 已打通，且 unionid 可作为两个小程序账号打通主键进入后续内测链路验证。

同日继续补齐 2026-06-29 团队内测准备：在内测 `myroot-api` Store 中通过 Admin Interface 写入商品快照 `ROOT_PREBIOTIC_7D_RESET`，商品名为 `ROOT益生元 7天身体重启计划`，Root 会员中心 appId 为 `wxfb75c0b432670215`，购买路径为 `pages/goods/detail/index.html?...alias=36ep2dcgnia7nf0...`。随后从 myRoot 小程序运行态执行 `wx.cloud.callContainer` 登录、商品列表和购买跳转记录探针，返回 `MYROOT_TEAM_TEST_PRODUCT_OK`：`loginCode=0`、`unionidStatus=LINKED`、`productsCode=0`、`productCount=1`、`firstProductId=ROOT_PREBIOTIC_7D_RESET`、`jumpCode=0`、`jumpAppId=wxfb75c0b432670215`、`jumpPathPresent=true`、`jumpEnvVersion=release`。已用 `POST /api/v1/admin/root-member-center-jump-proofs` 写入灰度跳转证明 `rmc_jump_ff35a58ba324fa`，`GET /api/v1/admin/release-record?target=gray` 回读 `rootMemberCenterReadiness.status=READY`，活跃商品、appId、购买路径和跳转证明 5 项检查均为 `READY`。同轮发现微信开发者工具在缺少 `__wxConfig.envVersion` 时可能误按 `release` 兜底，已把 `miniprogram/config/env.js` 的未知运行态兜底改为 `develop`，并通过 `npm run check --prefix miniprogram`。团队内测执行清单已记录在 `docs/team_test_plan_2026-06-29.md`；正式上线仍保持 `BLOCKED`，原因集中在 MySQL Store Adapter、后台访问口令、真实有赞/物流/企业微信 Adapter、动作 Adapter、小批量回执、CloudBase Job、生产切换证明和三方签字。

同日按最新 Root 会员中心商品链接要求，将内测 `myroot-api` Store 中 `ROOT_PREBIOTIC_7D_RESET` 的购买目标改为微信小程序短链 `#小程序://ROOT会员中心/lnQOjYsk8gZoABH`，更新请求 ID 为 `root-member-center-shortlink-mqxqtay0`。公网回读 `/api/v1/products` 与 `/api/v1/products/jump` 均返回 `jumpAppId=wxfb75c0b432670215`、`jumpPath=#小程序://ROOT会员中心/lnQOjYsk8gZoABH`。小程序端跳转 Adapter 已新增短链识别，会从 `path` 派生 `shortLink` 并优先使用短链跳转；因此团队复测前需重新上传体验版，短链真实跳转通过后再补新的 Root 会员中心跳转证明。

同日已确认 myRoot 微信公众平台订阅消息模板 `10850`，标题为 `活动提醒`，类目为 `投票`，模板 ID 为 `SOABCc3dk6tItVnjglFc94X6FVQo4LuZvnoZlHJTaBc`。本轮打卡提醒能力版本记录为 `CHECKIN_REMINDER_NEXT_DAY / v2026-06-28-tpl10850`，字段映射为 `thing3=活动名称`、`thing2=注意事项`、`thing1=活动商品`。下一步需要在内测云托管 `myroot-api` 注入 `ROOT_CHECKIN_REMINDER_TEMPLATE_ID`、`ROOT_CHECKIN_REMINDER_TEMPLATE_VERSION`、`ROOT_CHECKIN_REMINDER_TEMPLATE_DATA_JSON`、`ROOT_CHECKIN_REMINDER_MINIPROGRAM_STATE=trial` 并重新部署，再用体验版真机验证加入活动后的订阅授权弹层和 Job dry-run。

### 4.1 有赞订单 Adapter

最小字段：

1. 有赞订单号。
2. 商品 ID 和商品名称。
3. 实付金额。
4. 订单状态。
5. 收货人。
6. 收货手机号。
7. 原始地址文本。
8. 支付时间。

必须确认：

1. 退款金额是否等于实付金额。
2. 一个手机号多单时的匹配策略。
3. 同一订单被多个微信用户尝试绑定时的处理话术。
4. 订单列表请求 URL、token 传递位置、订单数组路径、下一页游标路径和真实字段映射。
5. 后台订单增量运营入口的 live 预览、确认导入、游标推进和重复 `request_id` 幂等结果。

### 4.2 物流 Adapter

最小字段：

1. 订单号。
2. 快递公司。
3. 运单号。
4. 物流状态：`NOT_SHIPPED`、`SHIPPED`、`DELIVERED`、`EXCEPTION`。
5. 发货时间。
6. 签收时间。
7. 最新物流节点文本。

必须确认：

1. 签收是否等同于可启动 Day1。
2. 异常件是否自动生成 `FULFILLMENT_EXCEPTION`。
3. 手工改状态是否需要审计记录。
4. 物流事件列表请求 URL、密钥传递位置、事件数组路径、下一页游标路径和真实字段映射。

### 4.3 企业微信线索 Adapter

最小字段：

1. 外部联系人 ID。
2. 企业微信备注名。
3. 来源活动。
4. 当前添加状态。
5. 运营备注。

必须确认：

1. 微信授权昵称、收货人、企业微信备注不一致时的人工确认规则。
2. 运营待办处理结果是否需要同步回企业微信。
3. 话术是否需要按用户标签分层。
4. 外部联系人请求 URL、token/secret 传递位置、线索数组路径、下一页游标路径和真实字段映射。

## 5. 发布前阻塞项

正式上线前必须关闭：

1. 数据仓库风险：内存 Adapter 重启会丢失记录；JSON 文件 Adapter 只适合内部灰度；SQLite Adapter 只适合本地验证，云托管正式环境必须使用 MySQL Adapter。
2. 正式登录风险：生产环境必须配置真实微信登录密钥，并确保未启用直接手机号登录测试开关。
3. 正式域名风险：小程序体验版和正式版不能访问 `127.0.0.1`。
4. 数据保留风险：用户明细保留期限、图片保留规则和后台可见范围需要最终确认。
5. 后台访问风险：正式环境必须配置 `ROOT_ADMIN_TOKEN` 或 `ROOT_ADMIN_TOKENS`，否则运营数据 Interface 会被上线闸口阻塞。
6. 权限风险：Element Plus Admin 已按 capabilities 隐藏菜单并禁用主要写按钮，但安全判断仍以后台角色能力为准；正式环境需要核对 viewer、finance、operator、admin 四类 token 与按钮提示是否一致。
7. Production Env Matrix 风险：代码仓库已提供变量矩阵和缺失判断，但真实生产密钥不能写入仓库，必须由 CloudBase 环境变量、密钥管理或外部平台控制台注入。
8. CloudBase Job 风险：平台单函数最多 10 个触发器，生产已拆为 `myroot-job-dispatcher` 10 个和 `myroot-health-retention` 1 个，合计覆盖 11 个 Job；两函数均 `Active`，沿用原 5 项变量且 `ROOT_JOB_DRY_RUN=true`。两个新 Job 手工调用均到达调度代码，但稳定版后端尚无对应路由而返回 404；必须在 `v0.5.6` 后端生效后取得 HTTP 200 dry-run 证明，相关负责人确认前不得开启 execute 模式。
9. CloudBase 身份风险：已从 myRoot 小程序真实调用 `myroot-prod-d5gl3gzg7115f149a`，验证 `x-wx-openid`、`x-wx-unionid`、登录链路和隐私脱敏，身份探针为 `READY`；后续更换 AppID、开放平台绑定或 CloudBase 环境时必须重新验证，不能沿用本次证明。
10. 外部字段和平台请求风险：有赞、物流、企业微信字段或凭证未验证前，只能按 `MANUAL_SAMPLE` 或 `MANUAL` Adapter 灰度试跑；四类 HTTP Implementation、动作 Adapter 校准 Gate、售后状态映射、`WEWORK_CONTACT_WRITEBACK_URL` 和 `WEWORK_TOUCH_SEND_URL` 需要真实账号校准、小批量成功回执和发布证据包留档后再进入正式上线。
11. Admin 构建产物风险：正式镜像或云托管产物必须包含 Admin build。backend-only 云托管部署前应执行 `npm run admin:build && npm run deploy:prepare-admin`，确认 `backend/public/admin-dist` 存在；灰度验收必须确认 `/admin/assets/*.js` 返回 200。
12. 旧历史数据风险：旧 7 日试饮记录当前只进入只读评估、生产处置决策记录和发布证据包，不会自动补迁到新任务事实或奖励记录；如生产决定补迁，必须先冻结生产快照、dry-run、核对阻塞项、记录 `APPROVED` 决策并重新生成证据包签字。
13. CloudBase Store 决策风险：已选择 CloudBase MySQL；上线前必须证明 `GET /ready`、迁移版本、修订号、核心关系表同步、备份策略和回滚路径。任一项缺失时仍应阻塞发布。
14. Root 会员中心购买跳转风险：myRoot 商品页可展示 Root 会员中心商品，但正式发布必须确认 appId、商品路径并通过 `POST /api/v1/admin/root-member-center-jump-proofs` 记录体验版跳转证明；缺少 appId/path 或生产目标缺 `VERIFIED` 证明时发布记录会阻塞，灰度目标缺证明会提醒。

后台「上线闸口」和 `GET /api/v1/admin/launch-readiness?target=production` 会把其中可自动判断的项目标记为 `BLOCKED`；后台「Adapter 校准」和 `GET /api/v1/admin/adapter-calibration` 会把四类真实拉取 Adapter 的校准状态拆开，`GET /api/v1/admin/action-adapter-calibration?target=production` 会把有赞发券、券状态查询、企业微信标签写入和企业微信联系回写四类动作 Adapter 的运行配置与真实执行证据拆开。`npm run production-env --prefix backend -- --target production` 会生成生产环境变量矩阵，其中售后状态映射由 `ROOT_AFTER_SALES_STATUS_MAP`、`ROOT_AFTER_SALES_RECOVERY_STATUSES` 和 `ROOT_AFTER_SALES_FOLLOW_STATUSES` 承接，企微联系回写变量由 `WEWORK_CONTACT_WRITEBACK_URL`、token、method 和回执字段配置承接，企微自动触达变量由 `ROOT_WEWORK_TOUCH_*` 和 `WEWORK_TOUCH_SEND_URL`、token、method、模板与回执字段承接。`GET /api/v1/admin/cloudbase-identity-probe` 用于真实 CloudBase header 透传验证，Element Plus Admin 的“开发发布”页提供同一探针入口。后台「用户生命周期」页的顾问工作台会通过 `GET /api/v1/admin/consultation-advisor-workbench` 汇总顾问负载、未分配咨询、SLA 超时和待办明细，真实企微在线状态和排班字段校准后再接入内部 Adapter。后台「发布记录」和 `GET /api/v1/admin/release-record?target=production` 会把决策建议、阻塞项、灰度确认项、签字位、`signoffGate`、`adminTransitionReadiness`、`productionCutoverReadiness`、`actionAdapterCalibration`、Root 会员中心跳转证明、旧数据生产处置决策、生产切换证明记录、Production Env Matrix、外部通道与负责人证据、企微联系回写配置和回滚动作汇总到一处；`GET /api/v1/admin/release-evidence-pack?target=production` 与 `npm run release:evidence --prefix backend -- --base-url <生产域名> --target production --strict` 会把发布记录、Production Env Matrix、CloudBase Job Manifest、Adapter 校准、动作 Adapter 校准、签字 Gate、Admin 迁移 Gate、生产切换 Gate 和外部通道负责人证据生成脱敏发布证据包，Element Plus Admin 可直接下载 JSON、通过 `POST /api/v1/admin/release-evidence-pack/archive` 留档并写入审计，也可通过 `GET /api/v1/admin/release-evidence-pack/archive?archiveId=...` 取回历史留档；`POST /api/v1/admin/release-signoffs` 可将产品、运营、研发签字绑定到证据包留档并写入审计，生产目标三方均 `APPROVED` 后签字 Gate 才会变为 `READY`；`GET/POST /api/v1/admin/production-cutover-proofs` 可查询或记录 operator 的生产切换证明，`GET/POST /api/v1/admin/root-member-center-jump-proofs` 可查询或记录商品级跳转证明，`GET/POST /api/v1/admin/legacy-data-migration-decisions` 可查询或记录旧数据生产处置决策，相关记录都会脱敏 evidence ref 和备注并纳入发布 Gate；运行级人工回滚通过 `POST /api/v1/admin/external-adapters/rollback` 执行。生命周期导出记录默认保留 7 天，可由 `ROOT_LIFECYCLE_EXPORT_RETENTION_DAYS` 覆盖；字段策略默认 `MASKED`，可由 `ROOT_LIFECYCLE_EXPORT_SENSITIVITY` 或显式请求覆盖但受后台角色降级保护；下载审批可由 `ROOT_LIFECYCLE_EXPORT_APPROVAL_REQUIRED` 开启，`RAW` 导出强制进入审批；交付通道可由 `ROOT_LIFECYCLE_EXPORT_DELIVERY_*` 和 `ROOT_LIFECYCLE_EXPORT_OBJECT_*` 配置，`ROOT_LIFECYCLE_EXPORT_OBJECT_DIR` 可用于本地/云挂载对象目录 Adapter，默认不外发且不能绕过审批；签名下载由 `ROOT_LIFECYCLE_EXPORT_DOWNLOAD_SECRET` 和 `ROOT_LIFECYCLE_EXPORT_SIGNED_DOWNLOAD_*` 控制，供邮件/企微投递 Adapter 复用且仍受审批和过期策略约束；Webhook 投递可携带签名下载链接、通道/模板、请求头和响应摘要，`ROOT_LIFECYCLE_EXPORT_DELIVERY_WEBHOOK_CHANNEL`、`ROOT_LIFECYCLE_EXPORT_DELIVERY_WEBHOOK_TEMPLATE`、`ROOT_LIFECYCLE_EXPORT_DELIVERY_TIMEOUT_MS` 用于生产路由；交付失败可由 `ROOT_LIFECYCLE_EXPORT_DELIVERY_RETRY_*` 控制到期重试，超限或不可重试错误进入 `DEAD_LETTER`；`GET /api/v1/admin/lifecycle-user-exports/delivery-health` 与 Element Plus 导出记录抽屉用于查看通道健康、失败原因和到期重试；Operational Alerts 会把导出死信和到期重试转为 `LIFECYCLE_EXPORT_DELIVERY_HEALTH` 通知，支持站内通知和 `ROOT_OPERATIONAL_ALERT_WEBHOOK_*` 外部路由；发布记录会检查动作 Adapter 小批量执行证据、外部通道 URL、模板、负责人路由、签字 Gate、Admin 迁移 Gate、生产切换 Gate、后台生产切换证明记录和导出交付健康摘要；真实 COS/S3/CloudBase 对象存储 SDK Adapter、真实邮件/企微外部投递 URL/模板、动作 Adapter URL/token/字段映射、生产证明变量、真实验收截图/链接/执行历史和后台可见范围仍需要人工确认后写入发布记录。

Root 会员中心购买跳转 Gate 会随发布记录和发布证据包一起留档：`READY` 表示活跃商品都能解析到 appId、购买路径且已有匹配的 `VERIFIED` 跳转证明，`NEEDS_REVIEW` 表示灰度目标缺证明或 appId 冲突需负责人确认，`BLOCKED` 表示生产目标缺少 appId、商品路径、活跃商品或最新证明为 `REJECTED`。正式发布前应把 `ROOT_MEMBER_CENTER_APPID`、商品级 `youzan_path` 或 `ROOT_MEMBER_CENTER_PRODUCT_PATH`、体验版跳转截图/链接通过 `POST /api/v1/admin/root-member-center-jump-proofs` 写入证据。

旧数据迁移评估当前作为发布记录和发布证据包的一段只读证据输出：无旧数据时为 `READY`，存在可桥接旧事实且已记录 `APPROVED` 生产处置决策时可进入 `READY`，缺失用户、无法归属、缺生产决策或最新决策为 `REJECTED` 时会阻塞生产；任何真实写入补迁都应作为后续单独生产动作执行，不在当前发布检查中自动发生。

CloudBase Store 决策当前作为发布记录和发布证据包的一段发布 Gate 输出：生产目标未配置 `ROOT_CLOUDBASE_STORE_DECISION` 时为 `BLOCKED`；选择云托管 MySQL 或外部 MySQL 时必须同时满足 MySQL Adapter、CloudBase 环境/地域、备份计划、回滚计划和生产证明；选择 CloudBase Database 时会阻塞，直到对应 Store Adapter 真实实现并通过迁移验证。

本次生产 Store 决策按 [cloudbase_mysql_store_decision.md](./cloudbase_mysql_store_decision.md) 执行：正式生产选择 `MYSQL_ON_CLOUDBASE` + `ROOT_STORE_ADAPTER=mysql`，不把 CloudBase Database、JSON 文件或 SQLite 作为正式 Store。

本轮无市场用户，不要求迁移旧数据；仍需执行迁移、空库初始化和 Store 校验：

```bash
npm run db:migrate --prefix backend
npm run store:verify --prefix backend -- --mysql
curl -s https://myroot-api-273748-8-1437260454.sh.run.tcloudbase.com/ready
```

## 6. 推荐发布顺序

1. 本地回归：内存、JSON 和 SQLite Adapter 只用于自动测试与排查。
2. 团队内测：`develop/trial` 调用 `myroot-prod-d5gl3gzg7115f149a / myroot-api`，数据写 CloudBase MySQL；先不开真实外部 Job execute。
3. 稳定性验证：完成 20 并发、双实例、容器重启、订阅提醒幂等、结算奖励幂等和数据库备份恢复。
4. 正式上线：配置后台口令、CloudBase Store 证明、真实外部 Adapter 与 Job，再依次执行生产环境矩阵、Job Manifest、身份探针、发布证据包和三方签字。

## 7. 2026-07-11 CloudBase MySQL P0/P1 进度

1. 本地 MySQL 8 已完成迁移幂等、双进程迁移锁、20 并发、跨实例幂等、数据库/后端重启恢复、unionid 身份、任务完成限制、结算奖励和打卡提醒 dry-run 验证。
2. 真实 MySQL 验证发现并修复了快照浅拷贝导致的“成功响应但未提交”缺陷，以及实例启动用早期快照强制投影的覆盖窗口；新增快照引用隔离、事务化启动默认值和修订冲突保护，全仓最终验收保持 10/10 `PASS`，生产依赖审计为 0 个已知漏洞。
3. `myroot_app` 已确认具备 `SELECT / INSERT / UPDATE / DELETE / CREATE / ALTER`，未开放 `DROP`、用户管理或转授权权限；当前授权作用域仍为 `*.*`，正式发布前应单独确认并收敛至 myRoot 生产库。CloudBase SQL 自动暂停已关闭，自动备份保留 7 天。部署前快照 `9699594` 已创建但因早于迁移不能作为有效回滚点，迁移后快照 `9700117` 已补建并完成隔离恢复。
4. `myroot-api` 已把 `MYSQL_DATABASE` 修正为 `myroot-prod-d5gl3gzg7115f149a`，连接池上限为 8、连接超时为 10 秒；当前生效部署 `012` 为 100% 流量，生产副本策略已恢复为最小 1、最大 2。
5. CloudBase SQL 已应用 `001_store_snapshot.sql` 与 `002_core_relational.sql`，控制台 `SHOW TABLES` 返回 24 张表；`/ready` 返回 HTTP 200、`kind=mysql`、`connected=true` 和 `migrationVersion=002_core_relational.sql`。修订号会随后续证明与审计写入继续推进，不作为固定部署常量。
6. 微信开发者工具官方自动化已从 myRoot AppID `wx7727a02565aed1c2` 调用生产 `myroot-prod-d5gl3gzg7115f149a / myroot-api`：健康、就绪、登录、用户状态、商品列表和商品跳转 Interface 全部返回 200；`unionidStatus=LINKED`，身份探针为 `READY`，`openid_header`、`unionid_header`、隐私脱敏均为 `PASS`。
7. 双实例验证期间，`009` 同时存在两个 Running 实例；20 个并发登录写请求 20/20 成功且均为 `unionidStatus=LINKED`。SQL 回读修订号推进到 53，但 `root_user=1`、`wechat_identity=1`，未产生并发重复主账号；恢复生产副本策略并记录 unionid 证明后，修订号推进到 54。
8. 商品快照已通过环境配置初始化为 `ROOT_PREBIOTIC_7D_RESET / ROOT益生元 7天身体重启计划`，Root 会员中心 AppID 为 `wxfb75c0b432670215`，购买短链匹配 `#小程序://ROOT会员中心/lnQOjYsk8gZoABH`，跳转环境版本为 `release`。本轮只证明购买跳转 Interface，没有冒充真机实际打开 Root 会员中心，因此生产 `VERIFIED` 跳转证明仍未写入。
9. 生产切换证明已记录 `wechat_open_platform`、`cloudbase_unionid`、`root_member_center_appid` 和 `cloudbase_jobs_created` 四项 `VERIFIED`；生产切换 Gate 为 4 项就绪、6 项仍阻塞，整体正式发布仍为 `BLOCKED`。
10. Cloud Function `myroot-job-dispatcher / lam-j1ik47nr` 已部署为 Active，9 个定时触发器全部启用；9/9 手工 dry-run 返回 HTTP 200、业务码 0，16:20 与 16:30 的自动触发日志均为 `retCode=0`。独立 Job token 访问通用后台返回 HTTP 401。
11. 部署前快照 `9699594` 的隔离恢复因得到 0 张表被判定为不合格；迁移后快照 `9700117` 已通过任务 `13145837` 恢复至 `myroot-restore-drill-v2-20260711`，回读 24 张表、两条迁移记录、schema version 2 和备份时修订号 76，生产库未被覆盖。
12. `012` 镜像内 `/admin`、静态资源和 `/admin-legacy` 均可访问；backend-only 构建证据识别 6/6 Admin Module，0 blocker，旧 Admin 下线审批保留为唯一 warning。
13. P0/P1 已完成。正式发布剩余项是 Root 会员中心真机打开证明、真实外部 Adapter 小批量校准、完整业务回滚、外部通道负责人证明和三方签字。完整脱敏证据见 [2026-07-11 CloudBase MySQL P0/P1 证据](./cloudbase_mysql_p0_p1_evidence_2026-07-11.md)。

## 8. 2026-07-11 v0.5.4 隐私与候选版进度

1. `myroot_app` 的 `DELETE` 权限已在实库确认存在，未重复执行 GRANT；当前权限仍作用于 `*.*`，后续按新建 schema-scoped 账号、候选验证、再停用旧账号的顺序收敛。
2. 小程序已统一接入微信平台隐私授权，覆盖手机号、头像昵称、选择打卡图片和保存分享图。
3. 打卡图片改为小程序直接上传 CloudBase；服务端拒绝 `wxfile://` 等临时路径，只接受 `cloud://` 或受信任的 `https://` 引用。
4. 新增健康类敏感个人信息单独同意 Module 和追加式 `privacy_consent_record` 表；记录政策版本、同意或撤回、服务端来源与时间。同意版本过期、未同意或已撤回时拒绝新的身体画像、问卷和打卡写入，商品浏览与人工协助保持可用。
5. MySQL 已应用 `003_privacy_consent.sql`，表存在且当前 0 条记录；快照 schema version 已升级为 3。稳定版 `012` 的 `/ready` 仍为 HTTP 200、MySQL connected，并回读迁移版本 `003_privacy_consent.sql`。
6. 当前最新候选为 `myroot-api-019 / 0% / v0.5.4`，状态 `normal`、Pod `Running`，稳定版 `012` 继续承接 100% 流量。
7. 正式启用前必须配置 `ROOT_REQUIRE_HEALTH_CONSENT=true`、个人信息处理者法定名称、有效联系方式、正整数保存天数和 `ROOT_HEALTH_DATA_RETENTION_CLEANUP_ENABLED=true`；已确认微信平台主体与营业执照一致，处理者为 `杭州连生健康科技有限公司`、公开联系方式为 `hydennis@foxmail.com`、保存期限为 180 天。五个生产变量仍需写入 0% 候选并回读，因此当前仍是部署阻断项。
8. CloudBase 日志服务未启用；未获费用与配置确认前不自动开启。0% 候选也尚未完成运行时版本归因和对象存储探针。
9. 微信公众平台隐私声明、体验版真机隐私流程和 5% 灰度仍待人工确认。证据见 [微信隐私发布前核对](./wechat_privacy_prelaunch_2026-07-11.md) 与 [候选 019 证据](./production_gray_release_019_2026-07-11.md)。

## 9. 2026-07-11 生产实况复核

1. 22:54 通过 CloudBase Interface 回读：稳定版仍为 `myroot-api-012 / 100%`，候选版仍为 `myroot-api-019 / 0%`，本轮没有修改流量。
2. 公网 `/health` 与 `/ready` 均返回 HTTP 200；`/ready` 证明 `store.kind=mysql`、`connected=true`、`migrationVersion=003_privacy_consent.sql`。
3. 将 CloudBase 当前 31 个环境变量直接注入 Production Env Matrix 后，状态为 `BLOCKED`：20 组中 5 组通过、8 组可选、7 组阻塞。阻塞组为隐私单独同意、有赞订单、有赞客户、有赞优惠券、物流、企微线索和企微标签。
4. 生产发布记录仍为 `BLOCKED`：40 个 must-fix、14 个最终检查；生产切换证明 4/10 就绪，三方签字 0/3，Root 会员中心生产跳转证明 0 条。
5. `myroot-job-dispatcher` 的 9 个触发器均为启用状态；云函数 Job token 与 CloudRun Job token 脱敏哈希一致，手工调用 `adapter_retry_due` 返回 HTTP 200、业务码 0、`dryRun=true`，未执行外部动作。
6. 根目录 `cloudbaserc.json` 已移除全部函数环境变量，防止生产 token 误提交或不完整配置覆盖云端环境；最终验收新增 CloudBase 配置敏感键扫描。
7. 修复后 `npm run verify` 为 11/11 `PASS`：196 个 JavaScript 文件语法、后端测试、生产依赖审计、Element Plus Admin、小程序、Job Manifest、Production Env Matrix、配置密钥扫描和 HTTP Interface smoke 全部通过。

## 10. 2026-07-11 v0.5.5 健康数据保存期限执行进度

1. 新增健康敏感数据到期清理 Module、命令行 Runner 和 `POST /api/v1/jobs/health-data-retention-cleanup` Job Interface；默认 dry-run，execute 必须启用清理开关并提供稳定 `request_id`。
2. 清理范围覆盖身体画像、CHECKIN/QUESTIONNAIRE 任务原始载荷、问卷答案、活动打卡、日常打卡、上传引用，以及复制到运营待办、企微触达、咨询回写、顾问分配和相关审计详情中的健康自由文本；任务完成、状态、关联 ID、结算、奖励、同意与聚合审计事实继续保留。
3. CloudBase 图片按先删对象后删引用执行；共享引用不删除对象，重复 `fileID` 只调用一次。部分对象失败时，同条记录中的健康原文立即脱敏，只保留失败引用等待重试。
4. 审计仅记录截止日期、类型和聚合数量，不记录健康原文或图片 `fileID`；外部 HTTPS 引用会移除业务引用并单独计数，要求人工核查原存储方。
5. 新增 6 组专项测试，受影响的隐私、HTTP、Manifest、CloudBase dispatcher、运行版本与灰度验证测试共 76 项通过；完整 `npm run verify` 为 `11/11 PASS`，覆盖 199 个 JavaScript 文件、配置敏感键扫描、10 个 Job Manifest、Production Env Matrix、全量后端测试、生产依赖审计、Admin 构建、小程序校验和 HTTP Interface smoke。
6. 根项目、后端和小程序版本已升为 `0.5.5`。该版本尚未部署；稳定版仍是 `012 / 100%`，已有候选仍是 `019 / 0% / v0.5.4`，本轮没有修改线上流量。
7. CloudBase Manifest 与本地 `cloudbaserc.json` 已声明第 10 个 `health_data_retention_cleanup` 触发器，但线上 Cloud Function 仍是此前验证的 9 个触发器。部署第 10 个触发器属于生产配置变更，需明确确认后执行，并先保持 `ROOT_JOB_DRY_RUN=true`。
8. 正式配置仍缺个人信息处理者名称、有效联系方式和保存天数；在这些值确认、候选部署、生产 dry-run 与对象清理证据齐全前，隐私合规 Gate 继续保持 `BLOCKED`。

## 11. 2026-07-11 23:44 正式上线只读复核

1. 微信开发者工具 CLI 已登录，工程 AppID `wx7727a02565aed1c2`、基础库 `3.15.2`、本地版本 `0.5.5`；本轮未上传开发版或体验版。
2. CloudBase 只读回读确认 `myroot-api-012 / 100%`，发布顺序仍保留 `myroot-api-019 / v0.5.4`；本轮未部署、未改流量。
3. `/ready` 返回 MySQL connected、`003_privacy_consent.sql` 和 revision 292；稳定版旧发布记录仍显示启动时缓存的 `002_core_relational.sql`，下一候选必须复测三处版本一致性。
4. Cloud Function 为 Active，线上仍是 9 个启用触发器且 `ROOT_JOB_DRY_RUN=true`；本地 Manifest 第 10 个健康数据清理触发器尚未部署。
5. 当前 `v0.5.5` Production Env Matrix 读取线上变量名称后为 20 组中 7 组阻塞；新增隐私组的 5 个变量全部缺失。
6. 已回读营业执照 PNG 原件，确认法定名称为 `杭州连生健康科技有限公司`；未摘录统一社会信用代码、地址等非必要字段。负责人随后确认微信公众平台主体一致，公开隐私联系方式为 `hydennis@foxmail.com`，保存期限为 180 天；等待候选环境变量回读。
7. 本地生产镜像构建及隔离启动通过，`/health.version=0.5.5`、`/admin=200`，容器已停止；这只证明部署工件，不替代 CloudBase 候选运行证据。
8. 当前完整只读证据和下一执行队列见 [正式上线只读检查点](./formal_launch_readonly_checkpoint_2026-07-11.md)。

## 12. 2026-07-11 v0.5.6 有赞身份对账候选

1. 有赞订单与客户 HTTP Implementation 已按官方响应结构校正：订单使用 `full_order_info_list` 与 `paginator`，客户使用 `record_list`、`page_no` 和 `yz_open_id`，并识别 HTTP 200 内的 `gw_err_resp` 业务错误。
2. 新增 User Query 身份解析与小批量对账 Module。myRoot 以 UnionID 发起查询，允许同一 UnionID 对应多个 `yz_open_id`；未归属订单可自动补链。同一 UnionID 误关联多个 Root 用户、Root 用户桥接缺失、`yz_open_id` 已有其他归属或订单已有不同归属时均停止覆盖并创建复核待办。
3. 对账默认 dry-run；execute 必须同时具备 User Query URL、可用 token、`ROOT_YOUZAN_IDENTITY_RECONCILE_ENABLED=true` 和稳定 `request_id`。失败按 15 分钟、1 小时、4 小时、12 小时和 24 小时退避；成功身份默认 168 小时后复核，捕获后续新增的有赞身份。
4. Store 只保存 UnionID 的 24 位 SHA-256 指纹、状态、次数与聚合计数；Job 输出和审计不保存原始 UnionID、手机号、OpenID、token 或完整响应。
5. 新增 `POST /api/v1/jobs/youzan-identity-reconcile`、命令行 Runner、Production Env Matrix Gate 和第 11 个 CloudBase 定时触发器；仓库目标为 11 个，线上仍为 9 个且 `ROOT_JOB_DRY_RUN=true`，本轮未部署或改流量。
6. 根项目、后端、小程序、Admin 与 Cloud Function 版本统一为 `0.5.6`。完整 `npm run verify` 为 `14/14 PASS`，覆盖 213 个 JavaScript 文件、228 个后端测试、版本一致性、11 个 Job、双函数触发器容量拓扑、生产依赖审计、Admin 构建、小程序校验、发布源清单和 HTTP Interface smoke。
7. 小程序 `packOptions.ignore` 显式排除验证脚本、开发身份诊断页、README、package 元数据、`.gitignore` 和私有项目配置；诊断页同时从 `app.json` 移除。发布源清单 Module 应用开发者工具默认的 `.git`、`.svn`、`node_modules`、`.DS_Store` 排除并拒绝符号链接，不额外排除未来可能成为运行依赖的 `miniprogram_npm`。当前清单为 155 文件、496,769 bytes，SHA-256 `3da8acc98202d0fa9ac8d4effee5be8af1e0f118589c5d9908032136dd29fbfb`；误纳入内嵌 `.git` 的旧摘要已作废。
8. 云托管失败日志改为安全摘要，JSON 字段、查询参数和无标签微信标识均已脱敏，用户端只显示稳定的传输失败提示；订阅授权只保存标准化状态。打卡结果与海报载荷从微信持久化缓存迁入一次性内存状态并在启动时清除旧键。生产 `notification_subscription` 当前 0 行，无历史原始订阅响应需要迁移。小程序发布校验还覆盖 Root 会员中心短链的真实调用参数。
9. 本地镜像 `myroot-api:0.5.6-local` 构建成功；`/health`、`/ready` 和 `/admin` 通过，Job 无 token 返回 401、带一次性本地 token 时 dry-run 返回 200，容器已停止。
10. 正式发布仍被隐私变量、真实有赞/企微/物流/奖励校准、真机跳转证明、生产切换证明与三方签字阻断。当前候选不等于正式上线完成。
11. 新增 Youzan Token Policy Module，并接入订单、客户、商品、User Query、发券和券状态六个调用点。生产要求 client id、`grant_id`、`STATIC_ROTATION`、轮换负责人和到期时间；缺失或已过期时在请求有赞前失败关闭，Production Env Matrix 还要求发布时至少剩余 24 小时。`client_secret` 只用于受控轮换，不进入 CloudRun。
12. 外部 Adapter 样本评审写入 Store 前会脱敏手机号、UnionID、地址、昵称、订单号、运单号和企微标识；有赞客户镜像只保留原响应字段路径，不持久化完整原始响应值。
13. MySQL Store 启动前会读取当前账号授权；生产账号必须只在目标 schema 上具备 `SELECT / INSERT / UPDATE / DELETE / CREATE / ALTER`，全局数据权限、额外 schema 权限或 `GRANT OPTION` 会阻止候选启动。2026-07-12 已创建 `myroot_app_v2@'%'` 并撤销控制台创建时的临时全局 `SELECT`；最终回读只有全局 `USAGE` 和目标 schema 的六项必要权限。旧 `myroot_app@'%'` 保持全局授权不变，仅作为回滚账号，尚未删除或停用。
14. 同日隔离 MySQL 8 实测确认 schema-scoped 六项权限足以完成 4 个迁移、25 张表创建、快照初始化和健康检查；同样权限作用于 `*.*` 时以 `MYSQL_PRIVILEGE_POLICY_BLOCKED` 失败关闭，测试容器已删除。
15. 新增无需登录的公开隐私说明 Interface `GET /api/v1/privacy/notice`，本地隐私页会回读已批准的处理者、联系方式和健康数据保存期限；微信平台隐私协议打开失败时不再退回泛化联系和期限文案。
16. MySQL `/ready` 已公开不含账号和授权原文的最小权限证明字段；灰度验证脚本要求 `leastPrivilegeReady=true`、`privilegeScope=SCHEMA`、`privilegePolicyEnforced=true`，否则候选 Store Gate 返回失败。
17. 公开隐私说明已携带候选版本元数据并纳入灰度验证；说明未配置、处理者缺失、联系方式无效、保存天数非正整数、政策版本缺失或未命中候选版本时，脚本以退出码 `5` 阻止后续切流。
18. Cloud Function 返回 `releaseVersion=0.5.6`，Admin 构建 manifest 记录 `releaseVersion=0.5.6`；后端镜像、云函数包和小程序源文件清单已生成本地 SHA-256 对照，正式上传时应与同一提交重新生成并核对。
19. Production Env Matrix 已把次日打卡提醒与 Root 会员中心购买跳转从可选说明提升为生产必过组。真实线上 31 个变量回读后为 6 组通过、6 组可选、8 组阻塞；Root 会员中心组通过，提醒组缺 `ROOT_CHECKIN_REMINDER_ENABLED`、模板 ID 和模板版本。
20. 2026-07-12 云端实测确认单函数触发器上限为 10；第 11 个触发器直接部署会以 `LimitExceeded.Trigger` 失败。当前正式拓扑为主函数 10 个触发器与独立健康保留期函数 1 个，仓库 Gate 同时检查每函数不超过 10、总计 11 个唯一 Job 和共享代码目录。
21. 同日已回滚占用灰度通道的旧候选任务，并把一次被平台拒绝的灰度请求暂存到 CloudRun 基础配置的 46 项变量恢复为稳定版 `012` 的 31 项。恢复后只读回读确认 MySQL Store、稳定密码非空、`OA/PUBLIC/MINIAPP`、1 至 2 实例均未变化，公网 `/health` 与 `/ready` 均为 HTTP 200；`v0.5.6` 0% 候选仍等待 macOS 钥匙串解锁后的候选密码安全回读，不得把该准备动作记为候选已部署。
