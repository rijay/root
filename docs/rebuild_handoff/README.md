# myRoot 小程序重构交接包

> 冻结时间：2026-08-02  
> 代码基线：`main@a5f88c32d1fe0cd890957027ffce5c51f152f609`  
> 用途：让新的 Codex 任务无需读取历史长对话，即可继续 myRoot 小程序前端和后端重构。

## 1. 先读结论

1. 产品目标已经比较清楚：myRoot 服务既有 Root 会员，以品牌和商品展示为入口，完成会员关联后逐步进入健康、活动、任务与长期会员关系。
2. 当前仓库不是设计稿的完成实现。五 Tab 已进入 `app.json`，但首页仍承载旧 7 日计划、登录、注册、健康同意、活动、商品、任务、奖励和日常状态，视觉与交互没有按 CURRENT UED 完整还原。
3. 当前前端慢的主要风险不是包体超限，而是首屏状态判定和后续数据读取耦合、Cloud Container 最长 30 秒超时、页面重复刷新、缺少请求合并/缓存/取消，以及 `home` 页面过深过宽。
4. 后端已有大量可靠性与运营能力，但入口文件和事实读取仍过于集中。重构应保留已经验证过的身份、隐私、幂等、Outbox/Inbox、活动和奖励事实，不应重写成新的单体状态机。
5. 2026-08-02 已从该基线上传微信开发版本 `0.5.15`，真机登录通过；公众平台最终“提交审核”未在仓库或本交接包中独立回读，状态为 `待核验`。上传版本号不等于 `miniprogram/config/version.js` 的代码常量，该常量仍是 `0.5.13`。

## 2. 权威阅读顺序

| 顺序 | 文件 | 效力 |
| --- | --- | --- |
| 1 | [`../design.md`](../design.md) | 当前品牌、产品、视觉、页面和交互方向 |
| 2 | [`../v1.0.0_product_requirements.md`](../v1.0.0_product_requirements.md) | v1.0.0 产品范围、状态、验收与发布 Gate |
| 3 | [`01_product_and_ued_baseline.md`](01_product_and_ued_baseline.md) | 对上述文档的重构用摘要和冲突裁决 |
| 4 | [`02_current_implementation_audit.md`](02_current_implementation_audit.md) | 当前代码真实实现、差距和性能问题 |
| 5 | [`03_target_architecture_and_performance.md`](03_target_architecture_and_performance.md) | 重构目标 Module、Interface、Seam 与性能预算 |
| 6 | [`04_material_and_asset_manifest.md`](04_material_and_asset_manifest.md) | 品牌手册、摄影、PANE、Ardot 和仓库资产索引 |
| 7 | [`05_rebuild_backlog_and_acceptance.md`](05_rebuild_backlog_and_acceptance.md) | 建议开发顺序、退出条件和对抗式审查 |
| 8 | [`06_new_task_bootstrap.md`](06_new_task_bootstrap.md) | 新 Codex 任务可直接复制的启动说明 |

旧文档 `myroot_miniprogram_page_design_v1.md`、`root_brand_ui_design_breakdown.md` 和 v0.x 设计文档仅作为历史参考。若其四 Tab、旧活动首页或旧视觉规则与 `design.md` / v1.0.0 PRD 冲突，以后两者为准。

## 3. 当前事实快照

| 项目 | 当前证据 | 状态 |
| --- | --- | --- |
| Git 主线 | `a5f88c3 fix: make WeChat identity login auditable (#9)` | 已合并 |
| 小程序导航 | 首页 / 健康 / 活动 / 任务 / 我的 | 已存在代码 |
| 登录修复 | 首次点击反馈、协议确认、阶段提示、失败重试、登录后读取失败不再静默退出 | 代码与真机通过 |
| 微信上传 | `0.5.15`，577,603 bytes | 已上传 |
| 微信审核 | 公众平台最终提交未独立回读 | 待核验 |
| UED | Ardot CURRENT 结构索引存在；逐屏像素、交互、内容和签署仍开放 | 未完成交付 |
| 品牌摄影 | 已有选择建议和文件摘要；clean master 与商业授权未齐 | 不可直接发布 |
| 前端性能 | 未建立首屏实测基线、请求瀑布和设备分位数 | 必须先测后改 |
| 后端运行态 | 历史发布、Candidate、MySQL 和 CloudBase 记录很多；实时状态会漂移 | 新任务必须重新回读 |

## 4. 后续任务的硬规则

- 不把页面文件存在视为 UED 已完成。
- 不从旧四 Tab 设计继续开发。
- 不把 PANE 截图、品牌 PDF 页面或带字 PNG 直接作为线上素材。
- 不删除旧 7 日计划能力；先通过 Adapter 和路由投影兼容，再逐步替换外壳。
- 不把普通分析事件与健康敏感数据、身份凭据或业务审计事实混在一起。
- 不把本地 CI、上传、提交审核、审核通过和线上发布合并成一个状态。
- 所有 CloudBase、MySQL、微信公众平台和有赞状态在新任务中重新只读核验。

## 5. 缺失或外部材料

- Ardot 可操作文件和完整逐屏标注不在 Git 仓库；仓库仅有只读结构证据。
- PANE 截图、ROOT PDF、五张摄影候选和 Ardot 总览图保留在本机外部路径，见资产清单；为避免增加约 50 MB 仓库体积，本交接包不复制二进制文件。
- 当前线上 CloudBase 流量、Candidate、数据库迁移和微信审核状态都可能变化，不能从本快照直接推断。

