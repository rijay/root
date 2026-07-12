# myRoot 小程序页面设计 v1

版本：V0.2
日期：2026-06-19
状态：已完成微信小程序官方设计规范 Review，并在 ardot 补齐本次涉及页面
关联设计页：ardot `myRoot 小程序页面设计 v1`
关联分期：[myroot_rebuild_iteration_plan.md](./myroot_rebuild_iteration_plan.md)

## 1. 输入来源

本版页面设计基于：

1. Root VIS 品牌手册：`/Users/rijay/Desktop/整理归档_2026-05-30/10_项目文件夹/Root项目/Root VIS/ROOT-4th.pdf`
2. Root 字体文件：`/Users/rijay/Desktop/整理归档_2026-05-30/10_项目文件夹/Root项目/Root VIS/root字体`
3. 微信小程序官方设计指南：`https://developers.weixin.qq.com/miniprogram/design/`
4. ardot mobile guidelines：状态栏、安全区域、单一纵向内容 wrapper、底部 Tab Bar 等移动端设计约束。
5. myRoot 重构决策：myRoot 负责互动、任务、商品展示和订单/奖励展示；有赞 Root 会员中心负责下单、支付、售后。
6. 活动规则决策：条件与奖励均可配置，任务事实与结算记录分离。

## 2. 微信官方规范 Review 结论

本次按微信小程序官方设计指南重点检查了：导航、官方菜单预留、页面焦点、等待反馈、异常状态、减少输入、避免误操作、Tab 数量、字体尺寸和设计稿尺寸。

| 检查项 | 官方指导 | 本版处理 | 结论 |
| --- | --- | --- | --- |
| 页面焦点 | 每个页面重点突出，减少无关干扰 | 首页、商品、任务、奖励分别只承载一个主意图 | 通过 |
| 流程明确 | 用户应知道当前在哪、可去哪、如何返回 | 4 个主 Tab 固定；次级页左上角提供返回 | 已修正 |
| 小程序官方菜单 | 右上角官方控件固定，页面需预留空间 | 所有页面状态栏增加官方菜单占位 | 已修正 |
| 页面内导航 | Tab 不少于 2 个、不超过 5 个，建议不超过 4 个 | 底部主导航 4 项：首页、商品、任务、奖励 | 通过 |
| 单页 Tab 数量 | 一个页面不应出现一组以上 Tab Bar | 只保留一组底部 Tab Bar；次级页不重复放置底部导航 | 通过 |
| 减少等待 | 同步、结算、发券等需及时反馈 | 商品同步、订单同步、奖励处理中、复核中均有状态页或状态文案 | 通过 |
| 异常可控 | 异常状态要有解释和退路 | 状态复核页提供可能原因、企微咨询、返回首页 | 通过 |
| 减少输入 | 表单尽量用选择控件，避免长输入 | 打卡和问卷使用选择项；开放文本只用于后续可选反馈 | 通过 |
| 避免误操作 | 关键动作点击区应清晰、足够大 | 主 CTA 高度约 44-48px，按钮间距充足 | 通过 |
| 设计稿尺寸 | 可采用 375px 或 390px 基准宽度 | 本版统一使用 390 x 844 | 通过 |

本次发现并修正的违背风险：

1. 原 4 张核心页没有显式预留微信右上角官方菜单区域，已在所有页面状态栏加入官方菜单占位，避免交互元素与微信官方控件冲突。
2. 原设计只画了主页面，次级页的返回路径未完整表达，已补齐注册、详情、提交、问卷、订单、咨询、复核、进度详情等次级页，并统一放置左上角返回。

## 3. 品牌视觉规则

Root VIS 转译到小程序时采用克制、冷静、科学、自然生长的方向，不做促销感强的电商页面。

| Token | 用途 | 色值 |
| --- | --- | --- |
| Absolute Black | 主文字、强对比 | `#000000` |
| Neutral Grey | 次级文字 | `#7b7a7e` |
| White | 卡片底色 | `#ffffff` |
| Deep Olive | 主品牌色、核心 CTA | `#242A0B` |
| Growth Green | 完成状态、轻提示 | `#617B10` |
| Ivory | 轻量状态底色 | `#F8FDE6` |
| Soil Brown | 后续可用于线下/土壤主题 | `#502F1E` |
| Reward Yellow | 进度、奖励、强调 | `#F9C647` |
| App Background | 小程序背景 | `#F7F7F2` |

字体：

1. ardot 设计稿使用 `PingFang SC` 近似排版。
2. 小程序 Implementation 应优先使用 Root 提供的 OPLUS SANS 字体文件。
3. 标题使用 Medium/Semibold/Bold；正文使用 Regular；避免负字距和过度装饰。

## 4. 页面地图

首版小程序页面按 4 个底部主导航组织：

| Tab | 页面 | 首版职责 |
| --- | --- | --- |
| 首页 | 活动首页 | 展示活动状态、今日任务、推荐商品入口 |
| 商品 | 商品页 | 展示有赞商品/SKU 快照，点击跳转 Root 会员中心购买 |
| 任务 | 任务中心 | 展示打卡、问卷、分享、咨询等运营任务 |
| 奖励 | 结算奖励页 | 展示达标条件、结算状态、奖励发放状态 |

本次已在 ardot 画出的全部页面：

| 序号 | 页面 | 类型 | 用户意图 |
| --- | --- | --- | --- |
| 01 | 活动首页 | 主 Tab | 查看成长任务、今日任务和推荐商品 |
| 02 | 商品与购买跳转 | 主 Tab | 浏览 myRoot 展示的 Root 会员中心商品并跳转购买 |
| 03 | 任务中心 | 主 Tab | 查看运营任务进度并进入打卡、问卷、分享、咨询 |
| 04 | 结算奖励 | 主 Tab | 查看达标条件、奖励记录和结算状态 |
| 05 | 注册授权 | 次级页 | 授权登录、授权手机号，不强制绑定订单 |
| 06 | 商品详情 | 次级页 | 查看商品快照并跳转 Root 会员中心购买 |
| 07 | 打卡提交 | 次级页 | 提交今日打卡事实 |
| 08 | 阶段问卷 | 次级页 | 提交阶段问卷，形成任务事实 |
| 09 | 有赞订单同步 | 次级页 | 查看订单同步中、待同步或异常解释 |
| 10 | 用户咨询 | 次级页 | 跳转企微咨询，承接活动规则、订单、奖励问题 |
| 11 | 状态复核 | 次级页 | 解释身份、订单、奖励等状态无法自动确认时的处理路径 |
| 12 | 进度详情 | 次级页 | 查看配置规则下的任务完成明细 |

## 5. 页面设计稿

ardot 已创建 12 张 390 x 844 小程序屏：

| 屏幕 | ardot Node | 说明 |
| --- | --- | --- |
| 01 活动首页 | `196:5` | 活动状态、推荐商品、今日任务 |
| 02 商品与购买跳转 | `196:6` | 商品镜像、同步状态、跳转购买 |
| 03 任务中心 | `196:7` | 任务进度、打卡 CTA、运营任务列表 |
| 04 结算奖励 | `196:8` | 达标条件、奖励记录、待复核状态 |
| 05 注册授权页 | `196:171` | 微信授权登录、手机号授权、订单非强制绑定说明 |
| 06 商品详情页 | `196:189` | 商品详情快照、套装选择、跳转 Root 会员中心 |
| 07 打卡提交页 | `196:210` | 当日打卡选择项与提交 |
| 08 问卷提交页 | `196:240` | 阶段问卷题目与提交 |
| 09 订单同步页 | `196:271` | 有赞订单同步状态、咨询入口 |
| 10 咨询企微页 | `196:290` | 企微咨询入口、常见问题 |
| 11 异常复核页 | `196:311` | 人工复核说明、企微咨询、返回首页 |
| 12 进度详情页 | `196:333` | 规则条件明细、进度解释 |

最终总览预览图：

`/Users/rijay/Documents/Root/tmp/ardot_screenshots_reviewed/myroot_all_pages_reviewed_ordered_v1.png`

说明：本次 ardot 批量截图文件名与画面内容存在错位，最终归档总览已按页面标题和画面内容重新排序；开发拆单以本节 ardot Node 表和 ardot 画布节点为准。

布局检查：已对 12 张页面 Frame 运行 ardot `capture_layout`，未返回重叠、越界或裁切问题。

## 6. 页面与 Module 对应关系

| 页面 | 读取 | 写入 | 依赖 Module |
| --- | --- | --- | --- |
| 活动首页 | `campaign_definition`、`task_progress_snapshot`、`campaign_product_relation` | `campaign_participant` | Campaign Module、Task Progress Module、Product Mirror Module |
| 商品与购买跳转 | `youzan_product`、`youzan_sku`、`campaign_product_relation` | `product_jump_log` | Product Mirror Module |
| 任务中心 | `task_progress_snapshot`、`campaign_rule_version` | `task_event` | Task Progress Module、Campaign Module |
| 结算奖励 | `settlement_record`、`reward_grant`、`reward_delivery_job` | 无直接写入，必要时触发重查 | Settlement Module、Reward Grant Module |
| 注册授权 | `root_user`、`wechat_identity` | `wechat_identity`、`user_contact_method` | Account Identity Module |
| 商品详情 | `youzan_product`、`youzan_sku`、`campaign_product_relation` | `product_jump_log` | Product Mirror Module |
| 打卡提交 | `task_definition`、`task_progress_snapshot` | `task_event` | Task Progress Module |
| 阶段问卷 | `questionnaire_definition`、`task_definition` | `questionnaire_answer`、`task_event` | Questionnaire Module、Task Progress Module |
| 有赞订单同步 | `youzan_order`、`order_sync_job` | 无直接写入，必要时触发重查 | Order Mirror Module |
| 用户咨询 | `campaign_definition`、`faq_entry` | `consultation_intent_log` | Consultation Module |
| 状态复核 | `manual_review_item`、`settlement_record`、`reward_grant` | `consultation_intent_log` | Manual Review Module、Settlement Module |
| 进度详情 | `task_progress_snapshot`、`campaign_rule_version` | 无直接写入 | Task Progress Module、Campaign Module |

页面不直接读取或处理有赞原始字段。所有商品、订单、客户、奖励发放能力都通过对应 Adapter 的镜像结果进入 myRoot。

## 7. 关键页面状态

| 状态 | 页面表现 |
| --- | --- |
| 未登录 | 首页展示活动介绍，关键动作前触发授权 |
| `unionid_pending` | 用户可继续参与，后台补链，不在前台制造错误感 |
| 商品同步中 | 商品页展示最近同步时间或同步中提示 |
| 商品下架 | 商品卡保留但购买按钮置灰，提示 Root 会员中心暂不可购买 |
| 订单未同步 | 任务条件显示“同步中”，不要求用户手动绑定 |
| 任务未完成 | 任务中心明确显示剩余任务 |
| 达标待结算 | 奖励页显示“处理中” |
| 奖励待发放 | 奖励记录显示“待发放” |
| 免单待复核 | 奖励记录显示“待复核”，后台进入 `manual_review_item` |
| 发券失败 | 用户端显示处理中，后台进入重试任务 |

## 8. 设计约束

1. 页面采用标准状态栏、微信官方菜单预留位、单一纵向内容 wrapper。
2. 主 Tab 页面保留一组底部 Tab Bar；次级页面不重复放置底部 Tab Bar。
3. 所有次级页左上角提供返回操作。
4. 主 CTA 使用 Deep Olive，不使用高饱和促销红。
5. Reward Yellow 只用于进度和奖励强调。
6. 商品页必须说明“myRoot 展示商品，Root 会员中心完成购买”。
7. 首页只展示摘要任务，完整任务进入任务中心。
8. 页面文案不暴露 `openid`、`unionid`、`yzUid` 等技术身份。
9. 订单、发券、结算失败都应表现为可处理状态，不把外部 Adapter 错误直接暴露给用户。

## 9. 进入开发拆单前还需补齐

这些事项不阻塞页面设计稿进入评审，但需要在开发拆单或后续迭代中持续记录：

1. 注册授权页：确认手机号授权是否进入 MVP，以及 `unionid_pending` 的前台提示口径。
2. 打卡提交页：确认打卡题目、是否允许图片上传、补卡规则、重复提交处理。
3. 阶段问卷页：确认题库配置、题型、必填校验和提交后是否可修改。
4. 商品详情页：确认 P0 是否需要详情页，还是商品页直接跳转 Root 会员中心。
5. 有赞订单同步页：确认 P1 是否展示订单明细，还是仅展示同步状态。
6. 用户咨询页：确认企微跳转方式、企微二维码或客服链接的管理方式。
7. 状态复核页：确认人工复核触发条件、复核 SLA、后台处理 Interface。
8. 进度详情页：确认运营规则配置字段和用户可见解释字段。
9. 小程序 Implementation：确认 OPLUS SANS 字体加载方式和授权范围。
10. 后台管理：确认 Element Plus Admin 中对应的规则、任务、奖励、复核、订单镜像管理页拆分。
