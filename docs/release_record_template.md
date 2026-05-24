# ROOT 7 日打卡发布记录模板

日期：2026-05-16
状态：后台已提供发布记录 Module；正式评审时以 `GET /api/v1/admin/release-record?target=production` 的实时结果为准。

## 1. 记录来源

后台入口：

1. 「发布记录」：看本次发布建议、阻塞项、灰度确认项、签字位和最近运行。
2. 「上线闸口」：看数据仓库 Adapter、微信登录密钥、正式域名和样本评审。
3. 「Adapter 校准」：看三类真实 Adapter 的样本准入、配置、运行记录和游标。
4. 「真实样本导入」：保留 `MANUAL_SAMPLE` 作为回滚入口。

HTTP Interface：

```bash
curl -s "http://127.0.0.1:8788/api/v1/admin/release-record?target=production"
curl -s "http://127.0.0.1:8788/api/v1/admin/release-record?target=gray"
```

命令行报告：

```bash
npm run samples --prefix root_seven_day_checkin/backend -- --base-url http://127.0.0.1:8788 --mode import --youzan-file ./samples/youzan.csv --fulfillment-file ./samples/fulfillment.csv --wework-file ./samples/wework.csv --require-all-ready
npm run adapters --prefix root_seven_day_checkin/backend -- --base-url http://127.0.0.1:8788 --source youzan --mode preview --limit 1
npm run adapters --prefix root_seven_day_checkin/backend -- --base-url http://127.0.0.1:8788 --source fulfillment --mode preview --limit 1
npm run adapters --prefix root_seven_day_checkin/backend -- --base-url http://127.0.0.1:8788 --source wework --mode preview --limit 1
npm run calibrate --prefix root_seven_day_checkin/backend -- --base-url http://127.0.0.1:8788 --target production --strict
```

样本准入报告会先把真实导出文件转成取样评审；真实 Adapter 运行报告会记录小批量平台拉取结果和运行台账；发布校准报告会同时拉取发布记录、上线闸口、Adapter 校准和真实 Adapter 运行台账。若发布记录状态为 `BLOCKED`，退出码为 `2`，可直接用于上线前卡点。

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
3. `evidence.recentAdapterRuns` 中最近一次真实 Adapter `IMPORT` 没有失败。
4. `evidence.adapterCursors` 中真实 Adapter 已保存游标，或确认外部平台不提供游标。
5. `evidence.storeAdapter.kind` 不再是正式上线禁止的内存 Adapter。
6. `evidence.env` 中正式域名、微信登录和真实 Adapter 必要配置已存在。

## 4. 签字位

| 角色 | 负责人 | 状态 | 必答问题 |
| --- | --- | --- | --- |
| 产品 |  | `PENDING` | 流程、权益、断卡和退款提示是否确认 |
| 运营 |  | `PENDING` | 企业微信触达、免单处理和样本导入负责人是否在线 |
| 研发 |  | `PENDING` | 环境变量、数据仓库 Adapter、日志和回滚入口是否确认 |

## 5. 回滚动作

若发布后出现字段映射错误、未知枚举、重复导入、误送达或待办异常，立即执行：

1. 暂停 `YOUZAN_OPEN`、`FULFILLMENT_PUSH`、`WEWORK_CONTACT` 真实 Adapter。
2. 使用 `MANUAL_SAMPLE` 或后台手工入口继续订单、物流和线索处理。
3. 保留当前运行台账和游标，不手工删除证据。
4. 必要时回退到发布前数据仓库快照。
5. 修正字段映射或状态映射后，先 `PREVIEW`，再 `IMPORT limit=1` 恢复。
