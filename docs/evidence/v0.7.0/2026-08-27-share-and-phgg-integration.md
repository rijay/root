# myRoot v0.7.0 分享与 PHGG 科学档案本地验收

- 日期：2026-08-27
- 分支：`codex/v0.7.0-development-20260825`
- 目标：将 0.6.1“当前页面不可分享”修复及 ROOT PHGG 介绍需求纳入 0.7.0
- 结论：本地代码、自动化与微信开发者工具验收通过；尚不构成真机、体验版或发布验收。

## 分享能力

- 0.7.0 的全局分享策略与基线提交 `63cbc81` 中的 0.6.1 修复一致：非欢迎页在 `onLoad/onShow` 恢复“转发给朋友”，欢迎页隐藏分享菜单。
- PHGG 科学档案已加入公开分享白名单，分享卡片回流路径为 `/subpkg/content/pages/phgg-reference/index`。
- 新增回归断言：从隐藏分享菜单的页面返回公开页后，下一次 `onShow` 必须重新恢复分享。
- 微信开发者工具当前页调用 `showShareMenu` 返回 `showShareMenu:ok`；当前页生成的分享卡片标题和路径正确。

## PHGG 科学档案

- 新增原生页面 `subpkg/content/pages/phgg-reference/index`，不使用 `web-view` 或外部 H5。
- 产品 Tab 和“关于 Root”均可进入该页面。
- 页面包含原料概览、证据阅读方法、四条精选研究索引、DOI/PMID/PMCID 复制和信息使用边界。
- 四条文献的期刊、作者和 DOI/PMID/PMCID 已按 PubMed、PMC 或出版方页面逐条核对；原始材料中 `PMC10017317` 的期刊错配已修正为 `J Clin Biochem Nutr. 2023;72(2):189–197`。
- 已删除或不采用原始材料中的疾病治疗、抗生素联合、术后、减重、强功效数字、供应商消费者测试、认证范围及原料研究剂量转成成品建议等表达。
- 在具体 SKU 配料适用范围取得可核验证据前，不在单个商品详情增加 PHGG 入口。

## 验证结果

- `npm run check --prefix miniprogram`：PASS。
- 新增 `phgg-reference.test.js`：目录定位、复制、分享卡片均 PASS。
- `page-share.test.js`：分享恢复和安全路径过滤 PASS。
- `brand-palette.test.js`：74 个 WXML/WXSS 文件通过，未引入旧米色或页面原始色值。
- 新页面、产品页、关于页的 WXML/WXSS 局部编译：PASS。
- 开发者工具页面检查：首屏、目录定位、研究索引、产品入口、关于页入口和安全区布局均通过；最终控制台无错误。
- 首条文献复制回读：`PMID: 12781858｜DOI: 10.1016/S0899-9007(02)01032-8`。

## 尚未覆盖

1. iOS 与 Android 真机系统分享菜单及分享回流；
2. 体验版上传、微信审核与生产发布；
3. 具体 SKU 与 PHGG/Fibalance® 配料适用关系的包装或批准资料核验。

本次未执行上传、推送或生产环境变更。
