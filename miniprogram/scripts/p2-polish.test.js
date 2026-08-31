const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const appConfig = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"));

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const products = read("pages/products/index.wxml");
const productsConfig = JSON.parse(read("pages/products/index.json"));
const activitiesConfig = JSON.parse(read("pages/activities/index.json"));
const profileConfig = JSON.parse(read("pages/profile/index.json"));
const productDetail = read("pages/product-detail/index.wxml");
const productDetailStyles = read("pages/product-detail/index.wxss");
const productScript = read("pages/products/index.js");
const productDetailScript = read("pages/product-detail/index.js");
const productStyles = read("pages/products/index.wxss");
const home = read("pages/home/index.wxml");
const homeStyles = read("pages/home/index.wxss");
const health = read("pages/health/index.wxml");
const history = read("subpkg/health/pages/history/index.wxml");
const compare = read("subpkg/health/pages/compare/index.wxml");
const result = read("subpkg/health/pages/result/index.wxml");
const assessment = read("subpkg/health/pages/assessment/index.wxml");
const assessmentScript = read("subpkg/health/pages/assessment/index.js");
const campaign = read("subpkg/campaign/pages/root-with-you/index.wxml");
const campaignScript = read("subpkg/campaign/pages/root-with-you/index.js");
const campaignStyles = read("subpkg/campaign/pages/root-with-you/index.wxss");
const activityScript = read("subpkg/activity/pages/detail/index.js");
const channelError = read("pages/channel-error/index.wxml");

assert.match(productScript, /focusNotice:\s*focus\.requestedUnavailable/);
assert.match(productScript, /指定商品暂不可见，已为你展示当前可用产品。/);
assert.match(products, /product-focus-notice[^>]*role="status"[^>]*aria-live="polite"/);
assert.match(products, /class="product-card[^>]*role="group"[^>]*aria-label=/s);
assert.match(productStyles, /\.product-carousel\s*\{[^}]*height:\s*730rpx/s);
assert.equal(productsConfig.navigationStyle, "custom");
assert.equal(productsConfig.backgroundColor, "#FFFFFF");
assert.equal(productsConfig.backgroundColorTop, "#FFFFFF");
assert.equal(productsConfig.backgroundColorBottom, "#FFFFFF");
assert.equal(productsConfig.backgroundTextStyle, "dark");
assert.equal(productsConfig.enablePullDownRefresh, true);
assert.match(productScript, /onPullDownRefresh\(\)[\s\S]*loadProducts[\s\S]*wx\.stopPullDownRefresh\(\)/);
for (const [page, config] of [["activities", activitiesConfig], ["profile", profileConfig]]) {
  assert.equal(config.backgroundColor, "#FFFFFF", `${page} 页面背景应为白色`);
  assert.equal(config.backgroundColorTop, "#FFFFFF", `${page} iOS 顶部回弹背景应为白色`);
  assert.equal(config.backgroundColorBottom, "#FFFFFF", `${page} 底部回弹背景应为白色`);
  assert.equal(config.backgroundTextStyle, "dark", `${page} 下拉提示应适配白色背景`);
  assert.equal(config.enablePullDownRefresh, undefined, `${page} 不应仅为修复回弹背景而开启下拉刷新`);
}
assert.match(products, /class="products-tab-title">产品<\/view>/);
assert.match(productStyles, /\.products-page\s*\{[^}]*background:\s*var\(--color-root-nav\)/s);
assert.match(productStyles, /\.products-hero\s*\{[^}]*padding-top:\s*78px/s);
assert.match(productStyles, /\.products-hero\s*\{[^}]*padding-left:\s*20px/s);
assert.doesNotMatch(products, /全部产品/);
assert.doesNotMatch(products, /按你的节奏来选/);
assert.doesNotMatch(products, /进一步了解/);
assert.doesNotMatch(products, /浏览 ROOT 的日常补给方案/);
assert.match(products, /class="product-price">\{\{item\.priceText/);
assert.doesNotMatch(productStyles, /\.product-learn/);
assert.match(productStyles, /\.product-price\s*\{/);
assert.doesNotMatch(products, /本地跳转配置更新于|configUpdatedText|product-config-date/);
assert.doesNotMatch(productScript, /本地跳转配置更新于|configUpdatedText/);
assert.doesNotMatch(productStyles, /\.product-config-date/);
assert.match(products, /class="product-purchase"[\s\S]*class="product-price"[\s\S]*class="product-buy"/);
assert.match(productStyles, /\.product-purchase\s*\{[^}]*display:\s*flex[^}]*gap:\s*24rpx[^}]*margin-top:\s*18rpx/s);
assert.match(productStyles, /button\.product-buy\s*\{[^}]*width:\s*132rpx\s*!important[^}]*min-height:\s*72rpx/s);
assert.doesNotMatch(products, /左右滑动查看/);
assert.doesNotMatch(productStyles, /\.products-swipe-hint/);
assert.doesNotMatch(home, /home-product-banner/);
assert.doesNotMatch(homeStyles, /\.home-product-banner/);
assert.match(productScript, /onShow\(\)\s*\{\s*showFriendShareMenu\(\)/s);
assert.match(productDetailScript, /onShow\(\)\s*\{\s*showFriendShareMenu\(\)/s);

assert.match(productDetail, /商品暂不可见/);
assert.match(productDetail, /bindtap="openProducts">查看全部产品/);
assert.match(productDetail, /bindtap="goHome">返回首页/);
assert.match(productDetail, /detail-state" role="alert"/);
assert.match(productDetailStyles, /\.detail-state\s*\{[^}]*align-content:\s*start/s);

assert.match(health, /item\.latest \? '可回测' : '未开始'/);
assert.match(health, /health-state" role="status" aria-live="polite"/);
assert.match(history, /role="tab"\s+aria-selected=/);
assert.match(history, /role="checkbox" aria-checked=/);
assert.match(compare, /compare-state" role="status" aria-live="polite"/);
assert.match(result, /result-state" role="alert"/);
assert.match(assessment, /bindtap="previewBristol"/);
assert.match(assessmentScript, /wx\.previewImage/);
assert.match(campaign, /root-with-you__image-skeleton/);
assert.match(campaign, /src="\{\{imageUrl\}\}"/);
assert.match(campaign, /lazy-load="\{\{false\}\}"/);
assert.match(campaign, /fade-show="\{\{false\}\}"/);
assert.match(campaignScript, /\/subpkg\/campaign\/assets\/root-with-you-intro\.jpg/);
assert.doesNotMatch(campaignScript, /cloud:\/\//);
assert.match(campaignScript, /FIXED_GUT_ASSESSMENT_PATH/);
assert.match(campaignScript, /GUT_ASSESSMENT_CONTINUE_PATH/);
assert.doesNotMatch(campaignScript, /rememberContinuation/);
assert.doesNotMatch(
  JSON.stringify(appConfig.preloadRule?.["pages/home/index"]?.packages || []),
  /subpkg\/campaign/,
  "首页不得预加载包含高清长图的 campaign 分包"
);
assert.match(campaignStyles, /root-with-you-breathe/);
assert.match(campaignStyles, /prefers-reduced-motion/);
assert.match(homeStyles, /prefers-reduced-motion/);
assert.match(home, /home-slide__copy--\{\{item\.copyVariant/);
assert.match(homeStyles, /home-slide__copy--foundation-single/);
assert.match(homeStyles, /home-slide__copy--campaign-split/);
assert.match(homeStyles, /home-slide__copy--campaign-split \.home-slide__line--secondary \{ font-size: 36rpx;/);
assert.match(result, /result-action-list/);
assert.match(activityScript, /track\("activity_signup"/);
assert.doesNotMatch(result, /内测记录/);
assert.match(channelError, /role="alert"/);

console.log("p2 polish tests passed");
