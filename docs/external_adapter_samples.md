# ROOT 真实 Adapter 字段样本规格

日期：2026-05-16
状态：已提供后台样本导入、预览校验、CSV/表格文本解析、取样模板、取样评审台账、原始样本行排查、未知枚举映射、真实平台 Adapter 状态台、运行记录、失败重试策略、增量游标、运行级人工回滚、字段级 before snapshot、可配置有赞订单 HTTP Implementation、可配置有赞客户 HTTP Implementation、可配置物流 HTTP Implementation、可配置企业微信 HTTP Implementation 和 SQLite/JSON 文件保存。

## 1. 目标

本规格用于把有赞订单、有赞客户、物流状态和企业微信线索的真实样本先放进统一的样本 Adapter。它的职责不是替代正式平台 Adapter，而是提前验证字段名称、缺失情况、状态枚举和人工匹配规则。

当前实现位置：

1. Store Module：`backend/src/store.js`
2. External Adapter Sample Module：`backend/src/externalAdapterSamples.js`
3. External Platform Adapter Module：`backend/src/externalPlatformAdapters.js`
4. Youzan Open Adapter Module：`backend/src/youzanOpenAdapter.js`
5. Youzan Customer Adapter Module：`backend/src/youzanCustomerAdapter.js`
6. Youzan Customer Mirror Module：`backend/src/youzanCustomerMirror.js`
7. Fulfillment HTTP Adapter Module：`backend/src/fulfillmentHttpAdapter.js`
8. WeWork Contact Adapter Module：`backend/src/weworkContactAdapter.js`
9. External Adapter Implementations Module：`backend/src/externalAdapterImplementations.js`
10. HTTP Interface 路径：
   - `GET /api/v1/admin/external-adapters`
   - `POST /api/v1/admin/external-adapters/run`
	   - `POST /api/v1/admin/external-samples/preview`
	   - `POST /api/v1/admin/external-samples/import`
	   - `GET /api/v1/admin/external-samples/template`
	   - `POST /api/v1/admin/external-status-mappings`
	   - `POST /api/v1/admin/external-adapters/rollback`
11. 后台入口：管理台「真实样本导入」
12. 台账输出：管理台「真实 Adapter 接入」「取样评审台账」

支持输入形态：

1. JSON 数组。
2. CSV 文本，第一行为字段名。
3. 从表格复制出来的 TSV 文本，第一行为字段名。

导入回滚说明：

1. `IMPORT` 会在运行台账保存可回滚目标，支持按 `run_id` 撤回本次新建的订单、履约、有赞客户镜像或企微线索。
2. 如果导入行更新了既有记录，运行台账会在 target metadata 中保存 `beforeSnapshot`；回滚时恢复订单、履约、有赞客户镜像或企微线索的导入前字段。
3. 回滚动作要求 `request_id` 和二次风险确认，并写入 `EXTERNAL_ADAPTER_RUN_ROLLBACK` 审计。
4. 字段级快照只覆盖目标主记录；自动匹配产生的运营待办、生命周期事件和外部平台侧动作仍需人工核对。

取样评审行级排查说明：

1. 每次 `PREVIEW` 或 `IMPORT` 评审会在 `review.rows` 中保留行级 raw、mapped、field presence、errors、warnings、imported 和 result summary。
2. 行级排查用于确认真实平台字段名、字段覆盖率、未知枚举和单行映射问题。
3. 当前只保留最近 30 次评审；若真实导出样本行数或字段体积明显变大，后续应拆成独立分页存储。

失败重试策略说明：

1. 运行台账会保存 `retry_status`、`retry_attempt`、`retry_source_run_id`、`retry_reason` 和 `next_retry_at`。
2. 缺配置、缺 Implementation、字段校准或样本问题进入 `MANUAL_REVIEW`，需要运营或研发先修正配置/映射。
3. 真实 Adapter 的 5xx、429、超时和网络抖动类失败进入 `RETRYABLE`，并给出建议重试时间。
4. 从失败运行重新预览或重试导入时，应携带 `retrySourceRunId`；成功后新运行会记录 `RETRY_SUCCEEDED`。
5. 当前只记录策略和 lineage；自动按 `next_retry_at` 扫描重试的调度器仍需后续新增。

## 2. 样本来源

### 2.1 有赞订单：`YOUZAN_ORDER`

最小必填：

| 内部字段 | 可识别字段名 | 说明 |
| --- | --- | --- |
| `youzanOrderNo` | `有赞订单号`、`订单号`、`订单编号`、`youzanOrderNo` | 订单唯一识别 |
| `receiverPhone` | `收货手机号`、`收件手机号`、`手机号`、`receiverPhone` | 用户和订单匹配主键候选 |

建议提供：

| 内部字段 | 可识别字段名 |
| --- | --- |
| `receiverName` | `收货人`、`收件人` |
| `productName` | `商品名称`、`商品名` |
| `productId` | `商品ID`、`商品编码` |
| `amount` | `实付金额`、`支付金额`、`订单金额` |
| `paidAt` | `支付时间`、`付款时间` |
| `orderStatus` | `订单状态`、`支付状态` |
| `deliveryStatus` | `物流状态`、`配送状态` |
| `rawAddressText` | `收货地址`、`地址`、`原始地址文本` |
| `youzanYzUid` | `有赞客户ID`、`有赞买家ID`、`买家ID` |
| `buyerUnionId` | `unionid`、`unionId`、`微信unionid` |

状态映射：

| 样本文案 | 内部状态 |
| --- | --- |
| `已支付`、`已付款`、`待发货` | `PAID` |
| `已关闭` | `CLOSED` |
| `已退款` | `REFUNDED` |
| `未发货`、`待发货` | `NOT_SHIPPED` |
| `已发货`、`运输中`、`配送中` | `SHIPPED` |
| `已签收`、`签收`、`已送达` | `DELIVERED` |
| `异常`、`物流异常` | `EXCEPTION` |

示例：

```json
[
  {
    "有赞订单号": "YZROOT202605160001",
    "收货人": "林小样",
    "收货手机号": "13800001111",
    "商品名称": "ROOT 7日试饮装",
    "实付金额": "199",
    "订单状态": "已支付",
    "物流状态": "已发货",
    "支付时间": "2026-05-16T10:00:00+08:00",
    "收货地址": "上海市样例地址"
  }
]
```

### 2.2 有赞客户：`YOUZAN_CUSTOMER`

最小必填：

| 内部字段 | 可识别字段名 | 说明 |
| --- | --- | --- |
| `youzanYzUid` | `有赞客户ID`、`客户ID`、`买家ID`、`yzUid` | 有赞客户唯一识别 |

建议提供：

| 内部字段 | 可识别字段名 |
| --- | --- |
| `unionid` | `unionid`、`unionId`、`微信unionid` |
| `phone` | `手机号`、`收货手机号`、`备注手机号` |
| `nickname` | `昵称`、`微信昵称`、`客户昵称` |
| `rootUserId` | `rootUserId`、`root_user_id`、`用户ID` |

如果样本没有 `unionid`、`phone` 或 `rootUserId`，导入后只会写入外部客户镜像，不会自动补链内部用户；运营可以后续通过订单、手机号或 UnionID 补齐。

示例：

```json
[
  {
    "有赞客户ID": "YZCUSTOMER202605160001",
    "unionid": "union_sample_root_001",
    "手机号": "13800001111",
    "昵称": "ROOT会员样本"
  }
]
```

### 2.3 物流状态：`FULFILLMENT`

最小必填：

| 内部字段 | 可识别字段名 | 说明 |
| --- | --- | --- |
| `youzanOrderNo` 或 `orderId` | `有赞订单号`、`订单号`、`订单编号`、`orderId` | 用于找到订单 |
| `deliveryStatus` | `物流状态`、`配送状态` | 物流状态 |

建议提供：

| 内部字段 | 可识别字段名 |
| --- | --- |
| `carrier` | `快递公司`、`物流公司`、`承运商` |
| `trackingNo` | `运单号`、`快递单号`、`物流单号` |
| `shippedAt` | `发货时间` |
| `deliveredAt` | `签收时间`、`送达时间` |
| `lastEventText` | `最新物流节点`、`物流节点`、`最新状态` |

示例：

```json
[
  {
    "有赞订单号": "YZROOT202605160001",
    "快递公司": "SF",
    "运单号": "SFROOT0516001",
    "物流状态": "已签收",
    "签收时间": "2026-05-18T11:20:00+08:00",
    "最新物流节点": "本人签收"
  }
]
```

### 2.4 企业微信线索：`WECHAT_LEAD`

最小必填：

| 内部字段 | 可识别字段名 | 说明 |
| --- | --- | --- |
| `externalContactId` 或 `remarkName` | `外部联系人ID`、`企业微信备注名`、`企微备注` | 用于识别线索 |

建议提供：

| 内部字段 | 可识别字段名 |
| --- | --- |
| `receiverPhone` | `收货手机号`、`备注手机号`、`手机号` |
| `sourceChannel` | `来源活动`、`来源渠道`、`活动来源` |
| `offlineEventName` | `线下活动`、`活动名称` |
| `corpWechatStatus` | `当前添加状态`、`添加状态`、`企微状态` |
| `operatorNote` | `运营备注`、`备注` |

如果样本没有 `receiverPhone` 或 `userId`，导入后会生成 `LEAD_NEEDS_MATCHING` 待办，提醒运营用手机号、备注名或订单做人工匹配。

示例：

```json
[
  {
    "外部联系人ID": "wm_external_sample_001",
    "企业微信备注名": "林小样-ROOT试饮",
    "来源活动": "线下沙龙",
    "当前添加状态": "ADDED",
    "运营备注": "已发送入组规则",
    "收货手机号": "13800001111"
  }
]
```

## 3. 使用方式

后台方式：

1. 打开 `http://127.0.0.1:8788/admin`。
2. 在「真实样本导入」选择样本来源。
3. 查看「取样模板」中的必填字段、建议字段和取样注意事项。
4. 粘贴 JSON 数组、CSV 文本，或从表格复制出来的多列表格文本；也可以点击「填入模板」后补齐真实数据。
5. 点击「预览校验」查看映射、错误和提醒。
6. 确认后点击「导入样本」。
7. 在「Adapter 准入」查看四类样本是否达到至少 3 条、必填字段覆盖和状态枚举要求。
8. 在「真实 Adapter 接入」查看手工 Adapter 和真实平台 Adapter 的配置状态。
9. 在「取样评审台账」查看字段覆盖率、缺失项、未知状态枚举和决策状态。
10. 如果出现未知状态枚举，在台账里选择目标状态并保存映射，再重新预览。

命令方式：

```bash
curl -s http://127.0.0.1:8788/api/v1/admin/external-samples/preview \
  -H 'Content-Type: application/json' \
  -d '{"sourceType":"YOUZAN_ORDER","samples":[{"有赞订单号":"YZROOT202605160001","收货手机号":"13800001111"}]}'
```

获取取样模板：

```bash
curl -s 'http://127.0.0.1:8788/api/v1/admin/external-samples/template?sourceType=YOUZAN_ORDER'
```

CSV/表格文本预览：

```bash
curl -s http://127.0.0.1:8788/api/v1/admin/external-samples/preview \
  -H 'Content-Type: application/json' \
  -d '{"sourceType":"YOUZAN_ORDER","text":"有赞订单号,收货手机号,订单状态,物流状态\nYZROOT202605160001,13800001111,已支付,已发货"}'
```

导入：

```bash
curl -s http://127.0.0.1:8788/api/v1/admin/external-samples/import \
  -H 'Content-Type: application/json' \
  -d '{"sourceType":"YOUZAN_ORDER","samples":[{"有赞订单号":"YZROOT202605160001","收货手机号":"13800001111"}]}'
```

通过 Adapter Interface 运行手工取样：

```bash
curl -s http://127.0.0.1:8788/api/v1/admin/external-adapters/run \
  -H 'Content-Type: application/json' \
  -d '{"sourceType":"YOUZAN_ORDER","adapterKind":"MANUAL_SAMPLE","mode":"PREVIEW","text":"有赞订单号,收货手机号,订单状态,物流状态\nYZROOT202605160001,13800001111,已支付,已发货"}'
```

## 4. 验收口径

1. 样本缺少必填字段时，只能预览错误，不应写入数据。
2. 有赞订单导入后，应能在后台订单、用户详情或订单匹配流程中被识别。
3. 有赞客户导入后，应能写入客户镜像；提供 `unionid`、手机号或 `rootUserId` 时应能补链内部用户。
4. 物流导入为 `DELIVERED` 后，若订单已绑定用户，应生成已送达待开始待办。
5. 企业微信线索无法匹配用户时，应生成 `LEAD_NEEDS_MATCHING` 待办。
6. JSON、CSV 和表格文本应得到一致的字段映射结果。
7. 每次预览或导入都应生成一条取样评审记录。
8. 取样评审记录应包含字段覆盖率、缺失项、未知状态枚举和决策状态。
9. 所有样本导入在 `ROOT_STORE_FILE` 模式下应被 JSON 文件保存，在 `ROOT_SQLITE_FILE` 模式下应被 SQLite 文件保存；云托管正式环境应通过 `ROOT_STORE_ADAPTER=mysql` 写入 MySQL。
10. 通过 `MANUAL_SAMPLE` Adapter 运行预览或导入时，应生成 Adapter 运行记录和取样评审记录。
11. 真实平台 Adapter 缺少配置、缺少 Implementation 或运行失败时，应生成 `FAILED` 运行记录并展示失败原因、重试状态和建议重试时间。

## 5. 决策状态

| 状态 | 含义 | 下一步 |
| --- | --- | --- |
| `READY` | 必填字段齐全，未发现未知状态枚举 | 可继续扩大样本量 |
| `NEEDS_REVIEW` | 可导入，但存在提醒项，例如地址缺失或签收时间缺失 | 由运营/产品确认是否接受 |
| `NEEDS_MAPPING` | 出现未知状态枚举 | 先补状态映射，再进入正式平台 Adapter |
| `BLOCKED` | 必填字段缺失或无法定位订单 | 回到导出侧补字段 |

## 6. Adapter 准入

后台「Adapter 准入」会读取每类来源的最新取样评审，并按以下规则判断是否可以进入真实平台 Adapter 开发：

1. 每类来源最新评审至少 3 条样本。
2. 必填字段覆盖率必须为 100%。
3. 不能存在未知订单或物流状态枚举。
4. `READY` 可继续开发；`NEEDS_REVIEW` 需要运营/产品确认提醒项；`BLOCKED` 需要回到样本导出或状态映射处理。

## 7. 真实平台 Adapter Seam

当前 Adapter Seam 已经落地，但真实平台拉取 Implementation 仍按配置状态分阶段启用：

| Adapter | 来源 | 当前状态 | 必要配置 |
| --- | --- | --- | --- |
| `MANUAL_SAMPLE` | 有赞订单、物流、企业微信线索 | `READY` | 无 |
| `YOUZAN_OPEN` | 有赞订单 | `NEEDS_CONFIG`、`CONFIG_READY` 或 `READY` | `YOUZAN_ACCESS_TOKEN`、`YOUZAN_ORDER_LIST_URL`；生产 Gate 另校验 client id、grant id、到期时间和轮换负责人 |
| `FULFILLMENT_PUSH` | 物流状态 | `NEEDS_CONFIG`、`CONFIG_READY` 或 `READY` | `ROOT_FULFILLMENT_SECRET`、`ROOT_FULFILLMENT_LIST_URL` |
| `WEWORK_CONTACT` | 企业微信线索 | `NEEDS_CONFIG`、`CONFIG_READY` 或 `READY` | `WEWORK_CORP_ID`、`WEWORK_CONTACT_SECRET`、`WEWORK_CONTACT_LIST_URL` |

状态含义：

真实样本只在本次预览响应中保留原值；评审台账落库前会自动脱敏个人值。有赞 `client_secret` 只保存在密码管理器或受控轮换终端，不进入运行容器和样本台账。

1. `READY`：当前 Adapter 可直接执行，手工取样走这个状态。
2. `NEEDS_CONFIG`：缺少必要环境变量，不能运行真实平台拉取。
3. `CONFIG_READY`：凭证齐全，但真实平台拉取 Implementation 尚未启用。

后续接入有赞、物流和企业微信时，应只替换对应 Adapter 的 Implementation，保持样本解析、评审、准入和上线闸口 Interface 不变。

有赞订单已支持可配置 HTTP Implementation。常用配置：

| 环境变量 | 说明 |
| --- | --- |
| `YOUZAN_ORDER_LIST_URL` | 订单列表请求完整地址 |
| `YOUZAN_ACCESS_TOKEN` | 当前可用访问 token |
| `YOUZAN_ORDER_LIST_METHOD` | `POST` 或 `GET`，默认 `POST` |
| `YOUZAN_ORDER_LIST_LIMIT_PARAM` | 每页数量参数名，默认 `page_size` |
| `YOUZAN_ORDER_LIST_CURSOR_PARAM` | 游标参数名，默认 `cursor` |
| `YOUZAN_ACCESS_TOKEN_LOCATION` | `query` 或 `header`，默认 `query` |
| `YOUZAN_ORDER_LIST_EXTRA_PARAMS` | 额外请求参数 JSON |
| `YOUZAN_ORDER_LIST_DATA_PATH` | 订单数组在响应里的路径，例如 `data.items` |
| `YOUZAN_ORDER_LIST_CURSOR_PATH` | 下一页游标路径，例如 `data.nextCursor` |
| `YOUZAN_ORDER_LIST_HAS_MORE_PATH` | 是否还有下一页路径，例如 `data.hasMore` |
| `YOUZAN_ORDER_FIELD_MAP` | 字段路径映射 JSON，例如 `{"youzanOrderNo":"tid","receiverPhone":"receiver_tel"}` |

物流状态已支持可配置 HTTP Implementation。常用配置：

| 环境变量 | 说明 |
| --- | --- |
| `ROOT_FULFILLMENT_LIST_URL` | 物流事件列表请求完整地址 |
| `ROOT_FULFILLMENT_SECRET` | 物流来源密钥 |
| `ROOT_FULFILLMENT_LIST_METHOD` | `POST` 或 `GET`，默认 `POST` |
| `ROOT_FULFILLMENT_SECRET_LOCATION` | `header`、`query` 或 `body`，默认 `header` |
| `ROOT_FULFILLMENT_SECRET_HEADER` | header 名，默认 `X-Root-Fulfillment-Secret` |
| `ROOT_FULFILLMENT_SECRET_PARAM` | query/body 参数名，默认 `secret` |
| `ROOT_FULFILLMENT_LIST_LIMIT_PARAM` | 每页数量参数名，默认 `page_size` |
| `ROOT_FULFILLMENT_LIST_CURSOR_PARAM` | 游标参数名，默认 `cursor` |
| `ROOT_FULFILLMENT_LIST_EXTRA_PARAMS` | 额外请求参数 JSON |
| `ROOT_FULFILLMENT_LIST_DATA_PATH` | 物流事件数组在响应里的路径，例如 `data.events` |
| `ROOT_FULFILLMENT_LIST_CURSOR_PATH` | 下一页游标路径，例如 `data.nextCursor` |
| `ROOT_FULFILLMENT_LIST_HAS_MORE_PATH` | 是否还有下一页路径，例如 `data.hasMore` |
| `ROOT_FULFILLMENT_FIELD_MAP` | 字段路径映射 JSON，例如 `{"youzanOrderNo":"order_no","deliveryStatus":"logistics_status"}` |

企业微信线索已支持可配置 HTTP Implementation。常用配置：

| 环境变量 | 说明 |
| --- | --- |
| `WEWORK_CONTACT_LIST_URL` | 外部联系人或线索列表请求完整地址 |
| `WEWORK_ACCESS_TOKEN` / `WEWORK_CONTACT_ACCESS_TOKEN` | 当前可用访问 token |
| `WEWORK_CONTACT_SECRET` | 企业微信客户联系 secret，作为备用密钥 |
| `WEWORK_CONTACT_LIST_METHOD` | `POST` 或 `GET`，默认 `POST` |
| `WEWORK_ACCESS_TOKEN_LOCATION` | `query` 或 `header`，默认 `query` |
| `WEWORK_CONTACT_SECRET_LOCATION` | `header`、`query`、`body` 或 `none`，有 token 时默认 `none` |
| `WEWORK_CONTACT_LIST_LIMIT_PARAM` | 每页数量参数名，默认 `page_size` |
| `WEWORK_CONTACT_LIST_CURSOR_PARAM` | 游标参数名，默认 `cursor` |
| `WEWORK_CONTACT_LIST_EXTRA_PARAMS` | 额外请求参数 JSON |
| `WEWORK_CONTACT_LIST_DATA_PATH` | 线索数组在响应里的路径，例如 `data.contacts` |
| `WEWORK_CONTACT_LIST_CURSOR_PATH` | 下一页游标路径，例如 `data.nextCursor` |
| `WEWORK_CONTACT_LIST_HAS_MORE_PATH` | 是否还有下一页路径，例如 `data.hasMore` |
| `WEWORK_CONTACT_FIELD_MAP` | 字段路径映射 JSON，例如 `{"externalContactId":"external_userid","remarkName":"remark","receiverPhone":"mobile"}` |

运行记录会保留：

1. 运行状态：`COMPLETED`、`COMPLETED_WITH_ERRORS`、`FAILED`。
2. 样本总数、可导入数、已导入数、错误数、提醒数。
3. 外部返回数量、请求数量、游标前后值和是否还有下一页。
4. 失败错误码、失败文案、重试状态、尝试次数、来源失败运行、失败分类说明和建议重试时间。

真实 Adapter 在 `IMPORT` 成功后会推进对应 `externalAdapterCursors`；`PREVIEW` 默认不推进游标，除非显式传入 `commitCursor`。

## 8. 未知枚举映射

当前支持两类状态映射：

| 字段 | 可映射目标 |
| --- | --- |
| `deliveryStatus` | `NOT_SHIPPED`、`SHIPPED`、`DELIVERED`、`EXCEPTION` |
| `orderStatus` | `PAID`、`CLOSED`、`REFUNDED` |

示例：

```bash
curl -s http://127.0.0.1:8788/api/v1/admin/external-status-mappings \
  -H 'Content-Type: application/json' \
  -d '{"sourceType":"YOUZAN_ORDER","field":"deliveryStatus","rawValue":"派送失败","canonicalValue":"EXCEPTION"}'
```

映射保存后，同一来源、同一字段、同一原始值会优先按该映射归一。建议每次新增映射后立刻重新预览同一批样本，确认决策状态从 `NEEDS_MAPPING` 变为 `READY` 或 `NEEDS_REVIEW`。

## 9. 仍需人工确认

1. 有赞导出的正式字段名是否与样本一致。
2. 有赞订单状态里哪些状态应视为可参与试饮。
3. 物流签收是否一定等同于可启动 Day1。
4. 企业微信备注名是否会稳定携带手机号或活动标签。
5. 原始地址文本是否入库；当前只用于样本验证，正式上线前要确认保留期限和后台可见范围。
