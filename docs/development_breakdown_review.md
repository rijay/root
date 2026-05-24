# ROOT 7 日试饮打卡开发拆单评审

版本：V0.2
日期：2026-05-16
评审对象：[development_breakdown.md](./development_breakdown.md)
结论：初始评审为有条件通过；P0-P2 修订已在开发拆单 V0.4 中处理，当前可作为开发基线，未进入代码开发。

后续修订：P0 已在 [development_breakdown.md](./development_breakdown.md) V0.2 中处理：

1. P0-1 对应新增 `DEV-1004A 前置最小 Operation Task Module`。
2. P0-2 对应新增 `DEV-2005A 退役旧免单申请路径`。
3. P0-3 对应新增 `DEV-0004 隐私授权与数据最小化确认`。

后续修订：P1 已在 [development_breakdown.md](./development_breakdown.md) V0.3 中处理：

1. P1-1 对应新增 `DEV-1003A Flow View Presenter Module`。
2. P1-2 对应新增 `DEV-0005 数据仓库 Implementation 决策`。
3. P1-3 对应新增 `DEV-1003B 人工异常路径闭环`。
4. P1-4 对应扩展 `DEV-2001 Questionnaire Module` 的题型、校验、版本兼容和幂等规则。
5. P1-5 对应收窄 `DEV-3003 后台最小运营视图`，并将 `DEV-3004` 标记为 Batch 3.5。

后续修订：P2 已在 [development_breakdown.md](./development_breakdown.md) V0.4 中处理：

1. P2-1 对应新增 `DEV-0006 小程序页面 Canonical 路径确认与旧页面处置`。
2. P2-2 对应新增 `9.1 手工验收矩阵`。
3. P2-3 对应新增 `8.7 Batch 回滚点`。

## 1. 评审标准

本次评审只看开发拆单是否足够进入执行，不重新写 PRD。

验收标准：

1. 拆单能覆盖 PRD 的关键流程。
2. Batch 1 能独立交付可验证价值。
3. 任务依赖顺序正确，不要求后置 Module 支撑前置任务。
4. 新增 Module 的 Interface 清晰，页面和后台不会直接依赖内部 Implementation。
5. 关键合规、数据、退款和运营风险有明确任务承接。

## 2. 总体判断

拆单的方向是对的：它抓住了最大风险，即当前订单匹配成功后直接启动打卡；也把身份识别、订单物流、问卷、待办、退款和优惠券拆成独立 Module，整体保持了 Interface 的 Depth 和维护 Locality。

但当前版本还不适合直接开工。主要问题不是覆盖不足，而是有几处任务顺序和旧流程替换没有收紧，可能导致开发做出“看起来新流程上线了，实际旧入口仍然能绕过规则”的假阳性。

## 3. P0 必须修

### P0-1 Operation Task Module 被后置，但 Batch 1 已经依赖它

位置：

1. DEV-1001 先新增 `operationTasks` 数据对象。
2. DEV-1004 要求物流 `DELIVERED` 后生成 `READY_TO_START` 待办。
3. DEV-3001 才真正新建 Operation Task Module。

问题：

Batch 1 要生成待办，但创建、去重、完成、跳过这些 Interface 要到 Batch 3 才出现。这样 Batch 1 要么临时写一套浅的待办 Implementation，要么在 DEV-1004 里绕过 Module 直接操作数据。两种都会降低 Locality，后面再做 DEV-3001 时容易返工。

建议修正：

1. 在 Batch 1 增加 `DEV-1004A 最小 Operation Task Interface`。
2. 最小 Interface 只包含：
   - `createOperationTaskOnce(data, task)`
   - `listOpenOperationTasks(data, query)`
   - `completeOperationTask(data, taskId, body)`
3. DEV-3001 再扩展完整待办类型、筛选和 Summary。

进入开发前验收：

1. `READY_TO_START` 待办由 Operation Task Module 生成。
2. 同一用户同一订单同一天不会重复生成。

### P0-2 旧免单申请入口没有明确退役，会绕过 Day8 规则

位置：

1. DEV-2005 新建 Refund Work Item Module。
2. 现有用户端仍有“申请免单”路径。
3. 现有后端仍有 `applyRefund` 和后台 `approveRefund` 的老流程。

问题：

PRD 要求 Day8 收尾问卷完成后才进入人工退款队列。但拆单没有明确要求替换或关闭旧的用户主动申请入口。开发后可能出现：新流程要求 Day8，旧页面仍允许 Day7 完成后申请退款。

建议修正：

1. 在 Batch 2 增加 `DEV-2005A 退役旧免单申请路径`。
2. 小程序端：
   - `refund/apply` 改为解释“完成 Day8 后进入人工处理”，或跳转到 Day8。
   - 首页完成态不再展示“申请免单”，改为“完成收尾问卷”或“查看退款状态”。
3. 后端：
   - `applyRefund` 改为调用 Refund Work Item Module，且强制检查 Day8。
   - 保留旧路径时必须返回明确阻断原因。
4. 测试：
   - 完成 Day7 未提交 Day8 时，调用旧退款路径也不能创建退款工作项。

进入开发前验收：

1. 没有任何用户端路径能绕过 Day8。
2. 后台人工退款只处理 `refundWorkItems`。

### P0-3 隐私授权和数据最小化没有任务承接

位置：

1. DEV-1002 要绑定收货手机号。
2. DEV-1004 要处理物流和订单。
3. DEV-2002 到 DEV-3004 要收集痛点、自由描述、图片和反馈。

问题：

新流程会收集收货手机号、可能的收货人、地址、身体反馈、便型、图片和企业微信备注。这些不是普通点击数据。当前拆单没有隐私授权、数据最小化、展示脱敏、后台可见范围和保留期限任务。

建议修正：

1. Batch 0 增加 `DEV-0004 隐私授权与数据最小化确认`。
2. 用户端更新授权文案：
   - 说明收集收货手机号用于订单匹配和打卡权益识别。
   - 说明身体记录和图片仅用于试饮记录、运营跟进和退款资格判断。
   - 说明不提供诊断或治疗建议。
3. 后台默认脱敏：
   - 手机号展示为掩码。
   - 地址原则上不入库；若必须入库，单独确认。
   - 图片只展示给运营处理反馈时使用。
4. 数据保留：
   - 至少定义试饮结束后是否保留、多久清理、谁可导出。

进入开发前验收：

1. 新增个人信息字段都有收集目的。
2. 后台列表默认脱敏。
3. 用户端同意文案覆盖新增用途。

## 4. P1 建议修

### P1-1 `flowView` 需要变成明确 Module Interface，而不是散落在 `getUserState`

问题：

DEV-1003 提到 `GET /api/v1/user/state` 增加 `flowView`，DEV-1005 更新首页读取它。但当前小程序路由守卫和页面许可仍按 `user.state` 判断。如果 `flowView` 只是在某个返回值里临时拼出来，后续 Day8、退款、等待物流会在页面里散落规则。

建议修正：

1. 增加 `Flow View Presenter Module`。
2. Interface：
   - `getFlowView(data, userId, dateText)`
   - `getAllowedActions(flowView)`
   - `getHomeViewModel(data, userId, dateText)`
3. 首页、订单页和后台都读这个 Interface。
4. 测试覆盖每个 `flowView` 的允许动作。

### P1-2 数据持久化策略仍然悬空

问题：

拆单会新增大量数据，但当前后端是内存数据仓库。`schema.sql` 只是建表脚本，真实 Implementation 没有接入。若本轮目标是可上线，Batch 1 前就要明确持久化；若只是演示，应在拆单里明确“不上线、只跑演示”。

建议修正：

1. Batch 0 增加 `DEV-0005 数据仓库 Implementation 决策`。
2. 二选一：
   - 演示：继续内存实现，明确数据重启丢失。
   - 上线：新增仓储 Module，接入 SQLite/MySQL/PostgreSQL 之一。
3. 测试要穿过仓储 Interface，而不是依赖内存数组结构。

### P1-3 Batch 1 的人工异常路径没有闭环

问题：

DEV-1003 说“没有订单但用户坚持开始时，进入人工异常路径”，但没有拆出异常工作项、后台处理入口和用户端提示。这个路径一旦存在，就会变成真实运营场景。

建议修正：

1. 定义 `MANUAL_REVIEW_REQUIRED` flowView 或 operation task。
2. 用户端展示“已提交人工确认，请联系企业微信”。
3. 后台能标记：
   - 允许开始
   - 拒绝开始
   - 补充订单信息后开始

### P1-4 问卷页共用任务缺少表单校验和版本兼容细节

问题：

DEV-2003 和 DEV-2004 共用 `subpkg/checkin/pages/questionnaire/index.*`，但没有指定问题配置、必填、跳过、历史版本渲染和提交幂等。

建议修正：

1. DEV-2001 明确 `questionnaireDefinitions` 的题型：
   - single
   - multi
   - text
   - scale
   - boolean
2. `submitQuestionnaire` 支持幂等，重复提交返回已有记录或版本冲突。
3. 问卷提交失败不应影响当日打卡记录。

### P1-5 后台扩展太多，缺少最小运营视图优先级

问题：

Batch 3 同时做待办、Summary、用户详情、反馈聚合。对于当前轻量后台，这可能过大。

建议修正：

1. Batch 3 先做：
   - 今日 Summary
   - open 待办列表
   - 标记完成/跳过
2. 用户详情和反馈聚合放到 Batch 3.5 或 Batch 4 前。

## 5. P2 可优化

### P2-1 旧页面和新页面的 Canonical 路径需要标注

当前存在主包 `pages/checkin/*` 和分包 `subpkg/checkin/pages/*` 两套相似页面。拆单只改了分包路径，建议标注哪一套是 Canonical，另一套是否保留、重定向或删除。

### P2-2 验证方式可以更接近真实流程

目前测试闸门主要是后端测试和小程序静态检查。建议为最小上线范围增加一张手工验收矩阵：

1. 新用户 -> 画像 -> 订单匹配 `SHIPPED` -> 等待物流。
2. 运营更新 `DELIVERED` -> 用户开始 Day1。
3. Day4 打卡 -> 问卷跳过 -> Day5 继续。
4. Day7 完成 -> Day8 未填 -> 不能退款。
5. Day8 完成 -> 后台人工退款 -> 日常打卡。

### P2-3 开发拆单可以增加“回滚点”

每个 Batch 可增加回滚说明。例如 Batch 1 的回滚点是恢复 `matchOrder` 旧行为，但保留数据字段；Batch 2 的回滚点是关闭 Day4/Day8 入口，不删除已有问卷记录。

## 6. 评审结论

建议状态：P0-P2 已处理，开发拆单可作为开发基线。

进入代码开发前仍需确认：

1. 品牌与权益口径。
2. 打卡、补卡和 Day8 触发规则。
3. 外部字段最小集。
4. 演示版或上线版的数据仓库 Implementation。

建议第一轮开发只做：

1. DEV-0001 到 DEV-0006。
2. DEV-1001 到 DEV-1004A。
3. DEV-1005 到 DEV-1008。

暂不进入：

1. Day6 优惠券。
2. 转化实验。
3. 复杂用户详情。
4. 真实企业微信接入。
