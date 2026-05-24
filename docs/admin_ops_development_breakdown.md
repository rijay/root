# ROOT 后台运营工作台开发拆单

版本：V0.1
日期：2026-05-24
依据：[admin_ops_ui_ux_design.md](./admin_ops_ui_ux_design.md)、[admin_ops_ui_ux_design_review.md](./admin_ops_ui_ux_design_review.md)
状态：开发拆单
范围：`backend/public/admin.html`、`backend/public/admin.css`、`backend/public/admin.js`、后台运营相关后端 Module 与 HTTP Interface

## 1. 目标

把现有 `/admin` 从开发验收面板改造为 ROOT 小程序运营工作台。

本轮交付目标：

- 默认进入「今日运营」。
- 顶部提供 6 个 tab：今日运营、用户管理、订单匹配、打卡与反馈、免单与售后、开发与发布。
- 开发与发布内容从默认首页迁移到独立 tab。
- 新增面向运营的有赞订单手动匹配流程。
- 保持现有后台能力可用，不破坏上线闸口、Adapter 校准、真实样本导入和发布记录。

## 2. 开发原则

- 保持当前后台无前端构建流程，继续使用静态 `admin.html`、`admin.css`、`admin.js`。
- 先做信息架构和可执行路径，再补视觉细节。
- 新增后端能力优先做深 Module，让页面只消费整理好的展示数据。
- 订单匹配能力不散落在页面逻辑里，应有独立 Module 承接预览、风险判断和确认写入。
- 不引入复杂权限、多运营账号和大型 BI 能力。

## 3. 现有能力盘点

### 可直接复用

- `GET /api/v1/admin/dashboard`
- `POST /api/v1/jobs/daily-audit`
- `GET /api/v1/admin/users/:userId/detail`
- `POST /api/v1/admin/users/:userId/follow`
- `POST /api/v1/admin/orders/sync`
- `POST /api/v1/admin/orders/fulfillment`
- `GET /api/v1/admin/tasks`
- `POST /api/v1/admin/tasks/:taskId/complete`
- `POST /api/v1/admin/tasks/:taskId/resolve`
- `POST /api/v1/admin/refunds/:refundId/approve`
- `POST /api/v1/admin/coupons/:couponId/use`
- `GET /api/v1/admin/launch-readiness`
- `GET /api/v1/admin/adapter-calibration`
- `GET /api/v1/admin/release-record`
- `GET /api/v1/admin/external-adapters`
- `POST /api/v1/admin/external-samples/preview`
- `POST /api/v1/admin/external-samples/import`

### 需要新增或扩展

- 今日运营展示数据整理。
- 待匹配订单统计与列表。
- 异常反馈统计。
- 订单匹配搜索。
- 订单匹配预览。
- 订单匹配确认写入。
- 批量粘贴订单的运营入口。
- 前端 tab 状态与路由锚点。

## 4. 目标 Module 与 Interface

### 4.1 Admin Ops Presenter Module

位置建议：`backend/src/adminOpsPresenter.js`

Interface：

- `buildOpsDashboard(data, dateText)`
- `buildTaskPriority(task)`
- `buildOpsMetrics(data, summary)`
- `buildRiskFeedbackSummary(data)`

职责：

- 把今日运营需要的指标、待办优先级、待匹配订单和异常反馈整理成页面可直接渲染的数据。
- 保持运营展示文案与内部状态解耦。
- 让 `adminDashboard` 不继续膨胀成混杂实现。

### 4.2 Admin Order Matching Module

位置建议：`backend/src/adminOrderMatching.js`

Interface：

- `searchOrderMatchingCandidates(data, query)`
- `previewOrderMatch(data, body)`
- `confirmOrderMatch(data, body, dateText)`
- `bulkPasteOrders(data, body, dateText)`

职责：

- 搜索候选订单与候选用户。
- 判断手机号不一致、订单已绑定、用户已有活跃订单等风险。
- 输出匹配预览。
- 执行确认匹配或确认改绑。
- 复用现有 Order Fulfillment Module 写入订单和物流状态。

### 4.3 Admin View State Module

位置建议：`backend/public/admin.js` 内部对象，暂不拆文件。

Interface：

- `setActiveTab(tabId)`
- `renderActiveTab(data)`
- `refreshData()`
- `openUserDetail(userId)`
- `openOrderMatch(input)`

职责：

- 控制 6 个 tab 的显示、刷新、锚点和局部渲染。
- 避免每个按钮自行拼 DOM 和请求。

## 5. Batch 0：基线与结构准备

目标：先稳住现有后台，建立可迭代的页面结构。

任务：

- `DEV-ADMIN-0001` 记录当前后台截图和现有面板清单。
- `DEV-ADMIN-0002` 在 `admin.html` 建立 6 个 tab 的容器骨架。
- `DEV-ADMIN-0003` 在 `admin.js` 增加 tab 状态与渲染入口。
- `DEV-ADMIN-0004` 在 `admin.css` 增加 ROOT 后台设计变量、顶部栏、tab、工作区布局。
- `DEV-ADMIN-0005` 将现有渲染函数先迁移到对应 tab 容器，不改变数据逻辑。

验收：

- `/admin` 能正常打开。
- 6 个 tab 可以切换。
- 原有所有面板仍能渲染。
- 默认 tab 为「今日运营」。

验证：

- `npm test --prefix backend`
- `npm run verify`
- 本地打开 `http://127.0.0.1:8787/admin` 手动切换 6 个 tab。

## 6. Batch 1：今日运营工作台

目标：完成默认首页，运营者能一眼看到今天要处理什么。

任务：

- `DEV-ADMIN-1001` 新增 Admin Ops Presenter Module。
- `DEV-ADMIN-1002` 扩展 `adminDashboard` 返回 `opsDashboard`。
- `DEV-ADMIN-1003` 增加今日指标：今日应打卡、今日已打卡、今日未打卡、待处理任务、待匹配订单、待审核免单、已送达待开始、异常反馈。
- `DEV-ADMIN-1004` 增加待办优先级映射与运营文案。
- `DEV-ADMIN-1005` 今日运营 tab 渲染指标条、高优先级待办、订单匹配提醒、免单待审、异常反馈、已送达待开始。
- `DEV-ADMIN-1006` 待办动作文案调整为 `复制跟进话术`、`标记已联系`、`生成跟进待办`、`标记完成`、`跳过`。
- `DEV-ADMIN-1007` 点击指标后跳转到对应 tab 或筛选列表。

验收：

- 首屏不出现上线闸口、Adapter 校准、发布记录和真实样本导入。
- 今日运营指标与设计稿的数据定义一致。
- 高优先级待办按物流异常、订单冲突、异常反馈、免单待审、已送达未开始、今日未打卡、优惠券未使用排序。
- `联系用户` 文案不再出现。

后端测试：

- Admin Ops Presenter Module 的指标统计。
- 待匹配订单统计。
- 待审核免单统计。
- 已送达待开始统计。
- 待办优先级排序。

前端验证：

- 今日运营 tab 空状态。
- 有待办状态。
- 指标点击跳转。

## 7. Batch 2：订单匹配核心流程

目标：完成手动匹配有赞订单的主流程。

任务：

- `DEV-ADMIN-2001` 新增 Admin Order Matching Module。
- `DEV-ADMIN-2002` 新增订单匹配搜索 HTTP Interface。
- `DEV-ADMIN-2003` 新增订单匹配预览 HTTP Interface。
- `DEV-ADMIN-2004` 新增订单匹配确认 HTTP Interface。
- `DEV-ADMIN-2005` 前端实现订单匹配三列工作台。
- `DEV-ADMIN-2006` 前端实现“录入/更新订单”模式。
- `DEV-ADMIN-2007` 前端实现“匹配给用户”模式。
- `DEV-ADMIN-2008` 前端实现风险提示和二次确认。
- `DEV-ADMIN-2009` 前端实现匹配成功反馈。

建议 HTTP Interface：

- `GET /api/v1/admin/order-matching/search?q=&type=`
- `POST /api/v1/admin/order-matching/preview`
- `POST /api/v1/admin/order-matching/confirm`

预览返回建议：

- `order`
- `user`
- `risks`
- `recommendedAction`
- `writeEffects`
- `canConfirm`
- `requiresSecondConfirm`

风险类型建议：

- `ORDER_BOUND_TO_OTHER_USER`
- `PHONE_MISMATCH`
- `USER_HAS_ACTIVE_ORDER`
- `ORDER_NOT_DELIVERED`
- `FULFILLMENT_EXCEPTION`

验收：

- 可通过订单号搜索订单。
- 可通过手机号搜索用户和订单。
- 可只录入订单，不绑定用户。
- 可选择已有订单和用户生成匹配预览。
- 手机号不一致时必须出现风险提示。
- 订单已绑定其他用户时默认不可直接覆盖。
- 确认改绑必须填写备注。
- 已送达订单匹配后进入已送达待开始。
- 物流异常订单匹配后生成售后待办。

后端测试：

- 搜索候选订单。
- 搜索候选用户。
- 匹配预览无风险。
- 手机号不一致风险。
- 订单已绑定其他用户风险。
- 用户已有活跃订单风险。
- 确认匹配写入 `user_id`、`matched_at`、`match_source`。
- 确认改绑需要备注。
- 已送达匹配生成待办。
- 物流异常匹配生成待办。

前端验证：

- 三列工作台布局。
- 预览区风险态。
- 成功态按钮：查看用户详情、继续匹配下一单、返回今日运营。

## 8. Batch 3：批量粘贴订单

目标：把运营临时订单录入和开发样本导入分开。

任务：

- `DEV-ADMIN-3001` 在订单匹配 tab 增加 `批量粘贴订单`入口。
- `DEV-ADMIN-3002` 复用 External Adapter Sample Module 的订单解析能力，但不展示 Adapter 准入内容。
- `DEV-ADMIN-3003` 批量粘贴只支持 `YOUZAN_ORDER`。
- `DEV-ADMIN-3004` 粘贴后展示可写入订单、错误行、提醒行。
- `DEV-ADMIN-3005` 确认写入后进入待匹配订单列表。

建议 Interface：

- 可复用 `POST /api/v1/admin/external-samples/preview` 和 `import`，但前端文案与结果渲染走运营语义。
- 如复用导致字段过重，再在 Admin Order Matching Module 里封装 `bulkPasteOrders`。

验收：

- 运营 tab 不出现 Adapter、准入、状态映射、取样评审。
- `真实样本导入` 只在开发与发布 tab 出现。
- 批量粘贴订单后，可继续匹配给用户。

## 9. Batch 4：用户管理与用户详情重组

目标：让运营者能快速判断用户卡点。

任务：

- `DEV-ADMIN-4001` 用户管理 tab 增加搜索与筛选。
- `DEV-ADMIN-4002` 用户列表展示用户、手机号、当前状态、最近打卡、累计记录、订单状态、待办数。
- `DEV-ADMIN-4003` 用户详情改为运营视角分组。
- `DEV-ADMIN-4004` 用户详情顶部固定展示当前状态、当前卡点、下一步建议动作。
- `DEV-ADMIN-4005` 身体反馈画像仅展示参与原因、肠道状态、改善方式。
- `DEV-ADMIN-4006` 用户详情里提供 `生成跟进待办`。
- `DEV-ADMIN-4007` 后台运营日期展示接入中文日期格式。

验收：

- 用户详情不再把日常便型作为画像核心字段。
- 运营者打开用户详情后能看到“这个用户现在卡在哪”。
- 日期不直接展示 `YYYY-MM-DD`，开发与发布 tab 原始日志除外。

测试：

- `getAdminUserDetail` 返回字段不破坏。
- 用户详情空数据渲染。
- 画像字段展示。
- 日期展示格式。

## 10. Batch 5：打卡与反馈、免单与售后

目标：把运营常用处理入口从当前混合列表中拆清楚。

任务：

- `DEV-ADMIN-5001` 打卡与反馈 tab 渲染今日打卡列表。
- `DEV-ADMIN-5002` 打卡与反馈 tab 渲染异常反馈列表。
- `DEV-ADMIN-5003` 打卡与反馈 tab 支持生成跟进待办、复制跟进话术、标记已联系、标记已处理。
- `DEV-ADMIN-5004` 免单与售后 tab 渲染免单审核列表。
- `DEV-ADMIN-5005` 免单审核增加资格依据展示。
- `DEV-ADMIN-5006` 审核通过增加确认弹层和备注。
- `DEV-ADMIN-5007` 售后异常列表承接物流异常、订单冲突、用户反馈不适、收货信息不一致、免单争议。

验收：

- 免单审核前能看到完成天数、Day8、订单匹配、物流送达、断卡、重复退款等依据。
- 高风险动作需要确认。
- 跟进动作不暗示系统自动联系用户。

测试：

- 免单列表渲染。
- 审核通过流程。
- 跟进待办创建。
- 标记任务完成。

## 11. Batch 6：开发与发布 tab 迁移

目标：保留现有开发能力，但不占默认首页。

任务：

- `DEV-ADMIN-6001` 将上线闸口迁移到开发与发布 tab。
- `DEV-ADMIN-6002` 将发布记录迁移到开发与发布 tab。
- `DEV-ADMIN-6003` 将 Adapter 校准迁移到开发与发布 tab。
- `DEV-ADMIN-6004` 将真实 Adapter 接入迁移到开发与发布 tab。
- `DEV-ADMIN-6005` 将真实样本导入、Adapter 准入、取样评审台账迁移到开发与发布 tab。
- `DEV-ADMIN-6006` 开发与发布 tab 保留 Adapter、Interface、Implementation、Seam 等开发词。
- `DEV-ADMIN-6007` 其他运营 tab 不展示开发校准词。

验收：

- 默认首页不出现开发内容。
- 原有开发与发布能力仍可使用。
- 真实样本导入仍支持预览、导入、状态映射和评审台账。

回归：

- 真实样本导入路径。
- Adapter 准入展示。
- 上线闸口展示。
- 发布记录展示。

## 12. Batch 7：视觉收口与回归

目标：达到可继续上线审核前联调的后台质量。

任务：

- `DEV-ADMIN-7001` 移除大 hero，改为轻量顶部工作台。
- `DEV-ADMIN-7002` 统一 ROOT 色彩、按钮、状态、表格、面板、空状态。
- `DEV-ADMIN-7003` 检查桌面宽屏布局，不要求移动端完整适配。
- `DEV-ADMIN-7004` 检查所有异步动作的 loading、success、error。
- `DEV-ADMIN-7005` 文案检查：运营 tab 不出现自动触达承诺。
- `DEV-ADMIN-7006` 运行后端测试、最终验证和浏览器手工回归。

验收：

- 后台视觉与 ROOT 品牌一致。
- 信息密度适合运营重复使用。
- 页面没有明显重叠、溢出、空白断层。
- 所有 P0/P1 路径可操作。

验证命令：

```bash
npm test --prefix backend
npm run verify
```

手工回归：

- 打开 `http://127.0.0.1:8787/admin`。
- 切换 6 个 tab。
- 执行今日 Summary。
- 查看用户详情。
- 完成一个待办。
- 录入一个手动订单。
- 预览一次订单匹配。
- 完成一次无风险匹配。
- 验证一个风险匹配会进入二次确认。
- 查看开发与发布 tab 的上线闸口和真实样本导入。

## 13. 推荐执行顺序

1. Batch 0：后台 tab 骨架。
2. Batch 1：今日运营。
3. Batch 2：订单匹配核心流程。
4. Batch 3：批量粘贴订单。
5. Batch 6：开发与发布迁移。
6. Batch 4：用户管理与详情。
7. Batch 5：打卡反馈、免单售后。
8. Batch 7：视觉收口与回归。

说明：

- Batch 6 可提前，是因为它主要迁移现有面板，风险低，但能快速清空默认首页。
- Batch 4 和 Batch 5 可并行设计，但开发时建议在订单匹配稳定后再做。

## 14. 开发前待确认

以下问题不阻塞开工，但进入 Batch 2 前建议确认：

1. 订单改绑是否允许运营直接操作，还是只允许“确认改绑并备注”。
2. 批量粘贴订单是否首版只支持 CSV/TSV，不支持 JSON。
3. `标记已联系` 是否直接完成待办，还是只记录一次联系事件。
4. 免单拒绝是否本轮需要做，还是仅保留审核通过。
5. 后台是否需要在云托管生产环境增加最小访问保护。

## 15. 最小可交付版本

若要压缩首版范围，最小可交付版本建议只做：

- Batch 0
- Batch 1
- Batch 2
- Batch 6
- Batch 7 的基础回归

这样可以先交付一个真正可用的 ROOT 运营后台：

- 默认运营首页。
- 开发内容隔离。
- 手动匹配有赞订单。
- 现有后台能力不丢失。
