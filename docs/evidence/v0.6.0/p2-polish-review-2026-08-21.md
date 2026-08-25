# v0.6.0 P2 体验收尾验证

日期：2026-08-21
对象：`myroot-v060-slim-20260820/miniprogram`
范围：本地隔离候选；未上传、未发布、未修改线上配置

## 已处理

1. 失效商品定位回退到有效商品并显示说明，不保留无效选中态。
2. 无效商品详情增加“查看全部产品”和“返回首页”。
3. 产品轮播补显式高度，失效目标提示条移除全屏 `.root-page`，商品卡片恢复首屏可见。
4. 无效详情 Grid 改为顶部排布，按钮恢复正常高度。
5. 产品、健康历史/对比/结果、渠道异常页补齐状态、筛选与选择语义；未开始评测文案改为“未开始”。
6. 首页 Banner 的指定商品定位优先于旧浏览位置；显式定位时重建横向轮播，避免原生 `scroll-view` 保留第二款商品的旧位置。

## 已验证

- `node scripts/product-experience.test.js`：通过。
- `node scripts/p2-polish.test.js`：通过，并已纳入 `npm run check`。
- 完整 `npm run check`：通过；请求测试中的模拟超时告警为既有预期夹具，测试结果为 `request tests ok`。
- 微信开发者工具登录态有效。
- 失效商品定位场景 `pages/products/index?productId=missing-product`：页面编译打开成功，轮播实际 `top=256.1875px`，商品卡片可见，控制台无 `error/fail/warn`。
- 无效详情场景 `pages/product-detail/index?productId=missing-product`：页面编译打开成功，两个出口可见且按钮未拉伸，控制台无 `error/fail/warn`。
- `pages/health/index.wxml` 与 `subpkg/health/pages/history/index.wxml`：微信单文件编译通过；历史页未登录时按既有规则转到登录页，控制台无 `error/fail/warn`。
- 默认入口 `pages/welcome/index` 在 2 秒内进入 `pages/home/index`；首页 Banner 在存在第二款商品旧浏览位置时仍定位到 `4749049439`，第一张卡片实际 `left=16px`，控制台无 `error/fail/warn`。
- 修复后重新生成整包开发预览：总包 `643632 B`，主包 `527325 B`；二维码 `myroot-v060-p2-preview.jpg`，SHA-256 `5dc13a2fe1d59eab732d8ccc44bf157c9447eb7504db58f93edd02c39bd3b356`。
- 本地视觉证据：`p2-invalid-product-target.jpg`、`p2-invalid-product-detail.jpg`。

批量单文件编译曾触发微信侧 `-80408 / 超出频率限制60次/分钟`，未进行连续重试；频率窗口恢复后仅对健康首页和历史页各执行一次并通过。该限流不属于代码编译错误。

## 不在本轮伪造或启用

- 两款产品真实商品图、`skuId`、本地价格与库存。
- 运营弹窗活动 ID、有效期与落地目标。
- 渠道 ID、签名密钥和服务端原子首次归因验收。
- 任何上传、体验版替换、审核或生产发布动作。

上述输入缺失不应以占位值写入正式配置。当前实现继续保持运营弹窗关闭、渠道列表为空，并以会员中心实时商品页面作为价格、库存与可售状态依据。
