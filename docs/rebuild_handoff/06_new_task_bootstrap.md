# 新 Codex 任务启动说明

## 1. 可直接复制的提示词

```text
工作目录：/Users/rijay/Documents/Root/root_seven_day_checkin

这是 myRoot 小程序重构任务。不要依赖或要求读取已归档的历史长对话。

先完整读取：
1. docs/rebuild_handoff/README.md
2. docs/rebuild_handoff/01_product_and_ued_baseline.md
3. docs/rebuild_handoff/02_current_implementation_audit.md
4. docs/rebuild_handoff/03_target_architecture_and_performance.md
5. docs/rebuild_handoff/04_material_and_asset_manifest.md
6. docs/rebuild_handoff/05_rebuild_backlog_and_acceptance.md
7. docs/design.md
8. docs/v1.0.0_product_requirements.md

任务目标：基于 CURRENT 五 Tab 设计，对小程序前端和后端进行分切片重构，优先解决设计还原、首屏速度、登录反馈和首页数据瀑布，同时保留身份、隐私、健康安全、幂等、Outbox/Inbox、活动、任务、奖励和旧 7 日计划兼容。

第一步只做只读基线：
- 确认当前 main、工作树和未提交改动；
- 回读当前微信开发/审核/发布状态与 CloudBase 流量；
- 运行现有测试；
- 采集真机冷启动、热启动、登录和首页请求瀑布；
- 检查 Ardot CURRENT 交付能否重新读取。

不要：
- 从旧四 Tab 文档继续；
- 把 PANE 图片或 PDF 页面直接发布；
- 把活动占位数据写死为真实内容；
- 未经授权改生产流量、数据库或密钥；
- 把上传、审核和发布视为同一状态。

每个开发切片必须给出：修改的 Module/Interface/Seam、测试、性能前后对比、设计截图对比、风险和回滚方式。
```

## 2. 推荐拆成的新任务

为避免再次形成超长对话，建议每个任务只处理一个可独立验收的切片：

1. `myRoot-R0-基线与真机性能测量`
2. `myRoot-R1-Design-System与五Tab外壳`
3. `myRoot-R2-Session与首页聚合性能`
4. `myRoot-R3-商品活动任务我的迁移`
5. `myRoot-R4-健康纵向流程与隐私Gate`
6. `myRoot-R5-Candidate灰度与微信发布`

每个任务完成后把结果写回 `docs/rebuild_handoff/` 或对应正式文档，不依赖聊天上下文传递。

## 3. 状态回读清单

新任务开始时必须重新确认：

- `git status --short --branch` 与 `origin/main`；
- 小程序代码内版本和微信后台开发版本；
- 0.5.15 是否已提交审核、审核结果和当前线上版本；
- CloudBase 当前版本、流量、环境变量名和 `/health`/`/ready`；
- MySQL 当前迁移与 Candidate 数据库证明；
- Ardot CURRENT 页面是否仍可读；
- 品牌摄影 clean master 与授权是否新增。

## 4. 安全提醒

- 历史对话曾出现敏感凭据暴露；不要从聊天记录、截图或日志复制任何 token、AppSecret、MySQL 密码或 CloudBase Key。
- 只使用已安全落盘的当前凭据，并先验证权限范围和有效期。
- 文档和日志只记录凭据名称、ID、权限和轮换状态，不记录明文。

