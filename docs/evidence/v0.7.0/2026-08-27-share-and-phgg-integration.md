# myRoot v0.7.0 分享与 PHGG 科学档案本地验收

- 日期：2026-08-27
- 分支：`codex/v0.7.0-development-20260825`
- 目标：将 0.6.1“当前页面不可分享”修复及 ROOT PHGG 介绍需求纳入 0.7.0
- 结论：本地代码、自动化与微信开发者工具验收通过；尚不构成真机、体验版或发布验收。

## 分享能力

- 0.7.0 的全局分享策略与基线提交 `63cbc81` 中的 0.6.1 修复一致：非欢迎页在 `onLoad/onShow` 恢复“转发给朋友”，欢迎页隐藏分享菜单。
- PHGG 科学档案已加入公开分享白名单，分享卡片回流路径为 `/subpkg/content/pages/phgg-reference/index`。
- 真机普通预览已确认“发送给朋友”可用；“分享到朋友圈”首次验证失败，定位为页面未注册 `onShareTimeline`。现已为 PHGG 公开内容页单独补齐朋友圈回调和菜单，其余页面不扩开朋友圈能力。
- 新增回归断言：从隐藏分享菜单的页面返回公开页后，下一次 `onShow` 必须重新恢复分享。
- 微信开发者工具当前页调用 `showShareMenu` 返回 `showShareMenu:ok`；当前页生成的分享卡片标题和路径正确。

## PHGG 科学档案（后续用户决定覆盖前版删减方案）

- 新增原生页面 `subpkg/content/pages/phgg-reference/index`，不使用 `web-view` 或外部 H5。
- 产品 Tab 和“关于 Root”均可进入该页面。
- 用户随后明确要求页面严格按已上传 HTML 放置内容，前版“精选四条、删减原稿表述”的方案因此废止。
- 当前内容母版为用户提供的 `ROOT_Phgg_Scientific_Reference.html`，SHA-256：`33ad4be54acef24a7ac0d345ea7a1e54ae8ab3f8ab9ac34d8b4114c9f58d7081`。
- 原生页面现包含母版封面、7 个章节、2 张表、全部事实卡、15 条参考文献及原页脚；只将 HTML/CSS 布局翻译为 WXML/WXSS，并遵循 0.7.0 品牌色 token。
- 原稿中的疾病、治疗、术后、减重、强功效数字、供应商消费者测试、认证和剂量等表述仍需品牌、产品和合规审核；本次内容等价改造不构成发布批准。
- 在具体 SKU 配料适用范围取得可核验证据前，不在单个商品详情增加 PHGG 入口。

## 验证结果

- `npm run check --prefix miniprogram`：PASS。
- `phgg-reference.test.js` 新增母版指纹、7 章节和 15 条文献回归断言；最终结果以本轮完整回归记录为准。
- `page-share.test.js`：分享恢复和安全路径过滤 PASS。
- `brand-palette.test.js`：74 个 WXML/WXSS 文件通过，未引入旧米色或页面原始色值。
- 新页面、产品页、关于页的 WXML/WXSS 局部编译：PASS。
- 前版开发者工具检查只覆盖删减页面，不能作为当前完整长页的视觉验收证据；完整页面需重新编译和真机查看。
- 首条文献复制回读：`PMID: 12781858｜DOI: 10.1016/S0899-9007(02)01032-8`。

## 完整母版页面重新验证

- PHGG WXML：微信开发者工具局部编译 PASS，`codeLength=32400`。
- PHGG WXSS：微信开发者工具局部编译 PASS，2 个文件、`totalCodeLength=21315`。
- 模拟器首屏确认封面、标题、副标题、品牌/原料/日期元信息及目录正常显示。
- 模拟器滚动至正文后确认目录吸顶位置位于胶囊导航下方，没有遮挡章节标题；横向表格保持独立滚动。
- `phgg-reference.test.js`：母版 SHA-256、15 条文献、7 章节目录、复制、目录定位、朋友分享与朋友圈参数 PASS。
- `formal-content.test.js`、`brand-palette.test.js` 及完整 `npm run check --prefix miniprogram`：PASS。
- 上述结果证明原生页面结构和本地显示可用，不替代原稿内容合规审核，也不替代真机长页与分享验收。

## 尚未覆盖

1. PHGG 朋友圈补丁的 iOS 真机菜单与分享回流，以及 Android 真机系统分享菜单及两类分享回流；
2. 体验版上传、微信审核与生产发布；
3. 具体 SKU 与 PHGG/Fibalance® 配料适用关系的包装或批准资料核验。

本次未执行上传、推送或生产环境变更。
