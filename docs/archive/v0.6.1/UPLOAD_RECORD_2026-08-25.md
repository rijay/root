# myRoot 小程序 v0.6.1 上传记录

## 首次上传

- 上传状态：成功（微信开发者工具官方 CLI 返回 `✔ upload`）
- 上传时间：2026-08-25 16:46 CST
- 小程序：myRoot会员体验中心
- AppID：`wx7727a02565aed1c2`
- 上传版本：`0.6.1`
- 上传说明：肠道分类纤维建议与Banner3文案字号调整

## 对应源码

- 分支：`codex/v0.6.1-upload-20260825`
- 上传代码提交：`2ec4f6ffd70bfd6586c0cae895eac65460821190`
- 项目目录：`miniprogram`
- 上传前校验：`miniprogram` 的 `npm run check` 通过；仓库根目录 `npm run verify` 通过（6/6）

## 包体结果

| 包 | 大小 |
| --- | ---: |
| 总计 | 2.0 MB（2,117,370 Byte） |
| 主包 | 845.3 KB |
| activity 分包 | 43.8 KB |
| campaign 分包 | 293.5 KB |
| content 分包 | 764.3 KB |
| health 分包 | 102.8 KB |
| profile 分包 | 18.1 KB |

## 线上问题热修复重传

- 上传状态：成功（微信开发者工具官方 CLI 返回 `✔ upload`）
- 上传时间：2026-08-25 17:11 CST
- 上传版本：`0.6.1`
- 上传说明：修复固定扫码前置页与当前页面不可分享
- 分支：`codex/v0.6.1-entry-share-hotfix-20260825`
- 上传代码提交：`904ee9c8eff3ca6242469be9a3a1dd7b583ac6b6`
- 校验结果：入口与分享专项测试通过；`miniprogram npm run check` 通过；仓库根目录 `npm run verify` 通过（6/6）

### 热修复内容

1. 外部固定路径 `subpkg/health/pages/assessment/index?assessmentType=GUT_REGULARITY` 始终先进入“ROOT 陪伴计划”前置页；仅用户点击“开始肠道自测”后使用内部来源参数继续答题，不再依赖 10 分钟本机凭证。
2. 所有非 Launching 页面在每次 `onShow` 时重新开启 `shareAppMessage`，避免缓存页面返回后显示“当前页面不可分享”；分享路径继续过滤问卷实例、答案和结果等敏感信息。

### 热修复包体

| 包 | 大小 |
| --- | ---: |
| 总计 | 2.0 MB（2,117,655 Byte） |
| 主包 | 845.7 KB |
| activity 分包 | 43.8 KB |
| campaign 分包 | 293.5 KB |
| content 分包 | 764.3 KB |
| health 分包 | 102.7 KB |
| profile 分包 | 18.1 KB |

## 发布边界

最新 0.6.1 热修复代码已上传为开发版本。微信开发者工具官方 CLI 不提供“选为体验版”命令，因此体验版切换仍需在微信公众平台版本管理页完成并回读；当前未提交微信审核、未正式发布，也未推送 Git 远端。
