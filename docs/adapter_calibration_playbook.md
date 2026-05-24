# ROOT 真实 Adapter 上线校准包

日期：2026-05-16
状态：有赞订单、物流状态、企业微信线索三类真实 Adapter 均已具备可配置 HTTP Implementation；上线前必须用真实账号完成校准。

## 1. 校准目标

上线校准不是重新开发 Adapter，而是确认三件事：

1. 平台请求配置能跑通。
2. 返回字段能稳定映射到内部样本字段。
3. 小批量 `IMPORT` 后不会破坏订单匹配、物流启动、线索待办和退款资格。

后台入口：

1. 「上线闸口」看整体阻塞。
2. 「Adapter 校准」看三类真实 Adapter 的配置、样本准入、最近运行和游标。
3. 「真实 Adapter 接入」看 Adapter 状态和运行台账。
4. 「取样评审台账」看字段覆盖率、未知枚举和提醒项。
5. 「发布记录」看发布建议、签字位和回滚动作。

HTTP Interface：

```bash
curl -s http://127.0.0.1:8788/api/v1/admin/adapter-calibration
curl -s http://127.0.0.1:8788/api/v1/admin/external-adapters
curl -s http://127.0.0.1:8788/api/v1/admin/launch-readiness?target=production
curl -s http://127.0.0.1:8788/api/v1/admin/release-record?target=production
```

命令行校准报告：

```bash
npm run samples --prefix root_seven_day_checkin/backend -- --base-url http://127.0.0.1:8788 --mode preview --youzan-file ./samples/youzan.csv
npm run samples --prefix root_seven_day_checkin/backend -- --base-url http://127.0.0.1:8788 --mode import --youzan-file ./samples/youzan.csv --fulfillment-file ./samples/fulfillment.csv --wework-file ./samples/wework.csv --require-all-ready
npm run adapters --prefix root_seven_day_checkin/backend -- --base-url http://127.0.0.1:8788 --source youzan --mode preview --limit 1
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
2. 带 `--require-all-ready` 时，会额外要求三类样本准入都不再 `BLOCKED`。
3. `--mode preview` 只记录评审，不写入订单、物流或线索。
4. `--mode import` 会写入灰度数据仓库，请先确认样本来自真实导出。

真实 Adapter 运行命令补充说明：

1. `--source` 支持 `youzan`、`fulfillment`、`wework`。
2. 默认执行真实 Adapter 的 `PREVIEW`，建议首轮都使用 `--mode preview --limit 1`。
3. `--mode import` 会写入灰度数据仓库，并在真实 Adapter 返回游标时推进游标。
4. 缺少凭证、字段映射错误或运行失败会返回非 0 退出码，并写入 Adapter 运行台账。

## 2. 配置表

### 2.1 有赞订单

必须配置：

| 环境变量 | 说明 |
| --- | --- |
| `YOUZAN_CLIENT_ID` | 有赞应用标识 |
| `YOUZAN_CLIENT_SECRET` | 有赞应用密钥 |
| `YOUZAN_ACCESS_TOKEN` | 当前可用访问 token |
| `YOUZAN_ORDER_LIST_URL` | 订单列表请求地址 |

建议配置：

| 环境变量 | 说明 |
| --- | --- |
| `YOUZAN_ORDER_LIST_DATA_PATH` | 订单数组路径 |
| `YOUZAN_ORDER_LIST_CURSOR_PATH` | 下一页游标路径 |
| `YOUZAN_ORDER_LIST_HAS_MORE_PATH` | 是否还有下一页路径 |
| `YOUZAN_ORDER_FIELD_MAP` | 字段映射 JSON |

最小字段确认：

1. `youzanOrderNo`
2. `receiverPhone`
3. `amount`
4. `orderStatus`
5. `deliveryStatus`
6. `rawAddressText`

### 2.2 物流状态

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

### 2.3 企业微信线索

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

## 3. 校准顺序

1. 先用 `MANUAL_SAMPLE` 补齐三类来源各 3 条真实样本。
2. 让后台「Adapter 准入」达到 `READY` 或可解释的 `NEEDS_REVIEW`。
3. 配置一个真实 Adapter 的环境变量，不要同时打开三类。
4. 对该 Adapter 执行 `PREVIEW`，确认字段映射、未知枚举和提醒项。
5. 若出现未知状态，先在「取样评审台账」保存映射，再重新 `PREVIEW`。
6. 执行 `IMPORT`，`limit=1`，确认导入结果、运行记录和游标。
7. 重复执行第二页，确认不会重复导入同一批记录。
8. 完成一个 Adapter 后再进入下一类。

推荐顺序：

1. 有赞订单。
2. 物流状态。
3. 企业微信线索。

## 4. 灰度试跑

灰度首日建议：

1. 数据仓库使用 SQLite Adapter。
2. 三类真实 Adapter 每次只跑 1 页。
3. 每次 `IMPORT` 后打开后台用户详情抽查 3 个用户。
4. 保留 `MANUAL_SAMPLE`、手工订单同步和手工物流更新入口。
5. 每天固定跑一次 `daily-audit`，检查运营待办是否异常堆积。

灰度成功标准：

1. 没有未知状态枚举。
2. 有赞订单导入后，手机号匹配结果符合预期。
3. 物流 `DELIVERED` 后，用户能进入 Day1 启动或已送达待开始列表。
4. 企业微信缺手机号线索进入 `LEAD_NEEDS_MATCHING`，不会静默丢失。
5. 三类 Adapter 都有成功运行记录，真实 Adapter 有游标或明确确认平台不提供游标。

## 5. 回滚判断

立即暂停真实 Adapter 的情况：

1. 字段映射把订单号、手机号或物流状态写错。
2. 未知枚举被导入为内部状态。
3. 同一批外部记录重复导入并影响运营待办。
4. 物流误把未签收订单变成 `DELIVERED`。
5. 企业微信线索大量缺少可人工识别的信息。

回滚方式：

1. 不再调用对应真实 Adapter 的 `IMPORT`。
2. 保留运行台账和游标，不手工删除。
3. 用 `MANUAL_SAMPLE` 或后台手工入口继续灰度。
4. 修正字段映射或状态映射后，先重新 `PREVIEW`。
5. 再用 `limit=1` 小批量恢复。
