# myRoot v0.5.11 发布说明

状态：已部署为 `myroot-api-026 / URL_PARAMS / 0%`；未 commit、未 push、未上传小程序、未修改 Cloud Function、未发送提醒

## 1. 本版目标

025 候选的唯一一次新单用户真实提醒返回 `FAILED / 1006 / external HTTP 412 / deliveryOutcome=UNKNOWN`，没有微信业务 `errcode`，也没有第二次请求。v0.5.11 只修复微信 HTTP 传输形状和失败诊断，不改变授权账本、任务状态、Store 检查点或自动重试规则。

已确认的事实：

1. v0.5.10 的微信 JSON POST 没有显式 `Content-Length`，Node.js 实际使用 chunked 传输。
2. 非 JSON 响应会在解析阶段丢失 HTTP 状态、内容类型、追踪头和安全响应摘要。
3. AppID、AppSecret、令牌、模板 ID 和 `thing1/thing2/thing3` 已通过只读探针。

仍未确认的事实：

1. chunked 是否就是微信 `HTTP 412` 的唯一根因。
2. 独立账号手机端是否实际收到上一条结果不明确的通知。
3. 原始 412 响应头和响应体；旧 Implementation 已丢弃，不能事后补造。

## 2. Module 与 Interface 变化

1. 新增 `wechatHttp` Module，向 Domain 层只提供 `fetchWechatJson` Interface；传输、限长读取、JSON 解析和脱敏诊断集中在同一处，提升 Locality。
2. 所有带请求体的微信请求在调用者未显式提供长度或传输编码时，按 UTF-8 实际字节数写入 `Content-Length`，不再默认使用 chunked。
3. 响应最多读取 64 KiB；非 2xx 或非 JSON 响应只保留 HTTP 状态、白名单内容类型、格式安全的追踪号和最多 240 字符的脱敏摘要。
4. `access_token`、CloudBase token、secret、session key、OpenID、UnionID、接收方、手机号、`msgid`、Bearer 值和长标识都会在诊断进入调用方前脱敏。
5. 没有微信业务 `errcode` 的 HTTP 或解析失败仍不设置 `externalCode`。提醒发送因此继续分类为 `UNKNOWN`，匹配额度进入 `REVIEW_REQUIRED`，不会被误释放或自动重发。
6. 明确的微信业务错误仍保留稳定 `errcode`：`43101` 继续使额度失效，其他明确未发送错误继续按既有语义处理。

## 3. 验证

1. 新增 4 个 `wechatHttp` 测试：UTF-8 字节长度、无 chunked、412 非 JSON 脱敏诊断、200 非 JSON 不明确结果和微信业务错误码保留。
2. 提醒与 HTTP Interface 定向回归：`171/171 PASS`。
3. 后端全量测试：`257/257 PASS`。
4. 根项目完整验收：`15/15 PASS`，覆盖 225 个 JavaScript 文件、5 个不可变迁移、生产依赖审计、Admin 构建、小程序检查、双函数 11 Job 拓扑和 HTTP Interface smoke。
5. 根项目、后端、Admin、小程序和 Cloud Function 版本统一为 `0.5.11`。

候选工件：

- 后端 ZIP：`/tmp/myroot-api-0.5.11-local-20260713-r2.zip`，1,072,804 bytes，185 个条目，SHA-256 `bf2ad367df73161d870eff2c467aaa54f264fbbd13542d10247c2f74e6787b48`。
- 展开源码：176 个文件，内容清单 SHA-256 `6e3bdcd940ea3826cb89c1f5cb065870ddf67af60def1d16168803429dd625bc`。
- 小程序：157 个文件、509,550 bytes，清单 SHA-256 `55d830685ba1ba6102e06ad3249ae5e63bb975847d431888d141dc1f622e35d1`。

## 4. 发布与回滚约束

1. 当前生产候选为 `myroot-api-026 / v0.5.11 / URL_PARAMS / 0%`，稳定版 012 继续承接默认流量；15 次无参数健康请求均未命中 026。
2. 026 已回读为 `normal`，BuildId `2601310799`；48 个环境变量值、VPC、1 至 2 个实例与端口 80 均与部署快照一致。
3. 本版没有数据库迁移。回滚只需结束 026 候选并保留稳定状态，不删除迁移 005，也不改变生产数据。
4. 两个 Cloud Function 仍保持上一轮代码包、10+1 个启用触发器、026 条件路由与 `ROOT_JOB_DRY_RUN=true`；本轮没有更新或调用它们。
5. 025 的失败任务、请求 ID 和 `REVIEW_REQUIRED` 额度永久封存，不得在 026 或后续版本复用。
6. 本轮未上传体验版、未发送提醒、未执行微信业务 POST；完整证据见 [候选 026 证据](./production_gray_release_026_2026-07-13.md)。

## 5. 下一次真实验证前置条件

1. 先记录独立账号微信“服务通知”中上一条提醒是否可见；只观察，不重新授权或触发发送。
2. 026 的 `/health`、`/ready`、隐私、Admin 和默认流量保护已经通过；下一次授权前仍需用不发送消息的受控观测证明 `Content-Length` 进入线上候选 Implementation。
3. 对齐两个 Cloud Function 代码包并复测 11/11 Job，保持全局 dry-run。
4. 使用新的独立用户原生授权生成全新 `AVAILABLE` 额度和新 `SCHEDULED` 任务；不得迁移或释放旧额度。
5. 候选 dry-run 必须恰好返回 1 个 `DRY_RUN_READY`，再单独申请一次新的真实发送授权。
