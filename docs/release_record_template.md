# ROOT 7 日打卡发布记录模板

日期：2026-05-16
状态：后台已提供发布记录 Module；正式评审时以 `GET /api/v1/admin/release-record?target=production` 的实时结果为准。

## 1. 记录来源

后台入口：

1. 「发布记录」：看本次发布建议、阻塞项、灰度确认项、签字位和最近运行。
2. 「上线闸口」：看数据仓库 Adapter、微信登录密钥、正式域名和样本评审。
3. 「Adapter 校准」：看四类真实 Adapter 的样本准入、配置、运行记录和游标。
4. 「外部动作 Adapter 校准」：看有赞发券、券状态查询、企业微信标签写入和企业微信联系回写的配置与真实执行证据。
5. 「Adapter 运行」：对错误 `IMPORT` 运行执行人工回滚，撤回本次新建数据或恢复导入前字段快照，并保留审计。
6. 「Adapter 运行」详情：查看取样评审原始样本行，对照 raw/mapped 字段、错误和警告。
7. 「运营数据」：查看线索、注册、参与、商品跳转、订单、任务、结算和奖励发放漏斗、瓶颈项、趋势、预警、规则阈值、负责人路由、预警 Job 和 CSV 导出。
8. Element Plus Admin「开发发布」：集中查看发布记录、上线闸口、Production Env Matrix、动作 Adapter 校准、生产证据收口、CloudBase Store 决策、Root 会员中心购买跳转与跳转证明、旧数据迁移评估、旧静态后台下线决策和 CloudBase 身份透传探针；认证通过后验证真实 `x-wx-openid`、`x-wx-unionid`，只保留脱敏预览。
9. `/admin`：确认 Element Plus Admin 主入口加载成功，`/admin/assets/*.js` 返回 200；backend-only 部署前确认已执行 `npm run admin:build && npm run deploy:prepare-admin`；`/admin-legacy` 保留旧静态后台回退入口。
10. 「真实样本导入」：保留 `MANUAL_SAMPLE` 作为平台暂停后的人工处理入口。

HTTP Interface：

```bash
curl -s "http://127.0.0.1:8788/api/v1/admin/release-record?target=production"
curl -s "http://127.0.0.1:8788/api/v1/admin/release-record?target=gray"
curl -s "http://127.0.0.1:8788/api/v1/admin/action-adapter-calibration?target=production"
curl -s "http://127.0.0.1:8788/api/v1/admin/release-evidence-pack?target=production&baseUrl=http%3A%2F%2F127.0.0.1%3A8788&strict=true"
curl -s -X POST "http://127.0.0.1:8788/api/v1/admin/release-evidence-pack/archive" -H 'Content-Type: application/json' -H 'X-Request-Id: release-evidence-archive-xxx' -d '{"target":"production","baseUrl":"http://127.0.0.1:8788","strict":true,"note":"发布前证据留档","requestId":"release-evidence-archive-xxx"}'
curl -s "http://127.0.0.1:8788/api/v1/admin/release-evidence-pack/archive?archiveId=rel_evd_xxx"
curl -s -X POST "http://127.0.0.1:8788/api/v1/admin/release-signoffs" -H 'Content-Type: application/json' -H 'X-Request-Id: release-signoff-product-xxx' -d '{"target":"production","role":"PRODUCT","status":"APPROVED","archiveId":"rel_evd_xxx","note":"产品确认发布证据","requestId":"release-signoff-product-xxx"}'
curl -s -X POST "http://127.0.0.1:8788/api/v1/admin/admin-legacy-deprecation-decisions" -H 'Content-Type: application/json' -H 'X-Request-Id: admin-legacy-deprecation-decision-xxx' -d '{"target":"production","status":"APPROVED","evidenceRef":"https://example.com/admin-legacy-deprecation-proof","rollbackRef":"https://example.com/admin-legacy-rollback","note":"Element Plus Admin 灰度稳定，批准旧静态后台下线","requestId":"admin-legacy-deprecation-decision-xxx"}'
curl -s "http://127.0.0.1:8788/api/v1/admin/admin-legacy-deprecation-decisions?target=production"
curl -s -X POST "http://127.0.0.1:8788/api/v1/admin/production-cutover-proofs" -H 'Content-Type: application/json' -H 'X-Request-Id: production-cutover-proof-xxx' -d '{"target":"production","itemId":"cloudbase_unionid","status":"VERIFIED","evidenceRef":"https://example.com/proof","note":"CloudBase unionid 透传已验收","requestId":"production-cutover-proof-xxx"}'
curl -s "http://127.0.0.1:8788/api/v1/admin/production-cutover-proofs?target=production"
curl -s -X POST "http://127.0.0.1:8788/api/v1/admin/root-member-center-jump-proofs" -H 'Content-Type: application/json' -H 'X-Request-Id: root-member-center-jump-proof-xxx' -d '{"target":"production","productId":"ROOT_PREBIOTIC_TRIAL","status":"VERIFIED","appId":"wx_real_root_member_center","path":"pages/product/detail?id=ROOT_PREBIOTIC","evidenceRef":"https://example.com/root-member-center-jump-proof","note":"体验版商品页跳 Root 会员中心已验收","requestId":"root-member-center-jump-proof-xxx"}'
curl -s "http://127.0.0.1:8788/api/v1/admin/root-member-center-jump-proofs?target=production"
curl -s -X POST "http://127.0.0.1:8788/api/v1/admin/legacy-data-migration-decisions" -H 'Content-Type: application/json' -H 'X-Request-Id: legacy-data-migration-decision-xxx' -d '{"target":"production","policy":"READ_ONLY_ARCHIVE","status":"APPROVED","snapshotRef":"https://example.com/prod-snapshot","evidenceRef":"https://example.com/legacy-decision","note":"旧 7 日历史只读归档","requestId":"legacy-data-migration-decision-xxx"}'
curl -s "http://127.0.0.1:8788/api/v1/admin/legacy-data-migration-decisions?target=production"
curl -s -X POST "http://127.0.0.1:8788/api/v1/admin/legacy-data-migration-executions" -H 'Content-Type: application/json' -H 'X-Request-Id: legacy-data-migration-execution-xxx' -d '{"target":"production","action":"ARCHIVE_CONFIRMED","status":"VERIFIED","executionRef":"https://example.com/legacy-archive-run","evidenceRef":"https://example.com/legacy-execution","affectedSessionCount":12,"affectedFactCount":84,"note":"旧 7 日历史只读归档执行完成","requestId":"legacy-data-migration-execution-xxx"}'
curl -s "http://127.0.0.1:8788/api/v1/admin/legacy-data-migration-executions?target=production"
curl -s -X POST "http://127.0.0.1:8788/api/v1/admin/consultation-wework-writebacks" -H 'Content-Type: application/json' -H 'X-Request-Id: consultation-wework-writeback-xxx' -d '{"taskId":"task_xxx","adapterMode":"MANUAL","status":"DELIVERED","externalContactId":"wm_xxx","note":"已完成企微联系","requestId":"consultation-wework-writeback-xxx"}'
curl -s "http://127.0.0.1:8788/api/v1/admin/consultation-wework-writebacks?taskId=task_xxx"
curl -s -X POST "http://127.0.0.1:8788/api/v1/admin/consultation-advisor-assignments" -H 'Content-Type: application/json' -H 'X-Request-Id: consultation-advisor-assignment-xxx' -d '{"taskId":"task_xxx","assignmentMode":"MANUAL","advisorId":"advisor-a","advisorName":"顾问A","reason":"分配咨询顾问","requestId":"consultation-advisor-assignment-xxx"}'
curl -s "http://127.0.0.1:8788/api/v1/admin/consultation-advisor-assignments?taskId=task_xxx"
curl -s "http://127.0.0.1:8788/api/v1/admin/consultation-sla?status=OVERDUE&slaMinutes=120"
curl -s "http://127.0.0.1:8788/api/v1/admin/consultation-sla-escalations?slaMinutes=120&minLevel=2"
curl -s "http://127.0.0.1:8788/api/v1/admin/consultation-advisor-workbench?slaMinutes=120"
curl -s "http://127.0.0.1:8788/api/v1/admin/cloudbase-identity-probe" -H 'X-WX-OPENID: local-openid-for-route-shape' -H 'X-WX-UNIONID: local-unionid-for-route-shape'
curl -s "http://127.0.0.1:8788/api/v1/admin/operational-analytics?campaignId=ROOT_7D_RESET"
curl -s "http://127.0.0.1:8788/api/v1/admin/operational-analytics/export?campaignId=ROOT_7D_RESET" -o root-operational-analytics.csv
curl -s "http://127.0.0.1:8788/api/v1/admin/lifecycle-user-exports/delivery-health"
curl -s -X POST "http://127.0.0.1:8788/api/v1/admin/operational-alert-rules/upsert" -H 'Content-Type: application/json' -H 'X-Request-Id: operational-alert-rule-xxx' -d '{"alertRuleId":"op_alert_unresolved_leads","thresholdValue":3,"ownerRole":"运营","ownerName":"待填写","ownerContact":"待填写","routeKey":"ops:unresolved-leads","requestId":"operational-alert-rule-xxx"}'
curl -s -X POST "http://127.0.0.1:8788/api/v1/admin/operational-alert-rules/upsert" -H 'Content-Type: application/json' -H 'X-Request-Id: export-health-alert-rule-xxx' -d '{"alertRuleId":"op_alert_lifecycle_export_delivery_dead_letter","targetType":"LIFECYCLE_EXPORT_DELIVERY_HEALTH","targetKey":"DEAD_LETTER","metricKey":"deadLetterCount","thresholdValue":0,"ownerRole":"运营主管","ownerName":"待填写","ownerContact":"待填写","routeKey":"ops:lifecycle-export-delivery","requestId":"export-health-alert-rule-xxx"}'
curl -s -X POST "http://127.0.0.1:8788/api/v1/admin/operational-alert-rules/upsert" -H 'Content-Type: application/json' -H 'X-Request-Id: consultation-sla-alert-rule-xxx' -d '{"alertRuleId":"op_alert_consultation_sla_overdue","targetType":"CONSULTATION_SLA_OVERDUE","targetKey":"*","metricKey":"overdueMinutes","operator":">","thresholdValue":0,"ownerRole":"运营","ownerName":"待填写","ownerContact":"待填写","routeKey":"ops:consultation-sla","requestId":"consultation-sla-alert-rule-xxx"}'
curl -s -X POST "http://127.0.0.1:8788/api/v1/admin/operational-alert-rules/upsert" -H 'Content-Type: application/json' -H 'X-Request-Id: consultation-sla-escalation-rule-xxx' -d '{"alertRuleId":"op_alert_consultation_sla_escalation","targetType":"CONSULTATION_SLA_ESCALATION","targetKey":"*","metricKey":"escalationLevel","operator":">=","thresholdValue":2,"ownerRole":"运营主管","ownerName":"待填写","ownerContact":"待填写","routeKey":"ops:consultation-sla-escalation","requestId":"consultation-sla-escalation-rule-xxx"}'
curl -s -X POST "http://127.0.0.1:8788/api/v1/jobs/operational-alerts" -H 'Content-Type: application/json' -H 'X-Request-Id: operational-alert-job-xxx' -d '{"campaignId":"ROOT_7D_RESET","execute":false,"requestId":"operational-alert-job-xxx"}'
curl -s -X POST "http://127.0.0.1:8788/api/v1/admin/external-adapters/rollback" -H 'Content-Type: application/json' -H 'X-Request-Id: adapter-rollback-xxx' -d '{"runId":"run_xxx","confirmRisk":true,"reason":"字段映射错误，撤回本次导入","requestId":"adapter-rollback-xxx"}'
```

命令行报告：

```bash
npm run samples --prefix root_seven_day_checkin/backend -- --base-url http://127.0.0.1:8788 --mode import --youzan-file ./samples/youzan.csv --fulfillment-file ./samples/fulfillment.csv --wework-file ./samples/wework.csv --require-all-ready
npm run adapters --prefix root_seven_day_checkin/backend -- --base-url http://127.0.0.1:8788 --source youzan --mode preview --limit 1
npm run adapters --prefix root_seven_day_checkin/backend -- --base-url http://127.0.0.1:8788 --source customer --mode preview --limit 1
npm run adapters --prefix root_seven_day_checkin/backend -- --base-url http://127.0.0.1:8788 --source fulfillment --mode preview --limit 1
npm run adapters --prefix root_seven_day_checkin/backend -- --base-url http://127.0.0.1:8788 --source wework --mode preview --limit 1
npm run production-env --prefix root_seven_day_checkin/backend -- --target production
npm run jobs:manifest --prefix root_seven_day_checkin/backend -- --base-url http://127.0.0.1:8788 --campaign ROOT_7D_RESET
npm run operational-alerts --prefix root_seven_day_checkin/backend -- --base-url http://127.0.0.1:8788 --campaign ROOT_7D_RESET --dry-run
npm run operational-alerts --prefix root_seven_day_checkin/backend -- --base-url http://127.0.0.1:8788 --campaign ROOT_7D_RESET --execute --request-id operational-alert-job-xxx
npm run lifecycle-settlement-cleanup --prefix root_seven_day_checkin/backend -- --base-url http://127.0.0.1:8788 --campaign ROOT_7D_RESET --dry-run
npm run lifecycle-user-exports-cleanup --prefix root_seven_day_checkin/backend -- --base-url http://127.0.0.1:8788 --dry-run --limit 50
npm run lifecycle-user-exports-delivery-retry --prefix root_seven_day_checkin/backend -- --base-url http://127.0.0.1:8788 --dry-run --batch-size 20
npm run calibrate --prefix root_seven_day_checkin/backend -- --base-url http://127.0.0.1:8788 --target production --strict
npm run release:evidence --prefix root_seven_day_checkin/backend -- --base-url http://127.0.0.1:8788 --target production --strict
```

样本准入报告会先把真实导出文件转成取样评审；真实 Adapter 运行报告会记录小批量平台拉取结果、运行台账和重试状态；Production Env Matrix 会列出微信、MySQL、CloudBase Store 决策、Root 会员中心购买跳转、CloudBase Job、打卡提醒订阅消息、有赞、物流、企微、企微联系回写、咨询顾问分配、咨询 SLA/升级规则、复核解释模板、生命周期结算队列、生命周期结算队列清理阈值、生命周期定时导出口径、生命周期导出审批开关、生命周期导出交付通道、签名下载密钥、Webhook 通道/模板/超时、Webhook 交付重试阈值、对象目录、导出过期清理和外部预警变量缺口；CloudBase Job Manifest 会列出 Adapter 重试、运营预警、打卡提醒订阅消息、企微自动触达、生命周期结算队列调度、生命周期结算队列超时清理、用户生命周期定时导出、用户生命周期导出过期清理和用户生命周期导出交付重试的频率、命令、环境变量和安全策略；CloudBase 身份透传探针会返回 `READY/UNIONID_PENDING/BLOCKED` 和脱敏 openid/unionid 预览；Element Plus Admin「开发发布」页会把发布记录、上线闸口、Production Env Matrix、动作 Adapter 校准、发布证据包、最近留档、发布签字、签字 Gate、Admin 迁移 Gate、生产切换 Gate、生产切换证明记录、CloudBase Store 决策、Root 会员中心购买跳转与跳转证明、外部通道与负责人证据和探针结果聚合到同一处；Element Plus Admin 用户生命周期详情抽屉会记录咨询 SLA、咨询顾问分配和企微联系回写，用户生命周期页顾问工作台会汇总顾问负载、未分配咨询、SLA 超时、升级链路和待办明细；Element Plus Admin「奖励复核」页会展示 `ROOT_MANUAL_REVIEW_EXPLANATION_TEMPLATES` 的 `READY/NEEDS_REVIEW/BLOCKED` 校准状态和模板预览；发布前需确认手工记录、`ROOT_CONSULTATION_ADVISORS` 候选池、`ROOT_CONSULTATION_SLA_MINUTES`、`ROOT_CONSULTATION_SLA_DUE_SOON_MINUTES`、`ROOT_CONSULTATION_SLA_ESCALATION_RULES`、`ROOT_MANUAL_REVIEW_EXPLANATION_TEMPLATES` 和 `WEWORK_CONTACT_WRITEBACK` Adapter 的回执均不会泄露 token、secret、openid、unionid 或手机号原文；运营预警命令行报告会记录命中预警、负责人、通知结果、外部回执、失败原因和失败退出码，并覆盖咨询 SLA 超时、咨询 SLA 升级、生命周期结算队列失败/卡住站内预警与生命周期导出交付健康预警；打卡提醒 Job 报告会记录扫描任务数、发送、跳过和失败原因；生命周期结算队列清理报告会记录候选、重置、取消、记录和失败数；用户生命周期定时导出报告会记录命中用户、导出用户、文件大小、保留天数、字段策略、下载审批、外部交付和导出记录 ID；用户生命周期导出签名下载链接会记录外部引用但不暴露密钥；用户生命周期导出 Webhook 投递会记录通道、模板、签名状态、响应摘要和去 query 后的签名链接预览；用户生命周期导出交付重试报告会记录候选、执行、成功、重新排队、死信和失败数；用户生命周期导出通道健康会记录健康状态、通道成功率、到期重试、死信和失败原因聚合，并通过运营预警把死信和到期重试路由给负责人；用户生命周期导出过期清理报告会记录过期候选、对象删除、跳过、失败和移除记录数；发布校准报告会同时拉取发布记录、上线闸口、Production Env Matrix、外部通道与负责人、生产切换 Gate、Adapter 校准、动作 Adapter 校准和真实 Adapter 运行台账；发布证据包会把上述发布记录、Production Env Matrix、CloudBase Store 决策、Root 会员中心购买跳转、CloudBase Job Manifest、Adapter 校准、动作 Adapter 校准、签字 Gate、Admin 迁移 Gate、生产切换 Gate 和外部通道负责人证据汇总为脱敏留档，支持后台页面下载当前 JSON、通过 `POST /api/v1/admin/release-evidence-pack/archive` 保存留档，或通过 `GET /api/v1/admin/release-evidence-pack/archive?archiveId=...` 取回历史留档；生产切换证明可通过 `GET/POST /api/v1/admin/production-cutover-proofs` 查询和记录，Root 会员中心跳转证明可通过 `GET/POST /api/v1/admin/root-member-center-jump-proofs` 查询和记录，并会脱敏 token、secret、openid、unionid、手机号等敏感内容；发布签字通过 `POST /api/v1/admin/release-signoffs` 绑定到留档，不输出 token、secret、openid、unionid 或手机号原文，生产目标需产品、运营、研发均 `APPROVED` 后签字 Gate 才能变为 `READY`。若发布记录状态为 `BLOCKED`，退出码为 `2`，可直接用于上线前卡点。

旧 7 日历史数据迁移评估会随发布记录和发布证据包一起留档：当前只读统计旧周期、旧打卡、旧问卷、旧券、旧退款工作项和新任务/奖励/复核记录的桥接情况；真实补迁写入不是默认发布动作，需在生产快照和 dry-run 后另行签字。

CloudBase Store 决策会随发布记录和发布证据包一起留档：生产目标需明确 `ROOT_CLOUDBASE_STORE_DECISION`、CloudBase 环境 ID、地域、备份计划、回滚计划和证明引用；若选择 CloudBase Database 作为主 Store，必须先补齐对应 Store Adapter、迁移验证和回滚演练。

## 2. 决策填写

| 项 | 内容 |
| --- | --- |
| 发布目标 | `gray` 或 `production` |
| 发布建议 | 复制 `decision.recommendation` |
| 发布负责人 |  |
| 运营负责人 |  |
| 研发负责人 |  |
| 批准时间 |  |
| 备注 |  |

决策口径：

1. `READY`：可以进入发布窗口。
2. `NEEDS_REVIEW`：可以小流量灰度，但必须写清提醒项负责人。
3. `BLOCKED`：暂缓发布，先处理阻塞项。

## 3. 证据检查

上线前逐项确认：

1. `evidence.launchReadiness.blockers` 为空。
2. `evidence.adapterCalibration.sources` 中每个真实 Adapter 至少达到可解释状态。
3. `evidence.actionAdapterCalibration.status` 不是 `BLOCKED`；生产发布前有赞发券、券状态查询、企业微信标签写入和企业微信联系回写必须有真实 URL/token/字段映射和小批量成功回执。
4. `evidence.recentAdapterRuns` 中最近一次真实 Adapter `IMPORT` 没有失败。
5. `evidence.adapterCursors` 中真实 Adapter 已保存游标，或确认外部平台不提供游标。
6. `evidence.storeAdapter.kind` 不再是正式上线禁止的内存 Adapter。
7. `evidence.productionEnvMatrix.status` 不是 `BLOCKED`，`evidence.cloudbaseStoreReadiness.status` 不是 `BLOCKED`，`evidence.rootMemberCenterReadiness.status` 不是 `BLOCKED`，且每个真实上线必需变量组已有负责人。
8. 最近失败运行的 `retry_status` 已处理：`MANUAL_REVIEW` 有负责人，`RETRYABLE` 已重新预览或重试导入。
9. `GET /api/v1/admin/operational-analytics` 能返回运营漏斗、趋势、预警、预警规则、负责人路由和通知记录，且关键瓶颈项已有负责人或处置计划。
10. `npm run production-env --prefix backend -- --target production` 状态为 `READY` 或已记录所有 `BLOCKED/NEEDS_REVIEW` 负责人。
11. `npm run jobs:manifest --prefix backend -- --base-url <生产域名> --strict` 状态为 `PASS`，并确认 `ROOT_JOB_BASE_URL`、`ROOT_ADMIN_JOB_TOKEN` 与九个定时 Job 频率。
12. `evidence.externalChannelReadiness.status` 不是 `BLOCKED`，且 `alertOwnerRoutes` 中关键预警已有负责人姓名、联系方式和路由 Key；若为 `NEEDS_REVIEW`，必须写清负责人和处理时间。
13. `GET /api/v1/admin/release-evidence-pack?target=production` 和 `npm run release:evidence --prefix backend -- --base-url <生产域名> --target production --strict` 均能生成脱敏发布证据包；`POST /api/v1/admin/release-evidence-pack/archive` 可用稳定 `request_id` 保存本次证据，`GET /api/v1/admin/release-evidence-pack/archive?archiveId=...` 可按历史留档取回当时证据，`POST /api/v1/admin/release-signoffs` 可把产品、运营、研发签字绑定到该留档，并由 `signoffGate` 汇总是否全员通过。Element Plus「开发发布」页可下载当前 JSON、查看最近留档、下载历史留档、记录签字并查看 Gate。若为 `BLOCKED/NEEDS_REVIEW`，必须把负责人、处理时间和补证路径写入本记录，且确认输出中没有 token、secret、openid、unionid 或手机号原文。
14. `evidence.adminTransitionReadiness.status` 不是 `BLOCKED`，Element Plus Admin 六个模块均为 `READY`，`backend/public/admin-dist` 已生成，`/admin-legacy` 回退仍可用；若准备删除旧静态后台，必须通过 `POST /api/v1/admin/admin-legacy-deprecation-decisions` 记录 `APPROVED` 决策，并填写下线证据引用和回滚引用。`ROOT_LEGACY_ADMIN_DEPRECATION_APPROVED=true` 仅作为旧发布脚本兼容兜底。
15. `POST /api/v1/jobs/operational-alerts` 和 `npm run operational-alerts --prefix backend` 能 dry-run 预览；如本次发布启用执行模式，必须确认 `request_id`、通知渠道、负责人路由、`ADAPTER_RETRY_EXHAUSTED` 处理负责人、`LIFECYCLE_SETTLEMENT_JOB_FAILED` / `LIFECYCLE_SETTLEMENT_JOB_STALLED` 的队列处理负责人，以及 `LIFECYCLE_EXPORT_DELIVERY_HEALTH` 的导出死信和到期重试负责人。
16. `POST /api/v1/jobs/lifecycle-settlement-cleanup` 和 `npm run lifecycle-settlement-cleanup --prefix backend` 能 dry-run 预览；如本次发布启用执行模式，必须确认 `request_id`、`staleMinutes`、`cancelAfterMinutes`、`allowCancel` 和清理阈值变量，不允许默认误取消运营刻意暂停的队列。
17. 若启用 `WEBHOOK` 渠道，确认 `ROOT_OPERATIONAL_ALERT_WEBHOOK_URL`、`ROOT_OPERATIONAL_ALERT_WEBHOOK_SECRET`、`ROOT_OPERATIONAL_ALERT_WEBHOOK_CHANNEL`、`ROOT_OPERATIONAL_ALERT_WEBHOOK_TEMPLATE` 和 `ROOT_OPERATIONAL_ALERT_WEBHOOK_TIMEOUT_MS` 已在生产环境注入；执行记录必须能看到外部回执或错误，签名密钥不得写入仓库。
18. `GET /api/v1/admin/operational-analytics/export` 能导出 CSV，发布评审附件已留存。
19. `npm run lifecycle-users-export --prefix backend -- --dry-run --campaign <活动ID> --sensitivity MASKED` 能生成用户生命周期定时导出报告；execute 前确认 `ROOT_LIFECYCLE_EXPORT_RETENTION_DAYS`、`ROOT_LIFECYCLE_EXPORT_SENSITIVITY`、`ROOT_LIFECYCLE_EXPORT_APPROVAL_REQUIRED`、`ROOT_LIFECYCLE_EXPORT_DELIVERY_*`、`ROOT_LIFECYCLE_EXPORT_DOWNLOAD_SECRET`、`ROOT_LIFECYCLE_EXPORT_SIGNED_DOWNLOAD_*`、`ROOT_LIFECYCLE_EXPORT_DELIVERY_WEBHOOK_CHANNEL`、`ROOT_LIFECYCLE_EXPORT_DELIVERY_WEBHOOK_TEMPLATE`、`ROOT_LIFECYCLE_EXPORT_DELIVERY_TIMEOUT_MS`、`ROOT_LIFECYCLE_EXPORT_DELIVERY_RETRY_*`、`ROOT_LIFECYCLE_EXPORT_OBJECT_*`、`ROOT_LIFECYCLE_EXPORT_OBJECT_DIR`、下载权限、审批策略、签名 TTL、Webhook response summary、交付重试阈值和交付通道不会绕过审批；若启用对象目录 Adapter，需确认目录权限、清理策略和导出文件不进入仓库。
20. `npm run lifecycle-user-exports-delivery-retry --prefix backend -- --dry-run --batch-size 20` 能预览待重试交付，`GET /api/v1/admin/lifecycle-user-exports/delivery-health` 能返回通道健康、到期重试、死信和失败原因聚合，`POST /api/v1/jobs/operational-alerts` 能生成导出健康预警；execute 前确认 `request_id`、`ROOT_LIFECYCLE_EXPORT_DELIVERY_RETRY_BATCH_SIZE`、`ROOT_LIFECYCLE_EXPORT_DELIVERY_MAX_ATTEMPTS`、`ROOT_LIFECYCLE_EXPORT_DELIVERY_RETRY_DELAY_SECONDS`、Webhook/邮件/企微真实 URL 和模板、健康预警负责人，且失败重试不会绕过审批、签名过期和脱敏策略。
21. `npm run lifecycle-user-exports-cleanup --prefix backend -- --dry-run --limit 50` 能预览过期导出清理，Element Plus 用户生命周期导出记录抽屉也能执行清理预览；execute 前确认 `request_id`、`ROOT_LIFECYCLE_EXPORT_CLEANUP_LIMIT`、`ROOT_LIFECYCLE_EXPORT_OBJECT_CLEANUP_ENABLED`、对象目录或真实对象存储删除 Adapter、失败重跑策略和执行历史。
22. `GET/POST /api/v1/admin/lifecycle-filter-presets*` 能保存个人筛选和团队筛选；团队筛选在其他 operator 下可见但不可修改或删除，置顶排序符合运营约定。
23. `GET /api/v1/admin/me` 能返回当前 operator、role 和 capabilities，Element Plus Admin 菜单可见性与本次发布角色矩阵一致。
24. `GET /api/v1/admin/cloudbase-identity-probe` 在真实 CloudBase 请求中至少返回 openid；微信开放平台认证和应用绑定完成后必须返回 `READY`，且发布记录只保留脱敏预览。
25. `npm run deploy:prepare-admin` 已生成 `backend/public/admin-dist`，`GET /admin` 加载 Element Plus Admin，`GET /admin/assets/*.js` 返回 200，`GET /admin-legacy` 加载旧静态后台回退页。
26. `evidence.productionCutoverReadiness.status` 不是 `BLOCKED`；生产发布前需补齐微信开放平台、CloudBase unionid、Root 会员中心 appId、有赞、企微、CloudBase Job、外部通道、导出存储和回滚演练对应的 `ROOT_CUTOVER_*` 证明变量，或通过 `POST /api/v1/admin/production-cutover-proofs` 记录后台 `VERIFIED` 证明；若任一证明项最新记录为 `REJECTED`，必须重新验收并记录新的 `VERIFIED`，同时在发布记录中留存负责人说明、真实验收链接或截图引用。
27. `POST /api/v1/admin/consultation-wework-writebacks` 可记录人工或 `WEWORK_CONTACT_WRITEBACK` Adapter 回写，重复 `request_id` 不重复关闭待办；若启用自动 Adapter，需确认 `WEWORK_CONTACT_WRITEBACK_URL`、token、模板、外部联系人字段、回执字段和执行历史均已生产验收。
28. `POST /api/v1/admin/consultation-advisor-assignments` 可记录人工或 `AUTO` 咨询顾问分配，重复 `request_id` 不重复写入；若启用自动分配，需确认 `ROOT_CONSULTATION_ADVISORS` 和真实组织架构口径均已生产验收。
29. `GET /api/v1/admin/consultation-sla` 可返回超时咨询列表；若调整 SLA，需确认 `ROOT_CONSULTATION_SLA_MINUTES`、`ROOT_CONSULTATION_SLA_DUE_SOON_MINUTES`、`CONSULTATION_SLA_OVERDUE` 负责人路由和运营预警 Job 执行历史。
30. `GET /api/v1/admin/consultation-sla-escalations` 可返回超时升级列表；若调整升级链路，需确认 `ROOT_CONSULTATION_SLA_ESCALATION_RULES`、`CONSULTATION_SLA_ESCALATION` 负责人路由和运营预警 Job 执行历史。
31. 若配置 `ROOT_MANUAL_REVIEW_EXPLANATION_TEMPLATES`，需确认 `GET /api/v1/settlement/status` 只输出用户解释和所需证据，`GET /api/v1/admin/config-workbench` 才输出 `operatorGuidance`。
32. `GET /api/v1/admin/consultation-advisor-workbench` 可返回顾问负载、未分配咨询和 SLA 待办明细；接入真实企微在线状态前，需确认工作台不会把“在线/排班”作为自动分配依据。
33. `evidence.rootMemberCenterReadiness.status` 不是 `BLOCKED`；生产发布前需补齐真实 Root 会员中心 appId、商品级购买路径或 `ROOT_MEMBER_CENTER_PRODUCT_PATH`，并通过 `POST /api/v1/admin/root-member-center-jump-proofs` 留存与当前 appId/path 匹配的 `VERIFIED` 体验版跳转证明。
34. `evidence.legacyDataMigration.status` 不是 `BLOCKED`；若存在旧 7 日历史数据，生产发布前需通过 `POST /api/v1/admin/legacy-data-migration-decisions` 记录 `APPROVED` 生产处置决策，选择性补迁还必须填写生产快照引用和 dry-run 引用。
35. 若存在旧 7 日历史数据，`evidence.legacyDataMigration.execution.status` 必须为 `VERIFIED`，并且执行动作要匹配最新 `APPROVED` 决策；生产执行截图、链接或 CloudBase/对象存储留档需通过 `POST /api/v1/admin/legacy-data-migration-executions` 记录。
36. `evidence.productionEvidenceIntake.items` 应包含 T-001 到 T-010 的 10 条证据项；所有非 `READY` 项必须有负责人、来源 Gate 和下一步动作。生产证据收口只是追踪视图，底层上线判断仍以各 Gate、记录和真实外部验收为准。

## 4. 签字位

| 角色 | 负责人 | 状态 | 必答问题 |
| --- | --- | --- | --- |
| 产品 |  | `PENDING` | 流程、权益、断卡和退款提示是否确认 |
| 运营 |  | `PENDING` | 企业微信触达、免单处理和样本导入负责人是否在线 |
| 研发 |  | `PENDING` | Production Env Matrix、数据仓库 Adapter、CloudBase Store 决策、CloudBase Job Manifest、身份透传探针、日志和回滚入口是否确认 |

## 5. 回滚动作

若发布后出现字段映射错误、未知枚举、重复导入、误送达或待办异常，立即执行：

1. 暂停 `YOUZAN_OPEN`、`YOUZAN_CUSTOMER`、`YOUZAN_COUPON`、`FULFILLMENT_PUSH`、`WEWORK_CONTACT`、`WEWORK_TAG` 真实 Adapter。
2. 使用 `MANUAL_SAMPLE` 或后台手工入口继续订单、客户、券状态、物流、线索和标签处理。
3. 对误导入的 `IMPORT` 运行，优先通过 `POST /api/v1/admin/external-adapters/rollback` 撤回本次新建数据或恢复订单、履约、客户镜像和企微线索的导入前字段快照。
4. 保留当前运行台账和游标，不手工删除证据。
5. 必要时回退到发布前数据仓库快照。
6. 回滚后人工核对自动匹配产生的运营待办、生命周期事件和外部平台侧动作。
7. 修正字段映射或状态映射后，先 `PREVIEW`，再 `IMPORT limit=1` 恢复。
