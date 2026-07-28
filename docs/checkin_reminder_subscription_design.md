# 打卡提醒订阅消息设计

## 版本

- 能力版本：`CHECKIN_REMINDER_NEXT_DAY / v2026-06-28-tpl10850`
- 适用小程序：myRoot 会员体验中心
- 发送目标：用户已开始或参与现有打卡任务后，在任务页主动申请一次次日打卡提醒
- 参考规范：微信小程序订阅消息 `wx.requestSubscribeMessage` 与订阅消息发送能力；授权必须由用户动作触发，用户拒绝后不阻断主流程
- 文档迭代：`v1.0.0 / R1.1`；Canonical 发送结果使用 `PROVIDER_ACCEPTED / OUTCOME_UNKNOWN`，不得以 `SENT/UNKNOWN` 作为目标态
- v1.0.0 状态：`TARGET_DESIGN / D-010_SIGNOFF_PENDING`；下文现有模板值和 2026-07-13 证据只作为 v0.5.x 迁移输入，不自动成为 v1.0.0 冻结模板、授权额度、送达证据或发布 Gate

## 用户流程

1. 有效打卡任务只产生提醒可申请性，不自动创建发送 Job；任务页或进度页预载当前冻结模板，不在此时弹出授权。
2. 用户点击独立的“开启明日提醒”按钮；点击处理的第一项异步动作是调用微信原生订阅消息 Interface。
3. 用户接受、拒绝、平台禁用或调用结果未知的标准化结果写入后端 Store，并在当前页面常驻展示；拒绝不阻断任务主流程。
4. 后端以 `grantRequestId` 幂等记录 `AVAILABLE` 一次性额度，并为同一 `taskId + taskOccurrenceDate + templateVersion` 创建唯一 `SCHEDULED` Job；授权记录与排期结果分别展示。
5. 定时任务到期执行：
   - 若用户当天已经完成打卡，跳过发送。
   - 若用户未授权当前模板版本，跳过发送。
   - 若找不到 myRoot openid，标记失败，不重试打扰用户。
   - 若满足条件，调用微信订阅消息发送。

老用户兼容：已经加入过活动的用户可以从任务页或进度页主动开启提醒；完成打卡后会进入带有同一按钮的进度页。该模板属于一次性订阅消息，小程序不自行永久缓存 `accept/reject`；是否展示授权面板及“总是保持以上选择”由微信原生设置决定。

## Module 设计

目标 `Check-in Reminder Module` 复用并升级 v0.5.13 已有的 `checkinReminder` Implementation；现有名称不代表目标事实合同已经完成。目标 Interface 分为四组：

- `getCheckinReminderTemplate`：返回当前模板 Key、模板 ID、版本、页面路径和提醒小时。
- `recordSubscription`：记录小程序端 `wx.requestSubscribeMessage` 的用户授权结果。
- `scheduleNextDayCheckinReminder`：只在用户主动授权已记录且存在 `AVAILABLE` 额度后排期；旧活动参与记录和旧 `ACCEPTED` 状态不能自动创建 v1 Job。
- `runDueCheckinReminders`：执行到期任务，完成发送、跳过或失败记录。

外部发送能力通过 `sendWechatSubscribeMessage` Adapter 接入现有微信 access token 逻辑。这个 Seam 保留在 Domain 层，便于测试替换和生产发送隔离。

生产发送 Endpoint Policy Module 固定只接受 `https://api.weixin.qq.com/cgi-bin/message/subscribe/send`：必须在获取 access token 前校验一次，在附加唯一非空 `access_token` 后、进入网络 Seam 前再校验一次；禁止 userinfo、非默认端口、额外 query、fragment、lookalike host、HTTP 与任何 loopback。即使 `NODE_ENV=test`，只要存在受保护运行时标记也不得放宽；订阅发送路径在任何运行时均不接受 loopback。HTTP Adapter 使用 `redirect=manual`，不得跟随 302/307 将 token 或 payload 转发到第二主机。正式 real-send 开关打开但 endpoint 配置不满足精确官方值时，应用启动与 Production Env Matrix 必须 fail-close。

小程序端 `checkin-reminder-subscribe` Module 提供两个 Interface：

- `preloadCheckinReminderTemplate`：在按钮可操作前加载并仅在当前进程缓存非敏感模板配置。
- `requestCheckinReminderSubscribe`：只使用已预载模板，确保 `wx.requestSubscribeMessage` 先于订阅结果写入；该 Interface 不读取或写入本地授权缓存。

## 模板与配置

正式上线前必须配置：

```bash
ROOT_CHECKIN_REMINDER_TEMPLATE_ID=SOABCc3dk6tItVnjglFc94X6FVQo4LuZvnoZlHJTaBc
ROOT_CHECKIN_REMINDER_TEMPLATE_VERSION=v2026-06-28-tpl10850
ROOT_CHECKIN_REMINDER_HOUR=9
ROOT_CHECKIN_REMINDER_PAGE=pages/tasks/index
ROOT_CHECKIN_REMINDER_MINIPROGRAM_STATE=trial
ROOT_CHECKIN_REMINDER_SEND_CONCURRENCY=5
ROOT_CHECKIN_REMINDER_SENDING_REVIEW_MINUTES=15
ROOT_CHECKIN_REMINDER_TEMPLATE_TITLE=活动提醒
ROOT_WECHAT_APPID=wx7727a02565aed1c2
ROOT_WECHAT_APPSECRET=...
```

当前微信公众平台模板：

- 模板编号：`10850`
- 标题：`活动提醒`
- 类目：`投票`
- 模板 ID：`SOABCc3dk6tItVnjglFc94X6FVQo4LuZvnoZlHJTaBc`
- 字段：`thing3=活动名称`、`thing2=注意事项`、`thing1=活动商品`

字段映射：

```bash
ROOT_CHECKIN_REMINDER_TEMPLATE_DATA_JSON='{"thing3":{"value":"{{campaignTitle}}"},"thing2":{"value":"{{actionText}}"},"thing1":{"value":"{{productName}}"}}'
```

如果运营没有配置 `ROOT_CHECKIN_REMINDER_TEMPLATE_DATA_JSON`，后端默认使用同一套 `thing3/thing2/thing1` 字段，避免误发送旧模板字段。该模板没有时间字段，提醒时间由定时任务触发时间决定，不在卡片字段中展示。

支持占位符：

- `{{campaignId}}`
- `{{campaignTitle}}`
- `{{reminderDate}}`
- `{{reminderHour}}`
- `{{reminderTimeText}}`
- `{{actionText}}`
- `{{productName}}`

## 版本管理规则

1. 模板字段、模板 ID 或跳转页面有变化时，必须提升 `ROOT_CHECKIN_REMINDER_TEMPLATE_VERSION`。
2. 已生成的 `notificationJobs` 保留当时的 `template_id`、`template_version`、`page` 和 `data_json`，不被新版本覆盖。
3. 下线旧模板前，先确认旧版本任务已经没有 `SCHEDULED` 状态。
4. 若模板发送异常，先把 `ROOT_CHECKIN_REMINDER_ENABLED=false`，再排查模板字段或微信凭证。
5. 小程序只把标准化授权结果写入后端 Store，不以本地缓存跳过原生调用；每次调用必须由标明“开启明日提醒”的独立按钮触发，且调用前不得等待网络请求。
6. 当前模板是一次性订阅。每次原生授权接受都以稳定 `grant_request_id` 生成一条 `notificationSubscriptionGrants`；`ACCEPTED` 只描述最近一次选择，实际发送必须占用 `AVAILABLE` 授权并在微信受理后转为 `CONSUMED`。
7. 旧版只有 `notificationSubscriptions.status=ACCEPTED` 的记录不补造授权额度；升级后必须由用户再次点击“开启明日提醒”。

## 授权账本与发送一致性

1. 小程序在调用 `wx.requestSubscribeMessage` 前同步生成 `grant_request_id`，原生授权完成后以同一个请求 ID 写入后端；网络重试复用该 ID，不重复生成额度。
2. 到期执行只选择与用户、任务发生日和模板版本相符的 `AVAILABLE` 授权；没有额度时返回 `status=SKIPPED, reason=NO_GRANT`，不能仅凭最近一次 `ACCEPTED` 发送。
3. Store Module 在调用微信前把任务写为 `SENDING`、授权写为 `RESERVED` 并提交检查点；提交后释放 MySQL 快照锁，再通过发送 Adapter 批量执行，默认并发 5、最大 20。
4. 微信调用结束后重新进入 Store Module，按任务 ID 和授权 ID 绑定最新数据；微信 `errcode=0` 只写入 `PROVIDER_ACCEPTED/CONSUMED`，不能写成“已送达”。发送成功但最终提交失败时，已提交的 `SENDING/RESERVED` 会阻止自动重发。
5. 只有在尚未调用发送 Adapter 时产生 `SKIPPED`，并用 `reason` 区分 `ALREADY_CHECKED_IN / NO_SUBSCRIPTION / NO_GRANT`；若此前已 `RESERVED` 且确认未调用 Adapter，才按冻结规则释放额度。微信 `43101` 写为 Job `FAILED(reason=WECHAT_NO_GRANT)` 并把额度置为 `INVALID`；网络结果不明确时 Job 进入 `OUTCOME_UNKNOWN`、额度进入 `REVIEW_REQUIRED`。`SENDING` 超过默认 15 分钟仍未完成时，同样进入人工核验，不自动重试。
6. 送达证据只保存收件人存在性、模板、页面、字段键、微信受理状态、稳定错误码和脱敏说明；不保存 `touser/openid`、access token、完整请求或原始 `msgid`。
7. 持久化 Seam 冻结四层业务唯一约束：`UNIQUE(grantRequestId)`、`UNIQUE(rootUserId, taskId, taskOccurrenceDate, templateVersion)`、一个 grant 最多绑定一个有效 Job、一个 Job 最多创建一个不可逆 `notification_send_attempt`。不同幂等键不能绕过这些约束。
8. Runner 必须先原子占用唯一发送 attempt 并提交，再调用微信 Adapter；重复 Runner、回调或进程恢复只查询原 attempt，不创建替代 Job 或第二次不可逆发送。

## 验证清单

- 有效任务本身不自动生成 `notificationJobs`；只有用户主动授权且额度记录成功后才生成 1 条唯一 Job，同一 `taskId + taskOccurrenceDate + templateVersion` 重复排期不新增。
- 用户接受订阅后，`notificationSubscriptions.status=ACCEPTED` 且新增 1 条 `notificationSubscriptionGrants.status=AVAILABLE`；同一 `grant_request_id` 重试不新增。
- `OUTCOME_UNKNOWN`、`subscribed=0` 或仅看到页面正常跳转均不得记为订阅通过。
- 到期任务执行前，如果当天已打卡，结果为 `status=SKIPPED, reason=ALREADY_CHECKED_IN`。
- 到期任务执行前，如果未授权，结果为 `status=SKIPPED, reason=NO_SUBSCRIPTION`。
- 最近状态为已接受但没有可用额度时，结果为 `status=SKIPPED, reason=NO_GRANT`。
- 已授权且未打卡时，发送 Adapter 收到 `touser/openid + template_id + page + data`。
- 体验版测试时 `ROOT_CHECKIN_REMINDER_MINIPROGRAM_STATE=trial`，正式版改为 `formal`。
- 失败记录必须同时保留稳定错误码和脱敏微信说明；不得只保存统一业务码，也不得把 token、openid 或完整请求写入错误文本。
- 同一授权额度不得被两个提醒任务复用；结果不明确时不得自动重试，重新发送必须先取得新的用户授权、行动时确认和请求 ID。
- 批量发送前只提交一次检查点，发送期间不持有 MySQL 快照锁；并发数必须受 `ROOT_CHECKIN_REMINDER_SEND_CONCURRENCY` 限制。
- 真实发送的 HTTP Interface 必须同时获得 Store Module 的 `checkpoint` 与 `resume`；缺任一 Interface 时以 `50301` fail-closed，不调用微信发送 Adapter。
- dry-run 只返回 `recipient_present`、模板、页面、运行态和字段键，不返回 `touser`、OpenID、消息内容或消息 ID。
- 微信 JSON POST 必须显式设置 UTF-8 `Content-Length`；非 2xx 或非 JSON 响应只能保留状态、白名单内容类型、安全追踪号和限长脱敏摘要。没有微信业务 `errcode` 时继续按 `OUTCOME_UNKNOWN` 处理，不得因 HTTP 状态推断为明确未发送。

## 2026-07-13 Legacy v0.5.x 真机证据（不关闭 v1.0.0 Gate）

- 第四轮 `v0.5.9` 定向预览中，用户点击独立提醒按钮后，Legacy 页面常驻文案显示“已开启”；v1.0.0 不沿用该合并文案，必须区分授权、排期、微信受理和真机收件。
- CloudBase SQL 只读回读为 `notification_subscription.status=ACCEPTED`、`subscribed=1`，更新时间 `2026-07-13 13:52:05`。
- 次日任务保持 `SCHEDULED`，计划 `2026-07-14 09:00` 执行，`attempts=0` 且无错误。
- 本证据只在当时 v0.5.x 探针口径下证明一次授权记录，不关闭 v1.0.0 D-010、C0/C1 或 D1 Gate，也不替代实际消息送达证明。
- 当前任务为 `miniprogram_state=formal / lang=zh_CN`；它可用于正式目标验证，不能替代定向预览的 `trial` 跳转证明。
- 024 候选 Job Interface 在模拟 `2026-07-14 09:01 +08:00` 时返回 `DRY_RUN_READY`，请求形状包含 openid、模板、`pages/tasks/index` 与 `thing1/thing2/thing3`；全程只输出存在性，不输出标识值。
- Cloud Function 的 `checkin_reminders` 触发器每 10 分钟启用，但 `ROOT_JOB_DRY_RUN=true`，真实发送必须单独确认并使用稳定 `request_id`。
- 正式目标发送已按确认执行一次，结果为 `FAILED / 1006 / attempts=1 / delivered_at=null`，未重试。AppID、密钥令牌、模板归属和字段均已通过只读探针，但 024 丢失微信原始 `errmsg`，所以实际失败原因尚未确定。
- `v0.5.10` 已部署为 025 的 0% 条件候选，补齐一次性授权账本、发送前检查点、未知结果人工核验、受控并发和送达证据最小化；迁移为 `005_notification_subscription_grants.sql`。历史 `ACCEPTED` 不会自动转成可用额度。
- 025 的新单用户真实发送只执行一次，返回 `FAILED / 1006 / external HTTP 412 / UNKNOWN`，没有微信业务 `errcode`，未重试；匹配额度按账本语义进入 `REVIEW_REQUIRED`。
- `v0.5.11` 后续已部署为 026 的 0% 条件候选，显式写入 `Content-Length` 并增加非 JSON HTTP 响应的限长脱敏诊断；但 026 没有执行微信业务 POST 或提醒发送，因此不能证明 chunked 是 412 的唯一根因，也不能证明消息送达。
- 当时的 `v0.5.12` 已部署为 027 的 0% 条件候选，仍未发送提醒；当前仓库代码基线已是 `v0.5.13`，但这不会追溯性地产生 v1.0.0 提醒证据。唯一已执行的新授权单用户发送证据继续是 025 的 `HTTP 412 / UNKNOWN`，不得据 027 或本地 v0.5.13 运行健康推断提醒 Gate 已关闭。

## 定时任务

CloudBase Job Manifest 新增 `checkin_reminders`：

```bash
npm run jobs:manifest --prefix backend -- --base-url <云托管域名> --strict
npm run checkin-reminders --prefix backend -- --dry-run --limit 50
npm run checkin-reminders --prefix backend -- --execute --limit 50 --request-id checkin-reminders-YYYYMMDDHHmm
```

正式执行要求 `ROOT_JOB_BASE_URL`、`ROOT_ADMIN_JOB_TOKEN` 与稳定 `request_id`。建议每 10 分钟触发一次，单轮默认最多 50 条，外部发送默认最多 5 路并发。

## 官方参考

- 微信小程序订阅消息授权：<https://developers.weixin.qq.com/miniprogram/dev/api/open-api/subscribe-message/wx.requestSubscribeMessage.html>
- 微信小程序订阅消息发送：<https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/mp-message-management/subscribe-message/sendMessage.html>
