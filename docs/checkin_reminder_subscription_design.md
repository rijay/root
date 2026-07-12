# 打卡提醒订阅消息设计

## 版本

- 能力版本：`CHECKIN_REMINDER_NEXT_DAY / v2026-06-28-tpl10850`
- 适用小程序：myRoot 会员体验中心
- 发送目标：用户参加任意打卡活动后，次日通过微信小程序订阅消息提醒用户打卡
- 参考规范：微信小程序订阅消息 `wx.requestSubscribeMessage` 与订阅消息发送能力；授权必须由用户动作触发，用户拒绝后不阻断主流程

## 用户流程

1. 用户在任务页点击加入打卡活动。
2. 小程序加入活动成功后，调用微信原生订阅消息授权弹层。
3. 用户接受、拒绝或禁止订阅的结果写入后端 Store。
4. 后端按 `用户 + 活动 + 模板版本 + 提醒日期` 创建次日提醒任务。
5. 定时任务到期执行：
   - 若用户当天已经完成打卡，跳过发送。
   - 若用户未授权当前模板版本，跳过发送。
   - 若找不到 myRoot openid，标记失败，不重试打扰用户。
   - 若满足条件，调用微信订阅消息发送。

老用户兼容：如果用户已经加入过活动，下一次主动提交打卡时也会触发一次授权机会。同一模板版本的授权决定只询问一次，避免反复弹窗。

## Module 设计

后端新增 `checkinReminder` Module，Interface 分为四组：

- `getCheckinReminderTemplate`：返回当前模板 Key、模板 ID、版本、页面路径和提醒小时。
- `recordSubscription`：记录小程序端 `wx.requestSubscribeMessage` 的用户授权结果。
- `scheduleNextDayCheckinReminder`：在参与活动或完成打卡时创建次日提醒任务。
- `runDueCheckinReminders`：执行到期任务，完成发送、跳过或失败记录。

外部发送能力通过 `sendWechatSubscribeMessage` Adapter 接入现有微信 access token 逻辑。这个 seam 保留在 Domain 层，便于测试替换和生产发送隔离。

## 模板与配置

正式上线前必须配置：

```bash
ROOT_CHECKIN_REMINDER_TEMPLATE_ID=SOABCc3dk6tItVnjglFc94X6FVQo4LuZvnoZlHJTaBc
ROOT_CHECKIN_REMINDER_TEMPLATE_VERSION=v2026-06-28-tpl10850
ROOT_CHECKIN_REMINDER_HOUR=9
ROOT_CHECKIN_REMINDER_PAGE=pages/tasks/index
ROOT_CHECKIN_REMINDER_MINIPROGRAM_STATE=trial
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
5. 小程序端按 `templateKey + templateId + version` 记录用户授权决定；版本提升后可重新请求授权。

## 验证清单

- 加入活动后生成 1 条 `notificationJobs`，重复加入不新增。
- 用户接受订阅后，`notificationSubscriptions.status=ACCEPTED`。
- 到期任务执行前，如果当天已打卡，结果为 `SKIPPED_ALREADY_CHECKED_IN`。
- 到期任务执行前，如果未授权，结果为 `SKIPPED_NO_SUBSCRIPTION`。
- 已授权且未打卡时，发送 Adapter 收到 `touser/openid + template_id + page + data`。
- 体验版测试时 `ROOT_CHECKIN_REMINDER_MINIPROGRAM_STATE=trial`，正式版改为 `formal`。

## 定时任务

CloudBase Job Manifest 新增 `checkin_reminders`：

```bash
npm run jobs:manifest --prefix backend -- --base-url <云托管域名> --strict
npm run checkin-reminders --prefix backend -- --dry-run --limit 50
npm run checkin-reminders --prefix backend -- --execute --limit 50 --request-id checkin-reminders-YYYYMMDDHHmm
```

正式执行要求 `ROOT_JOB_BASE_URL`、`ROOT_ADMIN_JOB_TOKEN` 与稳定 `request_id`。建议每 10 分钟触发一次，单轮默认最多 50 条。

## 官方参考

- 微信小程序订阅消息授权：<https://developers.weixin.qq.com/miniprogram/dev/api/open-api/subscribe-message/wx.requestSubscribeMessage.html>
- 微信小程序订阅消息发送：<https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/mp-message-management/subscribe-message/sendMessage.html>
