# 027 次日打卡提醒复测就绪审查

日期：2026-07-14

状态：`RETEST_ELIGIBLE / DELIVERY_NOT_VERIFIED / NO_SEND_EXECUTED`

## 1. 实际读取来源

1. `backend/src/wechatHttp.js`、`backend/src/domain.js` 与 `backend/src/checkinReminder.js`。
2. `backend/tests/wechat_http.test.js` 及提醒授权、占用、发送和未知结果相关测试。
3. 025、026、027 候选证据和当前正式上线 Gate。
4. 微信官方[发送订阅消息](https://developers.weixin.qq.com/miniprogram/dev/server/API/mp-message-management/subscribe-message/api_sendmessage.html)文档。

本轮未读取微信凭据、openid、access token 或真实授权额度明细；未调用微信业务 Interface，未发送消息。

## 2. 当前请求契约

现有 Implementation 使用：

- `POST https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=...`
- JSON 请求体：`touser`、`template_id`、`page`、`miniprogram_state`、`lang`、`data`
- 模板字段：`thing3`、`thing2`、`thing1`
- UTF-8 Buffer 的真实字节数作为 `Content-Length`

该地址、方法和字段集合与微信官方文档一致。模板 ID、字段类型和具体值仍必须由行动时配置及新授权用户再次核对。

## 3. 025 失败与后续修复

1. 025 唯一真实发送返回外部 HTTP 412，没有微信 JSON `errcode`，结果标记为 `UNKNOWN`；没有重试。
2. 当时的 HTTP Implementation 可能使用 chunked 传输，这是候选原因，不是已证明根因。
3. v0.5.11 起，JSON POST 会显式写入 UTF-8 字节长度；含中文请求体的专向测试确认存在正确 `content-length`，且没有 `transfer-encoding`。
4. 非 JSON 或非 2xx 响应会保留限长、脱敏的 content-type、trace 和正文摘要；token、openid、手机号和长标识会被清理。
5. 026 与 027 都没有执行微信业务 POST，所以当前只能判定“修复已进入候选并具备复测条件”，不能判定“412 已修复”或“提醒已送达”。

微信官方错误表列出 `40001`、`40003`、`40014`、`40037`、`43101`、`43107`、`43108`、`45168`、`47003` 等业务码，没有 HTTP 412。由此推断，025 更可能在微信业务 JSON 处理之前被传输或边缘层拒绝；该推断必须由下一次唯一真实请求验证。

## 4. 单次真实复测前置

以下条件必须同时满足：

1. 两个 Cloud Function 先对齐到 v0.5.12，并完成 11/11 Job dry-run；全局 `ROOT_JOB_DRY_RUN=true` 保持不变。
2. 上传同版本体验版并完成 T-013 核心流程，确认模板授权弹层真实出现。
3. 使用新的独立微信账号和新的 Root 用户，避免手机号合并到旧用户。
4. 用户在真机明确选择“允许”，后台形成恰好一条 `AVAILABLE` 额度和一条新的 `SCHEDULED / attempts=0` 任务。
5. 行动前 dry-run 必须只命中这一条任务，并返回 `DRY_RUN_READY`；不得存在旧 `SENDING`、`UNKNOWN` 或第二条到期任务。
6. 只对该任务取得一次真实发送确认，`sendConcurrency=1`、`limit=1`，不依赖自动触发器。
7. 发送后立即回读任务、额度、送达记录和审计，再由真机确认是否收到消息。

## 5. 结果判定

| 结果 | 判定 | 后续动作 |
| --- | --- | --- |
| HTTP 2xx、`errcode=0`、真机收到 | `VERIFIED` | 记录 T-011 证据，额度应为 `CONSUMED` |
| 微信业务码 `43101` | `NO_GRANT` | 停止，核对授权弹层与额度，不重试 |
| 其他明确微信业务码 | `NOT_SENT` | 停止，按官方错误码修正；新授权后另行确认 |
| HTTP 412、非 JSON、超时或无明确业务码 | `UNKNOWN` | 停止，不重试；额度进入人工核验 |
| 后端成功但真机未见 | `NEEDS_REVIEW` | 不重复发送，核对消息中心、模板状态和平台记录 |

任何 `UNKNOWN` 都不得复用同一额度或 request ID。

## 6. 回退

1. 真实复测前保持 Function 全局 dry-run，避免定时器自动发送。
2. 复测失败不调整 027 流量，不重新发送，不把任务或额度手工改成成功。
3. 如出现传输失败，保留脱敏 trace、HTTP 状态和诊断摘要，使用后续候选修复；稳定版 012 继续承接默认流量。
4. 不删除失败送达记录，使用追加式证据说明结果。

## 7. 对抗式审查

1. **Content-Length 测试通过不等于微信接受请求**：只有生产 CloudRun 到微信的真实请求能关闭 412 风险。
2. **HTTP 2xx 不等于用户看到消息**：还要核对 `errcode=0`、送达记录与真机结果。
3. **新的微信号不等于新的 Root 用户**：相同手机号可能合并，必须回读独立 `root_user_id`。
4. **dry-run 就绪不等于可以批量发送**：真实批次固定为一条、并发一。
5. **失败可诊断不等于可以重试**：结果不明确时继续保持人工核验。

## 8. 结论

027 已具备执行一次新用户真实提醒复测的代码条件，但 Cloud Function 对齐、同版本体验版、新额度和行动时确认仍未完成。当前 T-011 保持 `BLOCKED`，不得把本审查写成送达证明。
