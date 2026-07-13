# myRoot v0.5.11 生产 0% 候选预检

日期：2026-07-13

状态：`PREFLIGHT_PASS / DEPLOYED_AS_026_AT_ZERO_PERCENT / REAL_SEND_BLOCKED`

## 1. 实际读取来源

1. 当前工作树中的 `domain`、`wechatHttp`、`checkinReminder`、MySQL Store、版本文件、测试和 v0.5.10 发布证据。
2. 025 唯一一次真实提醒结果：`FAILED / 1006 / external HTTP 412 / externalErrorCode=null / deliveryOutcome=UNKNOWN`，以及发送后 `scannedCount=0 / staleSendingCount=0`。
3. 行动时 CloudRun 微信配置、微信令牌与模板清单只读探针；只记录匹配结果和字段形状，不读取或输出凭据值。
4. 微信官方发送订阅消息 Interface；文档定义 HTTPS POST、请求体和业务错误码，没有定义 HTTP 412。
5. 本地线级复现、定向测试、后端全量测试、完整 `npm run verify` 和受控候选工件清单。

## 2. 缺失与工作假设

1. 缺少独立账号手机端对上一条通知是否可见的观察；这影响 `UNKNOWN` 的人工判定，不影响禁止重试。
2. 缺少原始 412 响应头和响应体；旧 Implementation 已丢弃，无法恢复。
3. 已确认旧请求采用 chunked，但尚未确认它就是 412 的唯一根因。v0.5.11 必须通过新候选运行证据验证，不能把本地假设写成生产结论。
4. 本轮没有重新读取 CloudBase 发布单或生产 MySQL；部署前必须行动时回读稳定版、候选版、0% 路由、函数锁和 Store 状态。

## 3. 本地 Gate

| Gate | 结果 |
| --- | --- |
| 版本一致性 | 根项目、后端、Admin、小程序、Cloud Function 均为 `0.5.11` |
| 新传输测试 | `4/4 PASS` |
| 提醒与 HTTP Interface 回归 | `171/171 PASS` |
| 后端全量 | `257/257 PASS` |
| 完整验收 | `15/15 PASS`；225 个 JavaScript 文件；5 个迁移 |
| 后端 ZIP | 1,072,804 bytes；185 个条目；SHA-256 `bf2ad367df73161d870eff2c467aaa54f264fbbd13542d10247c2f74e6787b48` |
| 展开源码 | 176 个文件；内容清单 SHA-256 `6e3bdcd940ea3826cb89c1f5cb065870ddf67af60def1d16168803429dd625bc` |
| 小程序清单 | 157 个文件；509,550 bytes；SHA-256 `55d830685ba1ba6102e06ad3249ae5e63bb975847d431888d141dc1f622e35d1` |

## 4. 目标与影响

1. 目标：在取得单独确认后，将平台分配的下一版本作为 `v0.5.11 / URL_PARAMS / 0%` 条件候选；预期版本名为 `myroot-api-026`，最终以平台回读为准。
2. 影响：所有直连微信的 JSON POST 在没有调用者覆盖时显式发送 UTF-8 字节长度；登录、手机号和订阅消息共享同一深 Module。
3. 影响：外部响应读取上限为 64 KiB；失败证据可包含脱敏内容类型、追踪号和限长摘要，不包含 token、OpenID、UnionID、手机号或完整响应。
4. 影响：没有稳定微信 `errcode` 的失败仍为 `UNKNOWN`，不改变 `REVIEW_REQUIRED` 和禁止自动重发规则。
5. 数据：没有新迁移，不修改授权账本结构，不回收旧 `REVIEW_REQUIRED` 额度。

## 5. 部署与验证顺序

1. 行动时回读 012、025、发布单、0% 条件路由、VPC、变量名和两个 Cloud Function 的 `ROOT_JOB_DRY_RUN=true`；任一不一致即停止。
2. 单独确认后部署新 0% 候选；不得改变默认流量，不得删除 025 或历史版本。
3. 定向验证 `/health`、`/ready`、迁移 005、schema 最小权限、隐私、Admin 和微信只读探针；再验证候选发送请求的 `Content-Length` 形状。
4. 单独确认后只更新两个 Cloud Function 代码包，回读 6 个变量、10+1 个触发器、新候选路由和全局 dry-run，复测 11/11 Job。
5. 单独确认后上传同版本体验版并由新独立用户重新授权；只允许生成新的额度和任务。
6. 先做恰好一个任务的未来时刻 dry-run。真实发送必须使用新请求 ID，并再次单独确认；任何失败都停止，不自动重试。

## 6. 回滚

1. 构建或运行失败：结束新候选，012 继续承接默认流量；不修改生产数据。
2. 微信只读探针或请求形状不符：保持函数 dry-run，放弃新候选，不获取新授权。
3. 真实发送结果不明确：任务和额度进入人工核验，立即停止；不把失败分类改成明确未发送，也不再次发送。
4. 本版无数据库迁移，不执行 down migration，不删除迁移 005 或历史发送证据。

## 7. 执行后结论

经单独确认，`v0.5.11` 已于 2026-07-13 部署为 `myroot-api-026 / URL_PARAMS / 0%`。定向 `/health`、`/ready`、MySQL 迁移与最小权限、隐私、Admin 和 15 次无参数默认流量保护均通过；两个 Cloud Function 保持上一版代码包、10+1 个启用触发器与 `ROOT_JOB_DRY_RUN=true`，本轮未调用 Job。未上传体验版、未发送提醒、未执行微信业务 POST、未 commit 或 push，因此 `Content-Length` 的线上外部结果与正式提醒送达 Gate 继续为 `BLOCKED`。完整行动时证据见 [候选 026 证据](./production_gray_release_026_2026-07-13.md)。
