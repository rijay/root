# ROOT 真实 Adapter 上线校准包

日期：2026-05-16
状态：有赞订单、有赞客户、物流状态、企业微信线索四类拉取 Adapter 均已具备可配置 HTTP Implementation；有赞发券、券状态查询、企业微信标签写入和企业微信联系回写四类动作 Adapter 已纳入独立校准 Gate；有赞订单已具备后台增量同步运营入口和 Element Plus Adapter 运行页，运行台账已支持详情、取样评审明细、原始样本行排查、`runId` 深链、客户镜像排查、券状态查询、企微标签发放 UI、重跑、失败重试策略、运行级人工回滚和字段级快照回滚；上线前必须用真实账号完成校准。

## 1. 校准目标

上线校准不是重新开发 Adapter，而是确认三件事：

1. 平台请求配置能跑通。
2. 返回字段能稳定映射到内部样本字段。
3. 小批量 `IMPORT` 后不会破坏订单匹配、物流启动、线索待办和退款资格。

后台入口：

1. 「上线闸口」看整体阻塞。
2. 「Adapter 校准」看四类拉取 Adapter 的配置、样本准入、最近运行和游标。
3. 「外部动作 Adapter 校准」看有赞发券、券状态查询、企业微信标签写入和企业微信联系回写的运行配置与真实执行证据。
4. 「真实 Adapter 接入」或 Element Plus Admin 的「Adapter 运行」看 Adapter 状态、运行台账和运行详情。
5. 在运行详情抽屉中查看取样评审的字段覆盖率、缺失字段、未知状态和原始样本行；必要时使用 `?module=adapters&runId=...` 直接定位某次运行。
6. 在「有赞客户镜像」中按 `yzUid`、UnionID、`root_user_id`、手机号或昵称排查客户补链和订单自动绑定结果。
7. 在「奖励复核」中选择有赞券发放任务，执行自动状态查询或人工回写 `ISSUED/USED/EXPIRED/CANCELLED`。
8. 在「奖励复核」中选择 `WEWORK_TAG` 发放任务，查看标签/外部联系人提示并填入 `externalContactId`、`tagId`、`tagName`。
9. 在「Adapter 运行」详情中对错误 `IMPORT` 运行执行人工回滚，撤回本次新建数据并写入审计。
10. 在「Adapter 运行」详情中查看 `retry_status`、`retry_attempt`、`next_retry_at` 和 `retry_source_run_id`，区分可重试失败和需人工处理失败。
11. 「发布记录」看发布建议、签字位和回滚动作。

HTTP Interface：

```bash
curl -s http://127.0.0.1:8788/api/v1/admin/adapter-calibration
curl -s 'http://127.0.0.1:8788/api/v1/admin/action-adapter-calibration?target=production'
curl -s http://127.0.0.1:8788/api/v1/admin/external-adapters
curl -s 'http://127.0.0.1:8788/api/v1/admin/external-sample-reviews?reviewId=rev_xxx'
curl -s 'http://127.0.0.1:8788/api/v1/admin/youzan-customers?keyword=yz_xxx'
curl -s -X POST http://127.0.0.1:8788/api/v1/admin/reward-delivery/status-query -H 'Content-Type: application/json' -H 'X-Request-Id: status-query-xxx' -d '{"deliveryJobIds":["job_xxx"],"deliveryMode":"MANUAL","externalStatus":"USED","requestId":"status-query-xxx"}'
curl -s -X POST http://127.0.0.1:8788/api/v1/admin/reward-delivery/execute -H 'Content-Type: application/json' -H 'X-Request-Id: wework-tag-xxx' -d '{"deliveryJobIds":["job_xxx"],"deliveryMode":"MANUAL","externalContactId":"wm_xxx","tagId":"tag_xxx","tagName":"ROOT 21天用户","confirmRisk":true,"requestId":"wework-tag-xxx"}'
curl -s -X POST http://127.0.0.1:8788/api/v1/admin/external-adapters/rollback -H 'Content-Type: application/json' -H 'X-Request-Id: adapter-rollback-xxx' -d '{"runId":"run_xxx","confirmRisk":true,"reason":"字段映射错误，撤回本次导入","requestId":"adapter-rollback-xxx"}'
curl -s http://127.0.0.1:8788/api/v1/admin/launch-readiness?target=production
curl -s http://127.0.0.1:8788/api/v1/admin/release-record?target=production
curl -s -X POST http://127.0.0.1:8788/api/v1/admin/orders/increment-preview -H 'Content-Type: application/json' -d '{"adapterKind":"YOUZAN_OPEN","limit":1}'
```

命令行校准报告：

```bash
npm run samples --prefix root_seven_day_checkin/backend -- --base-url http://127.0.0.1:8788 --mode preview --youzan-file ./samples/youzan.csv
npm run samples --prefix root_seven_day_checkin/backend -- --base-url http://127.0.0.1:8788 --mode import --youzan-file ./samples/youzan.csv --fulfillment-file ./samples/fulfillment.csv --wework-file ./samples/wework.csv --require-all-ready
npm run adapters --prefix root_seven_day_checkin/backend -- --base-url http://127.0.0.1:8788 --source youzan --mode preview --limit 1
npm run adapters --prefix root_seven_day_checkin/backend -- --base-url http://127.0.0.1:8788 --source customer --mode preview --limit 1
npm run adapters --prefix root_seven_day_checkin/backend -- --base-url http://127.0.0.1:8788 --source fulfillment --mode import --limit 1
npm run adapters --prefix root_seven_day_checkin/backend -- --base-url http://127.0.0.1:8788 --source wework --mode preview --limit 1
npm run calibrate --prefix root_seven_day_checkin/backend -- --base-url http://127.0.0.1:8788 --target gray
npm run calibrate --prefix root_seven_day_checkin/backend -- --base-url http://127.0.0.1:8788 --target production --strict
```

发布校准退出码：

1. `0`：可继续发布或灰度。
2. `2`：发布记录仍为 `BLOCKED`。
3. `3`：`--strict` 模式下仍有 `NEEDS_REVIEW`。
4. `1`：后台不可访问或 HTTP Interface 返回错误。

样本准入命令补充说明：

1. 不带 `--require-all-ready` 时，只判断本次传入文件是否存在错误或未知枚举。
2. 带 `--require-all-ready` 时，会额外要求四类样本准入都不再 `BLOCKED`。
3. `--mode preview` 只记录评审，不写入订单、物流或线索。
4. `--mode import` 会写入灰度数据仓库，请先确认样本来自真实导出。

真实 Adapter 运行命令补充说明：

1. `--source` 支持 `youzan`、`customer`、`fulfillment`、`wework`。
2. 默认执行真实 Adapter 的 `PREVIEW`，建议首轮都使用 `--mode preview --limit 1`。
3. `--mode import` 会写入灰度数据仓库，并在真实 Adapter 返回游标时推进游标。
4. 缺少凭证、字段映射错误或运行失败会返回非 0 退出码，并写入 Adapter 运行台账。
5. 如果 `IMPORT` 后发现字段映射错误，先在运行详情执行人工回滚；该动作会撤回本次新建数据，也会恢复既有订单、履约、客户镜像和企微线索的导入前字段快照。
6. 字段级快照不回滚自动匹配产生的运营待办、生命周期事件或外部平台侧动作；回滚后仍要检查对应运行详情、审计和用户生命周期。
7. 字段校准阶段优先查看原始样本行排查，把 raw 字段名、mapped 字段和 errors/warnings 对齐后再调整环境变量或状态映射。

动作 Adapter 校准补充说明：

1. `GET /api/v1/admin/action-adapter-calibration?target=production` 只输出变量名、状态、检查消息和脱敏证据摘要，不输出 token、openid、unionid 或手机号原文。
2. 生产目标缺 URL/token 或缺真实成功执行记录会进入 `BLOCKED`；灰度目标缺同类证据会进入 `NEEDS_REVIEW`。
3. 有赞发券和企业微信标签写入的成功证据来自 `rewardDeliveryJobs` 的 `DELIVERED` 记录；有赞券状态查询要求 `status_checked_at` 和非 `UNKNOWN` 外部状态；企业微信联系回写要求 `consultationWeworkWritebacks` 中有 `DELIVERED` 记录。
4. 若动作 Adapter 最近一次真实执行失败，应先暂停自动动作，改用人工发券、人工状态回写或人工企业微信处理，再修正字段映射后重新执行小批量校准。

## 2. 配置表

### 2.1 有赞订单

必须配置：

| 环境变量 | 说明 |
| --- | --- |
| `YOUZAN_CLIENT_ID` | 有赞应用标识 |
| `YOUZAN_GRANT_ID` | 已授权 ROOT 店铺 ID |
| `YOUZAN_ACCESS_TOKEN` | 当前可用访问 token |
| `YOUZAN_ACCESS_TOKEN_EXPIRES_AT` | ISO 8601 到期时间；发布时至少剩余 24 小时 |
| `YOUZAN_TOKEN_MANAGEMENT_MODE` | 当前只允许 `STATIC_ROTATION` |
| `YOUZAN_TOKEN_ROTATION_OWNER` | 集中换取与轮换 token 的唯一负责人 |
| `YOUZAN_ORDER_LIST_URL` | 订单列表请求地址 |

建议配置：

| 环境变量 | 说明 |
| --- | --- |
| `YOUZAN_ORDER_LIST_DATA_PATH` | 订单数组路径 |
| `YOUZAN_ORDER_LIST_CURSOR_PATH` | 下一页游标路径 |
| `YOUZAN_ORDER_LIST_HAS_MORE_PATH` | 是否还有下一页路径 |
| `YOUZAN_ORDER_FIELD_MAP` | 字段映射 JSON |
| `YOUZAN_TOKEN_MIN_REMAINING_MINUTES` | 运行时最小剩余分钟数，默认只拒绝已过期 token |

`YOUZAN_CLIENT_SECRET` 仅用于在受控轮换终端换取 token，必须留在密码管理器，不进入 CloudRun 运行环境。样本预览响应可供当前授权管理员校准字段；写入 Store 的评审行会自动脱敏手机号、UnionID、地址、昵称、订单号、运单号和企微外部联系人等值，只保留字段结构、覆盖率、状态枚举与必要业务字段。

最小字段确认：

1. `youzanOrderNo`
2. `receiverPhone`
3. `amount`
4. `orderStatus`
5. `deliveryStatus`
6. `rawAddressText`

后台运营入口：

1. `POST /api/v1/admin/orders/increment-preview` 用于 live 小批量预览，不写入订单。
2. `POST /api/v1/admin/orders/increment-execute` 用于确认导入，必须带 `request_id` 和二次确认。
3. 确认导入后会提交真实 Adapter 返回的游标，并写入 `YOUZAN_ORDER_INCREMENT_SYNC` 审计。
4. 若只提供样本文本，可把 `text` 传入同一入口走 `MANUAL_SAMPLE`，用于校准前灰度演练。
5. Element Plus Admin「Adapter 运行」页已接入同一入口，并展示运行台账与游标。
6. 运行台账可打开运行详情，并可按历史来源、Adapter、limit 和游标重新预览或重试导入；失败运行会展示重试状态、建议重试时间和来源失败运行。

Token 校准要求：

1. 自用型无容器应用使用 `client_id + client_secret + grant_id` 换取 token；有赞官方说明 token 约 7 天有效。
2. 当前 CloudBase 最多 2 个实例，不允许各实例独立换 token；由唯一负责人集中换取后写入密钥管理，并同步到期时间。
3. 生产环境缺轮换模式、负责人、grant_id、到期时间，或 token 已过期时，六个有赞调用点都会在网络请求前失败关闭。
4. 换取与轮换过程不得把 client secret、token 或完整响应写入仓库、命令参数、日志和证据包。

官方参考：

- https://doc.youzanyun.com/resource/doc/3031
- https://developers.youzanyun.com/article/1573212038519

### 2.2 有赞客户

必须配置：

| 环境变量 | 说明 |
| --- | --- |
| `YOUZAN_CUSTOMER_LIST_URL` | 客户列表请求地址 |
| `YOUZAN_USER_QUERY_URL` | UnionID 查询有赞用户请求地址，当前使用 `youzan.users.info.query/1.0.1` |
| `YOUZAN_CUSTOMER_ACCESS_TOKEN` 或 `YOUZAN_ACCESS_TOKEN` | 至少配置一个可用访问 token |
| `ROOT_YOUZAN_IDENTITY_RECONCILE_ENABLED` | 正式小批量校准通过后设为 `true`；此前保持 `false` |

建议配置：

| 环境变量 | 说明 |
| --- | --- |
| `YOUZAN_CUSTOMER_LIST_DATA_PATH` | 客户数组路径 |
| `YOUZAN_CUSTOMER_LIST_CURSOR_PATH` | 下一页游标路径 |
| `YOUZAN_CUSTOMER_LIST_HAS_MORE_PATH` | 是否还有下一页路径 |
| `YOUZAN_CUSTOMER_FIELD_MAP` | 字段映射 JSON |
| `YOUZAN_USER_QUERY_ACCESS_TOKEN` | 身份查询单独使用的 token；未配置时复用客户或全局 token |
| `YOUZAN_USER_QUERY_RESULT_TYPES` | 返回类型，默认 `[0,1,2,9]` |
| `ROOT_YOUZAN_IDENTITY_RECONCILE_BATCH_SIZE` | 每轮查询数量，默认 5，最大 20 |
| `ROOT_YOUZAN_IDENTITY_RECONCILE_REFRESH_HOURS` | 成功身份复核周期，默认 168 小时，范围 1 至 720 |

最小字段确认：

1. 客户列表必须确认 `youzanYzUid`，官方字段为 `yz_open_id`。
2. 手机号和昵称仅用于镜像展示与人工核对，不作为唯一主键。
3. UnionID 来自 myRoot 微信身份；客户列表不要求直接返回 UnionID。
4. User Query 必须确认同一 UnionID 返回的一个或多个 `yz_open_id`，并验证去重。

校准顺序：

1. 用客户列表 Interface 预览一页，确认 `page_no`、`page_size`、`record_list` 和分页结束条件。
2. 保持 Job dry-run，运行 `npm run youzan-identity-reconcile --prefix backend -- --dry-run --batch-size 5`，只核对候选数和配置缺口。
3. 确认 token 托管或刷新策略、User Query 权限和负责人后，把开关设为 `true`，先用 `--execute --batch-size 1`。
4. 核对同一 UnionID 多身份、未绑定订单补链、重复 Root 归属隔离、Root 用户桥接缺失、`yz_open_id` 已有归属不覆盖和订单冲突待办。
5. 证据不得包含原始 UnionID、手机号、OpenID、token 或完整有赞响应。

### 2.3 有赞优惠券发放与状态查询

发券必须配置：

| 环境变量 | 说明 |
| --- | --- |
| `YOUZAN_COUPON_SEND_URL` | 优惠券发放请求地址 |
| `YOUZAN_COUPON_ACCESS_TOKEN` 或 `YOUZAN_ACCESS_TOKEN` | 至少配置一个可用访问 token |

状态查询必须配置：

| 环境变量 | 说明 |
| --- | --- |
| `YOUZAN_COUPON_STATUS_URL` | 优惠券状态查询请求地址 |
| `YOUZAN_COUPON_STATUS_ACCESS_TOKEN`、`YOUZAN_COUPON_ACCESS_TOKEN` 或 `YOUZAN_ACCESS_TOKEN` | 至少配置一个可用访问 token |

建议配置：

| 环境变量 | 说明 |
| --- | --- |
| `YOUZAN_COUPON_RESULT_REF_PATH` | 发券响应里的外部券码路径 |
| `YOUZAN_COUPON_STATUS_REF_PARAM` | 查询请求里的券码参数名，默认 `coupon_no` |
| `YOUZAN_COUPON_STATUS_PATH` | 状态字段路径 |
| `YOUZAN_COUPON_STATUS_REF_PATH` | 状态响应里的外部券码路径 |
| `YOUZAN_COUPON_STATUS_USED_AT_PATH` | 核销时间字段路径 |
| `YOUZAN_COUPON_STATUS_EXPIRED_AT_PATH` | 过期时间字段路径 |
| `YOUZAN_COUPON_STATUS_FIELD_MAP` | 状态响应字段映射 JSON |

最小字段确认：

1. 外部券码。
2. 外部状态，至少能区分 `ISSUED`、`USED`、`EXPIRED`、`CANCELLED`。
3. 核销时间或过期时间，若平台返回。

### 2.4 物流状态

必须配置：

| 环境变量 | 说明 |
| --- | --- |
| `ROOT_FULFILLMENT_SECRET` | 物流来源密钥 |
| `ROOT_FULFILLMENT_LIST_URL` | 物流事件列表请求地址 |

建议配置：

| 环境变量 | 说明 |
| --- | --- |
| `ROOT_FULFILLMENT_SECRET_LOCATION` | `header`、`query` 或 `body` |
| `ROOT_FULFILLMENT_LIST_DATA_PATH` | 物流事件数组路径 |
| `ROOT_FULFILLMENT_LIST_CURSOR_PATH` | 下一页游标路径 |
| `ROOT_FULFILLMENT_LIST_HAS_MORE_PATH` | 是否还有下一页路径 |
| `ROOT_FULFILLMENT_FIELD_MAP` | 字段映射 JSON |

最小字段确认：

1. `youzanOrderNo` 或 `orderId`
2. `trackingNo`
3. `deliveryStatus`
4. `deliveredAt`
5. `lastEventText`

### 2.5 企业微信线索

必须配置：

| 环境变量 | 说明 |
| --- | --- |
| `WEWORK_CORP_ID` | 企业微信 corp id |
| `WEWORK_CONTACT_LIST_URL` | 外部联系人或线索列表请求地址 |
| `WEWORK_CONTACT_SECRET` 或 `WEWORK_ACCESS_TOKEN` | 至少配置一个认证来源 |

建议配置：

| 环境变量 | 说明 |
| --- | --- |
| `WEWORK_ACCESS_TOKEN_LOCATION` | `query` 或 `header` |
| `WEWORK_CONTACT_SECRET_LOCATION` | `header`、`query`、`body` 或 `none` |
| `WEWORK_CONTACT_LIST_DATA_PATH` | 线索数组路径 |
| `WEWORK_CONTACT_LIST_CURSOR_PATH` | 下一页游标路径 |
| `WEWORK_CONTACT_LIST_HAS_MORE_PATH` | 是否还有下一页路径 |
| `WEWORK_CONTACT_FIELD_MAP` | 字段映射 JSON |

最小字段确认：

1. `externalContactId`
2. `remarkName`
3. `receiverPhone`
4. `sourceChannel`
5. `corpWechatStatus`

### 2.6 企业微信标签写入

必须配置：

| 环境变量 | 说明 |
| --- | --- |
| `WEWORK_TAG_APPLY_URL` | 标签写入请求地址 |
| `WEWORK_TAG_ACCESS_TOKEN`、`WEWORK_ACCESS_TOKEN` 或 `WEWORK_CONTACT_ACCESS_TOKEN` | 至少配置一个可用访问 token |

建议配置：

| 环境变量 | 说明 |
| --- | --- |
| `WEWORK_TAG_APPLY_METHOD` | `POST` 或 `GET`，默认 `POST` |
| `WEWORK_TAG_ACCESS_TOKEN_LOCATION` | `query`、`header` 或 `body` |
| `WEWORK_TAG_DEFAULT_ID` | 奖励 payload 没有标签 ID 时的默认标签 ID |
| `WEWORK_TAG_APPLY_EXTRA_PARAMS` | 额外请求参数 JSON |
| `WEWORK_TAG_RESULT_STATUS_PATH` | 响应状态字段路径 |
| `WEWORK_TAG_RESULT_REF_PATH` | 外部写入凭证字段路径 |
| `WEWORK_TAG_RESULT_MESSAGE_PATH` | 响应消息字段路径 |
| `WEWORK_TAG_RESULT_FIELD_MAP` | 响应字段映射 JSON |

最小字段确认：

1. 企微外部联系人 ID，优先来自 `leadProfiles.external_contact_id`。
2. 标签 ID，优先来自奖励 payload 的 `tagId`。
3. 企微返回状态和外部写入凭证。
4. Element Plus Admin 的 `weworkTagHint` 能回显正确标签和外部联系人，并可把字段送入奖励发放 Interface。

## 3. 校准顺序

1. 先用 `MANUAL_SAMPLE` 补齐四类来源各 3 条真实样本。
2. 让后台「Adapter 准入」达到 `READY` 或可解释的 `NEEDS_REVIEW`。
3. 配置一个真实 Adapter 的环境变量，不要同时打开四类。
4. 对该 Adapter 执行 `PREVIEW`，确认字段映射、未知枚举和提醒项。
5. 若出现未知状态，先在「取样评审台账」保存映射，再重新 `PREVIEW`。
6. 执行 `IMPORT`，`limit=1`，确认导入结果、运行记录和游标。
7. 重复执行第二页，确认不会重复导入同一批记录。
8. 完成一个 Adapter 后再进入下一类。
9. 四类样本 Adapter 稳定后，再用奖励发放 Interface 小批量校准有赞券发放/状态查询和企微标签写入。

推荐顺序：

1. 有赞订单。
2. 有赞客户。
3. 物流状态。
4. 企业微信线索。
5. 有赞券发放/状态查询。
6. 企业微信标签写入。

## 4. 灰度试跑

灰度首日建议：

1. 数据仓库使用 SQLite Adapter。
2. 四类真实 Adapter 每次只跑 1 页。
3. 每次 `IMPORT` 后打开后台用户详情抽查 3 个用户。
4. 保留 `MANUAL_SAMPLE`、手工订单同步和手工物流更新入口。
5. 每天固定跑一次 `daily-audit`，检查运营待办是否异常堆积。
6. 每 10 到 15 分钟跑一次 Adapter 到期重试 dry-run，确认候选数量和跳过原因；稳定后用 CloudBase 定时触发 `POST /api/v1/jobs/adapter-retry-due`，或临时执行 `npm run adapter-retry --prefix backend -- --request-id adapter-retry-due-YYYYMMDDHHmm --batch-size 5`。

灰度成功标准：

1. 没有未知状态枚举。
2. 有赞订单导入后，手机号匹配结果符合预期。
3. 物流 `DELIVERED` 后，用户能进入 Day1 启动或已送达待开始列表。
4. 企业微信缺手机号线索进入 `LEAD_NEEDS_MATCHING`，不会静默丢失。
5. 四类 Adapter 都有成功运行记录，真实 Adapter 有游标或明确确认平台不提供游标。

## 5. 回滚判断

立即暂停真实 Adapter 的情况：

1. 字段映射把订单号、手机号或物流状态写错。
2. 未知枚举被导入为内部状态。
3. 同一批外部记录重复导入并影响运营待办。
4. 物流误把未签收订单变成 `DELIVERED`。
5. 企业微信线索大量缺少可人工识别的信息。

回滚方式：

1. 不再调用对应真实 Adapter 的 `IMPORT`。
2. 保留运行台账和游标，不手工删除；失败处理优先看 `retry_status`，`MANUAL_REVIEW` 先修配置/映射，`RETRYABLE` 再用「Adapter 运行」页重新预览或重试导入。
3. 用 `MANUAL_SAMPLE` 或后台手工入口继续灰度。
4. 修正字段映射或状态映射后，先重新 `PREVIEW`。
5. 再用 `limit=1` 小批量恢复。
