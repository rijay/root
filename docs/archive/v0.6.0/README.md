# myRoot v0.6.0 提审归档

> 归档日期：2026-08-25
> 归档分支：`codex/v0.6.0-review-archive-20260825`
> 归档标签：`archive/v0.6.0-review-submitted-20260825`
> 当前状态：`REVIEW_SUBMITTED_OWNER_CONFIRMED / REVIEW_PENDING`

## 1. 归档结论

本目录冻结 myRoot v0.6.0 当前提审候选的代码、配置、测试记录和交接边界，供审核问题定位、版本回溯和下一版本开发使用。

该归档只证明：

- 项目负责人确认 2026-08-25 12:05 上传的 `0.6.0` 候选已被设置为体验版并完成真机冒烟；
- 项目负责人确认已手动提交微信审核；
- 当前归档代码已通过本地自动化检查；
- 当前候选的产品、健康、活动、分享和体验装领取等实现已进入 Git 管理。

该归档不证明：

- 微信审核已经通过；
- 小程序已经正式发布；
- 生产后端已经部署为本归档代码；
- 数据库迁移 `069_health_assessment.sql`、`070_growth_engagement.sql`、`071_product_analytics.sql` 已在生产环境执行。

审核通过后的“正式发布”仍是独立外部操作，需要单独批准。

## 2. Git 身份与来源

| 项目 | 内容 |
|---|---|
| Git 仓库 | `/Users/rijay/Documents/Root/root_seven_day_checkin` |
| 归档工作树 | `/Users/rijay/Documents/Root/.codex-worktrees/myroot-v060-integration-20260817` |
| 归档分支 | `codex/v0.6.0-review-archive-20260825` |
| 基础提交 | `bde9685`（v0.6.0 配置就绪记录） |
| `origin/main` 基线 | `8277dda` |
| 提审源快照 | `/Users/rijay/Documents/Root/myroot-v060-slim-20260820` |

提审源快照本身没有 `.git`。本次归档将其中实际提交审核的小程序代码与材料导入 Git 分支，同时保留集成分支已有的 v0.6.0 后端、071 个迁移文件及发布校验能力。

后端没有回退为旧的兼容桥接代码。归档后端以 `bde9685` 为基础，只合入当前运营后台确需的首页 Banner `kicker` 可编辑能力及其测试、构建产物。

## 3. 当前候选身份

| 项目 | 内容 |
|---|---|
| 小程序 | myRoot会员体验中心 |
| AppID | `wx7727a02565aed1c2` |
| 版本号 | `0.6.0` |
| 上传时间 | 2026-08-25 12:05 CST |
| 上传描述 | `提审候选：健康Tab顶部导航对齐` |
| 代码包 | 总大小 `2,109,527` bytes；主包 `857,760` bytes |
| 固定肠道自测路径 | `subpkg/health/pages/assessment/index?assessmentType=GUT_REGULARITY` |

上传、体验版和人工验收详情见：

- [v0.6.0 内部发布门禁](../../v0.6.0_内部发布门禁_2026-08-25.md)
- [v0.6.0 微信提审准备单](../../v0.6.0_微信提审准备单_2026-08-25.md)

## 4. 本版本冻结范围

- 首页保持既有 Launching 和首页主体风格，Launching 仅由用户主动跳过；应用内普通页面跳转不再反复闪现；
- 底部导航为“首页 / 产品 / 健康 / 活动 / 我的”，含全面屏安全区适配；
- 产品聚合页、商品详情和 ROOT 会员商城跳转；
- 健康起点评测、回测、历史记录及 5 道题肠道规律自测；
- 肠道自测答案、结果和历史仅保存在当前设备，最长 180 天；
- 肠道自测所有结果的“优先行动”第一项固定为“推荐服用膳食纤维”；
- 肠道 v2 当前没有安全题或中止分支，也没有可用于量化回测的数值维度；
- 完成肠道 5 道题后显示体验装领取入口，最终资格和库存以 ROOT 会员商城为准；
- 活动只读取服务端正式数据，不使用本机模拟活动；
- 页面分享、首次渠道归因及运营 Banner 配置；
- 运营后台首页 Banner `kicker`、标题、图片和动作配置。

肠道问卷的题目、分类、结果文案、领取和存储规则见：

- [ROOT 肠胃健康 5 道题：当前版本完整逻辑](../../ROOT肠胃健康5道题_当前版本完整逻辑_v0.6.0_2026-08-25.md)

## 5. 验证结果

归档前已执行：

- 小程序：`npm run check`，通过；
- 运营后台：`npm run check`，41/41 通过；
- 后端：`npm test`，612 项、608 通过、4 跳过、0 失败；
- 运营后台生产构建和后端静态资源同步，通过。

完整记录见 [TEST_RECORD_2026-08-25.md](./TEST_RECORD_2026-08-25.md)。

## 6. 恢复与回溯

```bash
cd /Users/rijay/Documents/Root/root_seven_day_checkin
git fetch --all --prune
git switch codex/v0.6.0-review-archive-20260825
git status --short
```

如果本地没有该分支：

```bash
git switch --track origin/codex/v0.6.0-review-archive-20260825
```

若只需核对提审归档，不继续开发，可检出只读标签：

```bash
git switch --detach archive/v0.6.0-review-submitted-20260825
```

## 7. 后续开发规则

下一版本不要从无 Git 的 `myroot-v060-slim-20260820` 快照继续开发。应先确认 v0.6.0 的微信审核和正式发布结果，再从已确认的 Git 基线创建新分支。

具体步骤和待确认事项见 [NEXT_VERSION_HANDOFF.md](./NEXT_VERSION_HANDOFF.md)。
