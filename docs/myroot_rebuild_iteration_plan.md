# myRoot 会员小程序重构分期与延期功能台账

版本：V0.1
日期：2026-06-19
状态：B7 第一百段后延期与后续迭代台账；本地既定开发动作已收口，外部生产证据不纳入当前本地开发完成判断
范围：myRoot 会员体验中心、Root 会员中心有赞小程序、CloudBase、Element Plus Admin
关联开发拆包：[myroot_rebuild_development_breakdown_v1.md](./myroot_rebuild_development_breakdown_v1.md)
关联路径迁移：[myroot_rebuild_route_and_migration.md](./myroot_rebuild_route_and_migration.md)

## 1. 决策摘要

本次重构采用“myRoot 负责互动与生命周期，有赞 Root 会员中心负责交易”的系统拆分。

核心决策：

1. `root_user_id` 作为内部用户主键。
2. `unionid` 作为两个微信小程序账号打通键，微信开放平台认证通过后补齐。
3. `youzan_yz_uid` 作为有赞客户与订单镜像键。
4. myRoot 展示有赞商品与 SKU 快照，购买跳转到有赞小程序完成。
5. 活动结算本质是运营任务机制，条件与奖励都必须配置化。
6. 本次首发优先保证路演现场 20 左右并发下的进入、展示、互动、跳转和可追溯记录。

## 2. 稳定 Module 规划

| Module | 首版职责 | 后续扩展方向 |
| --- | --- | --- |
| Identity Resolution Module | 登录、`root_user_id`、`openid`、预留 `unionid` | 账号自动合并、冲突复核、跨小程序补链 |
| Product Mirror Module | 商品/SKU 镜像展示、跳转记录 | 自动同步、库存状态、商品推荐策略 |
| Commerce Mirror Module | 有赞订单与客户镜像 | 售后、退款、配送、会员标签同步 |
| Campaign Module | 活动配置、参与记录 | 多活动并行、渠道分层、活动模板 |
| Task Progress Module | 打卡、问卷、分享、咨询等任务事实 | 更多任务类型、任务组合、实时进度聚合 |
| Settlement Module | 条件判断、结算记录 | 规则树、批量重跑、库存预占 |
| Reward Grant Module | 奖励承诺记录 | 有赞自动发券、积分与标签、分层风控 |
| Admin Ops Module | 后台配置、复核、重试 | 权限分层、审计、运营看板 |

外部 Seam 先稳定在：

1. `resolveByWechatLogin`
2. `listDisplayProducts`
3. `recordTaskEvent`
4. `evaluateSettlement`
5. `grantReward`
6. `syncYouzanProducts`
7. `syncOrdersByTimeRange`

## 3. MVP 分期

### P0 地基

目标：用户进入 myRoot 后有稳定身份与来源记录。

必须完成：

1. `root_user_id` 生成与查询。
2. `wechat_identity` 写入 `app_code + openid`。
3. `identity_link` 记录 `openid`、手机号证据、后续 `unionid`。
4. `user_account` 记录生命周期状态与来源。
5. 后台最小用户查询。

不要求完成：

1. `unionid` 自动合并。
2. 有赞订单绑定。
3. 自动发券。

### P1 路演可用

目标：现场用户能扫码进入、看活动、看商品、跳有赞购买、参与任务。

必须完成：

1. 活动首页。
2. 商品与 SKU 快照展示。
3. 跳转有赞 Root 会员中心小程序。
4. `product_jump_log` 记录跳转行为。
5. 打卡、问卷、分享、咨询等基础任务事件。
6. 用户进度展示。
7. 后台活动与商品展示关系配置。

允许简化：

1. 商品/SKU 可先手动导入或手动刷新。
2. 任务规则先支持累计次数、是否完成。
3. 订单可先展示“同步中”，不阻塞任务参与。

### P2 结算可用

目标：运营能配置条件和奖励，系统能生成结算与奖励记录。

必须完成：

1. `campaign_rule_version` 规则版本。
2. 条件配置：累计打卡、连续打卡、问卷完成、分享次数、指定商品购买。
3. 奖励配置：有赞券、免单机会、积分、标签、人工复核。
4. `settlement_record` 记录结算判断。
5. `reward_grant` 记录奖励承诺。
6. 后台结算预览与手动结算。

允许简化：

1. 有赞自动发券可先不做，先生成待发放记录。
2. 免单机会可先进入人工确认池。
3. 复杂 `AND / OR` 规则树可后置，首版先支持“全部满足”。

### P3 运营增强

目标：订单同步、奖励发放、异常复核和数据分析形成运营闭环。

必须完成：

1. 有赞客户、订单、售后状态同步。
2. 有赞自动发券与结果查询。
3. `reward_delivery_job` 失败重试。
4. `manual_review_item` 人工复核池。
5. 活动漏斗与商品转化数据。
6. 运营角色权限和审计记录。

## 4. 本次重构首发范围

建议首发范围为 P0 + P1 + P2 最小版。

| 能力 | 首发状态 | 说明 |
| --- | --- | --- |
| myRoot 登录注册 | 必须做 | 支持 `openid`，预留 `unionid` |
| 来源追踪 | 必须做 | 支持企微、路演、分享 |
| 商品展示 | 必须做 | 展示有赞商品镜像 |
| 跳转购买 | 必须做 | 跳转 Root 会员中心 |
| 打卡/问卷/分享/咨询 | 必须做 | 统一写入 `task_event` |
| 进度展示 | 必须做 | 读取任务进度快照 |
| 规则版本 | 必须做 | 发布后不可覆盖 |
| 结算记录 | 必须做 | 支持后台预览与手动执行 |
| 奖励记录 | 必须做 | 先记录承诺，发放可人工 |
| 有赞订单展示 | 可做最小版 | 订单同步不到时不阻塞 |
| 有赞自动发券 | 可后置 | 先保留 Adapter Seam |

## 5. 延期功能台账

| 编号 | 延期功能 | 延期原因 | 触发条件 | 责任 Module |
| --- | --- | --- | --- | --- |
| D-001 | `unionid` 自动合并与冲突处理 | 微信开放平台认证未完成 | 认证通过并可稳定获取 `unionid` | Identity Resolution Module |
| D-002 | 有赞云商品/SKU 全自动同步 | 自用应用未创建，字段未确认 | 有赞云应用创建并完成商品读取权限验证 | Product Mirror Module |
| D-003 | 有赞订单增量同步 | 订单字段、游标、状态枚举未确认 | 有赞订单读取权限和样本校验通过 | Commerce Mirror Module |
| D-004 | 有赞客户 `yzUid + unionid` 补链 | 有赞客户字段未确认 | 客户读取权限和字段样本确认 | Identity Resolution Module |
| D-005 | 有赞自动发券 | 权益发放 Interface 未确认 | 有赞券发放、查询、失败原因验证通过 | Reward Grant Module |
| D-011 | 奖励深度风控 | 已完成奖励上限、库存预占、复核拒绝释放、免单抽取、黑名单、售后追回和库存回补；暂不做多级追回审批与外部反向动作回执 | 奖励需要多级风控、外部券撤销回执或积分/标签反向动作 | Reward Grant Module |

已完成移出延期：

| 编号 | 已完成能力 | 完成记录 |
| --- | --- | --- |
| D-007 | 复杂规则树 `AND / OR` | B7.91 已在 Settlement Module 支持旧平铺数组隐式 AND 与显式 AND/OR 条件树，B7.92 已接入后台规则生成器，B7.100 已接入规则拖拽编辑器，Domain/API/Admin/最终验收已覆盖 |
| D-008 | 多角色权限 | B7 已接入后台角色能力、菜单隐藏、按钮级权限提示、后端能力校验和 Admin 自检 |
| D-009 | 数据看板与漏斗分析 | B7 已接入运营数据漏斗、趋势/预警/导出、来源分群留存和最终验收 smoke |
| D-006 | 免单机会自动抽取 | B7.95 已在 Reward Grant Module 接入确定性抽取和黑名单跳过，后台规则生成器可配置免单抽取比例，Domain/API/Admin 测试已覆盖 |
| D-010 | 自动企业微信触达 | B7.97 已接入 WeWork Touch Module、`wework_touch_job` 队列、Admin/Job HTTP Interface、命令行 runner、CloudBase Job Manifest、Production Env Matrix、Domain/API/最终验收 smoke；真实 URL/token/模板/回执字段仍属生产配置与 T-006 证据项 |
| D-012 | 订单售后与退款深度同步 | B7.98 已接入 Order After-Sales Module、`order_after_sales_record`、订单镜像售后摘要、Admin HTTP Interface、状态映射、退款工作项同步、按订单证据收敛的 Reward Recovery 联动和 Domain/API/最终验收 smoke；真实售后列表 URL、字段路径、游标、多包裹/拆单样本仍属生产校准 |
| D-013 | 问卷分支题 | B7.99 已接入 Questionnaire Module `visibleIf` 分支规则、可见题必填校验、小程序新旧问卷页动态题目渲染、Domain/API/小程序校验/最终验收 smoke；后台分支预览、题库发布和 A/B 仍属后续体验增强 |
| D-014 | 规则拖拽编辑器 | B7.100 已接入 Element Plus Admin `ruleTree` 条件树编辑器、HTML5 同层拖放、节点启停、分组 AND/OR、六类条件编译、Admin 自检、Admin build 和最终验收；跨层拖拽、规则 diff 和审批流属于后续体验增强 |
| D-011A | 奖励上限保护 | B7.93 已支持 `stockLimit/quotaKey`，超限跳过奖励生成但保留达标结算事实，Domain/API/Admin 测试已覆盖 |
| D-011B | 库存预占与复核拒绝释放 | B7.94 已接入 Reward Inventory Module，支持库存池、reservation、复核拒绝释放和 Domain/API 测试 |
| D-011C | 售后追回与库存回补 | B7.96 已接入 Reward Recovery Module，本地退款通过后追回/撤销奖励、释放库存 reservation，并覆盖释放后重新发放 |

## 6. 延期项记录规则

每个延期功能必须保留四类信息：

1. 为什么延期：权限、字段、运营规则、开发成本或上线风险。
2. 什么时候启动：明确触发条件，避免无限期遗忘。
3. 归属 Module：避免后续把能力散落到页面或后台 Implementation。
4. 验收标准：启动开发前补充样本、字段、状态和失败路径。

新增延期项时使用格式：

| 编号 | 延期功能 | 延期原因 | 触发条件 | 责任 Module |
| --- | --- | --- | --- | --- |
| D-XXX |  |  |  |  |

## 7. 首发前检查清单

| 检查项 | 通过标准 |
| --- | --- |
| 身份主键 | 所有业务表关联 `root_user_id`，不直接依赖 `openid` |
| `unionid` 预留 | 字段、状态、补链任务存在 |
| 商品展示 | myRoot 展示有赞商品快照，购买跳转有赞 |
| 任务事件 | 打卡、问卷、分享、咨询都写 `task_event` |
| 规则版本 | 活动发布后生成 `campaign_rule_version` |
| 奖励幂等 | `reward_grant` 有唯一幂等键 |
| 订单非前置 | 用户不绑定订单也可参与非购买条件任务 |
| 后台复核 | 异常可以进入 `manual_review_item` |
| 未完成项 | 延期功能已登记在第 5 节 |

## 8. 下一步待确认

1. 微信开放平台认证完成后，验证两个小程序的 `unionid` 获取链路。
2. 创建有赞云自用应用，确认商品、订单、客户、优惠券权限。
3. 确认首场路演活动规则：任务、条件、奖励和库存。
4. 决定商品/SKU 首版是手动导入、后台刷新，还是直接走有赞同步。
5. 决定首版奖励是自动发放，还是先由后台生成待发放记录后人工处理。
