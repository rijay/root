# ROOT 7 日打卡上线前验收清单

日期：2026-05-16
状态：演示/灰度验收通过；已具备 JSON 文件 Adapter、SQLite Adapter、真实样本导入校验、取样模板、取样评审台账、未知枚举映射、Adapter 准入、上线闸口、真实平台 Adapter Seam、运行记录、增量游标、三类可配置 HTTP Implementation 和 Adapter 上线校准包，正式上线仍需用真实账号执行校准流程。

## 1. 当前结论

当前代码已经覆盖白板流程中的核心闭环：

1. 线下获客和企业微信承接先按人工记录处理。
2. 有赞订单先按 seed、手工同步或后台录入处理。
3. 物流送达是 Day1 启动前置条件。
4. Day4 问卷不阻塞 Day5。
5. Day8 问卷是退款工作项前置条件。
6. daily audit 生成 Summary 和运营待办。
7. 后台可查看用户详情、反馈聚合、退款队列、优惠券转化。
8. Day6 优惠券不影响 Day7、Day8 和退款资格。

因此，当前版本适合：

1. 本地演示。
2. 小范围内部体验。
3. 运营流程试跑和话术校准。

当前版本不适合直接正式上线，除非先完成：

1. 数据仓库 Implementation 切换到 SQLite 或生产级数据库；若多实例或高并发，需要 PostgreSQL/MySQL Adapter。
2. 有赞订单 Adapter 真实字段、请求地址、token 位置、数据路径和字段映射确认。
3. 物流 Adapter 真实字段、请求地址、密钥位置、数据路径和字段映射确认。
4. 企业微信线索 Adapter 真实字段、请求地址、token/secret 位置、数据路径和字段映射确认。
5. 微信正式登录密钥、合法域名和 HTTPS 环境配置。

## 2. 自动验收

已新增 release smoke 测试：

```bash
npm test --prefix root_seven_day_checkin/backend
npm run check --prefix root_seven_day_checkin/miniprogram
```

覆盖：

1. `SHIPPED` 订单只能等待物流，不能误启动 Day1。
2. 物流改为 `DELIVERED` 后可启动 Day1。
3. Day4 待问卷不阻塞 Day5。
4. Day6 触发优惠券并可领取。
5. Day8 未提交时退款被阻断。
6. Day8 后生成退款工作项。
7. 已领取未使用优惠券进入 `COUPON_UNUSED` 待办。
8. 优惠券核销后自动关闭对应待办。
9. 退款通过后用户进入日常打卡。
10. 小程序 canonical 打卡路径指向 `subpkg/checkin/pages/*`。
11. JSON 文件 Adapter 能在 HTTP Interface 请求后保存变更，并在重启后恢复用户资料。
12. SQLite Adapter 能在 HTTP Interface 请求后事务保存变更，并在重启后恢复用户资料。
13. 有赞订单、物流状态和企业微信线索样本可先预览校验，再导入灰度数据仓库；样本支持 JSON、CSV 和表格文本。
14. 每次样本预览/导入会记录字段覆盖率、缺失项、未知状态枚举和决策状态。
15. 未知订单/物流状态可在后台保存映射，映射后重新预览样本。
16. 后台提供三类取样模板，避免运营导出字段缺失。
17. Adapter 准入会要求每类真实样本最新评审至少 3 条，且无未知枚举和必填字段缺口。
18. 上线闸口会把数据仓库 Adapter、微信登录密钥、正式域名和样本评审转成 `READY`、`NEEDS_REVIEW`、`BLOCKED`。
19. 真实平台 Adapter 状态台会展示手工 Adapter、待配置真实 Adapter 和最近运行记录。
20. 真实平台 Adapter 运行失败也会落账；成功导入后会保存增量游标，下一次可从上次位置继续。
21. 有赞订单可通过可配置 HTTP Implementation 拉取，响应仍会进入样本校验、评审台账和 Adapter 准入。
22. 物流状态可通过可配置 HTTP Implementation 拉取，响应仍会进入样本校验、履约更新、待办生成和 Adapter 准入。
23. 企业微信线索可通过可配置 HTTP Implementation 拉取，响应仍会进入样本校验、线索写入、人工匹配待办和 Adapter 准入。
24. Adapter 校准会把样本准入、配置、真实 Adapter 状态、最近成功运行和游标转成只读检查结果。
25. 发布记录会把上线闸口、Adapter 校准、最近运行、签字位和回滚动作汇总成可评审凭证。

## 3. 手工验收矩阵

| 场景 | 初始条件 | 操作 | 期望结果 |
| --- | --- | --- | --- |
| 新用户等待物流 | 用户完成登录和画像，订单为 `SHIPPED` | 输入收货手机号并匹配订单 | 首页显示等待物流，不创建打卡周期 |
| 送达后启动 | 用户已匹配订单，后台更新物流为 `DELIVERED` | 用户回首页点击开始 | 创建 Day1 周期，后台待办不重复 |
| 无订单异常 | 用户完成画像但无匹配订单 | 点击开始打卡 | 用户端显示人工确认，后台出现 `MANUAL_REVIEW_REQUIRED` |
| Day4 不阻塞 | 用户完成 Day4 打卡 | 不提交 Day4 问卷，继续 Day5 | Day5 可打卡，后台有 Day4 待办 |
| Day8 阻断退款 | 用户完成 Day7，未提交 Day8 | 进入退款申请 | 不生成退款工作项，提示完成 Day8 |
| Day8 后退款 | 用户提交 Day8 | 后台查看退款列表并通过 | 生成退款工作项，通过后进入日常打卡 |
| Day6 优惠券 | 用户完成 Day6 打卡 | 回首页领取复购礼 | 展示券码，不阻塞 Day7 |
| 券未使用待办 | 用户领取券但未核销 | 运营执行 daily audit | 后台出现 `COUPON_UNUSED` 待办 |
| 复购点击 | 用户点击去店铺使用 | 后台查看待办和转化区 | 记录复购点击并生成 `REPURCHASE_INTENT` |
| 用户详情追溯 | 后台打开用户详情 | 查看订单、物流、打卡、问卷、退款、优惠券 | 信息在单页可追溯 |

## 4. 真实 Adapter 对接清单

详细样本格式见 [external_adapter_samples.md](./external_adapter_samples.md)，真实账号校准步骤见 [adapter_calibration_playbook.md](./adapter_calibration_playbook.md)。真实平台 Adapter 开发前，先用后台「真实样本导入」的取样模板补齐至少 3 条有赞订单、3 条物流状态和 3 条企业微信线索样本；可直接粘贴 CSV 或从表格复制出来的文本。后台「Adapter 准入」会检查三类样本是否达到数量、必填字段和状态枚举要求；若出现 `NEEDS_MAPPING`，先保存状态映射并重新预览。「真实 Adapter 接入」会同时展示 `MANUAL_SAMPLE` 和未来真实平台 Adapter 的配置状态。

### 4.1 有赞订单 Adapter

最小字段：

1. 有赞订单号。
2. 商品 ID 和商品名称。
3. 实付金额。
4. 订单状态。
5. 收货人。
6. 收货手机号。
7. 原始地址文本。
8. 支付时间。

必须确认：

1. 退款金额是否等于实付金额。
2. 一个手机号多单时的匹配策略。
3. 同一订单被多个微信用户尝试绑定时的处理话术。
4. 订单列表请求 URL、token 传递位置、订单数组路径、下一页游标路径和真实字段映射。

### 4.2 物流 Adapter

最小字段：

1. 订单号。
2. 快递公司。
3. 运单号。
4. 物流状态：`NOT_SHIPPED`、`SHIPPED`、`DELIVERED`、`EXCEPTION`。
5. 发货时间。
6. 签收时间。
7. 最新物流节点文本。

必须确认：

1. 签收是否等同于可启动 Day1。
2. 异常件是否自动生成 `FULFILLMENT_EXCEPTION`。
3. 手工改状态是否需要审计记录。
4. 物流事件列表请求 URL、密钥传递位置、事件数组路径、下一页游标路径和真实字段映射。

### 4.3 企业微信线索 Adapter

最小字段：

1. 外部联系人 ID。
2. 企业微信备注名。
3. 来源活动。
4. 当前添加状态。
5. 运营备注。

必须确认：

1. 微信授权昵称、收货人、企业微信备注不一致时的人工确认规则。
2. 运营待办处理结果是否需要同步回企业微信。
3. 话术是否需要按用户标签分层。
4. 外部联系人请求 URL、token/secret 传递位置、线索数组路径、下一页游标路径和真实字段映射。

## 5. 发布前阻塞项

正式上线前必须关闭：

1. 数据仓库风险：内存 Adapter 重启会丢失记录；JSON 文件 Adapter 只适合内部灰度；SQLite Adapter 仅适合单实例小范围上线前验证，多实例和高并发仍需要 PostgreSQL/MySQL。
2. 演示手机号风险：生产环境必须配置真实微信登录密钥，并关闭 mock 登录。
3. 正式域名风险：小程序体验版和正式版不能访问 `127.0.0.1`。
4. 数据保留风险：用户明细保留期限、图片保留规则和后台可见范围需要最终确认。
5. 外部字段和平台请求风险：有赞、物流、企业微信字段或凭证未验证前，只能按 `MANUAL_SAMPLE` Adapter 灰度试跑；三类 HTTP Implementation 需要真实账号校准后再进入正式上线。

后台「上线闸口」和 `GET /api/v1/admin/launch-readiness?target=production` 会把其中可自动判断的项目标记为 `BLOCKED`；后台「Adapter 校准」和 `GET /api/v1/admin/adapter-calibration` 会把三类真实 Adapter 的校准状态拆开。后台「发布记录」和 `GET /api/v1/admin/release-record?target=production` 会把决策建议、阻塞项、灰度确认项、签字位和回滚动作汇总到一处。数据保留期限和后台可见范围仍需要人工确认后写入发布记录。

## 6. 推荐发布顺序

1. 内部演示：继续使用内存数据仓库和人工 Adapter。
2. 运营试跑：使用 JSON 文件 Adapter，导入真实订单样本，手工更新物流，验证企业微信话术。
3. 小范围灰度：切换到 SQLite Adapter，保留人工 Adapter。
4. 正式上线：用真实账号校准有赞、物流、企业微信三类 Adapter 配置，并保留后台人工修正入口；若要多实例部署，再迁移到 PostgreSQL/MySQL Adapter。
