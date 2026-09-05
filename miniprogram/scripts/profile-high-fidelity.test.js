const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
let checks = 0;
function matches(source, pattern, message) {
  assert.match(source, pattern, message);
  checks += 1;
}
function excludes(source, pattern, message) {
  assert.doesNotMatch(source, pattern, message);
  checks += 1;
}

const profileWxml = read("pages/profile/index.wxml");
const profileWxss = read("pages/profile/index.wxss");
const profileScript = read("pages/profile/index.js");
const aboutWxml = read("subpkg/profile/pages/about/index.wxml");
const aboutWxss = read("subpkg/profile/pages/about/index.wxss");
const supportWxml = read("subpkg/profile/pages/support/index.wxml");
const supportWxss = read("subpkg/profile/pages/support/index.wxss");
const privacyWxml = read("subpkg/profile/pages/privacy-account/index.wxml");
const privacyWxss = read("subpkg/profile/pages/privacy-account/index.wxss");
const privacyScript = read("subpkg/profile/pages/privacy-account/index.js");
const legalScript = read("pages/legal/index.js");
const registerScript = read("pages/register/index.js");
const registerWxml = read("pages/register/index.wxml");

matches(profileWxss, /profile-page__content\s*\{[^}]*padding:\s*78px 20px/s, "MY-01/02 页面保持顶部与双侧安全间距");
matches(profileWxss, /profile-page__title\s*\{[^}]*display:\s*block[^}]*font-size:\s*30px/s, "标题层级");
matches(profileWxss, /profile-identity\s*\{[^}]*width:\s*100%[^}]*height:\s*72px[^}]*margin-top:\s*14px/s, "身份区使用自然流布局");
matches(profileWxss, /profile-card\s*\{[^}]*display:\s*flex[^}]*width:\s*100%[^}]*gap:\s*8px/s, "会员与支持菜单使用分组间距");
matches(profileWxss, /profile-login\s*\{[^}]*height:\s*52px[^}]*margin:\s*24px 0 0\s*!important/s, "访客登录按钮间距");
matches(profileWxml, /style="width: 350px;" bindtap="openLogin"/, "原生按钮宽度必须显式固定");
matches(profileWxss, /content--guest \.profile-card--member\s*\{[^}]*margin-top:\s*20px/s, "访客会员入口间距");
matches(profileWxss, /content--member \.profile-card--support\s*\{[^}]*margin-top:\s*16px/s, "会员菜单间距");
matches(profileWxss, /profile-row\s*\{[^}]*background:\s*var\(--color-ui-grouped\)[^}]*border-radius:\s*12px/s, "菜单行使用独立圆角面板");
excludes(profileWxss, /profile-row\s*\{[^}]*border-bottom:/s, "菜单行不使用贯穿式分隔线");
matches(profileWxss, /profile-row__hint\s*\{[^}]*width:\s*96px[^}]*text-align:\s*right/s, "入口提示统一右对齐");
matches(profileWxss, /profile-row__arrow\s*\{[^}]*width:\s*7px[^}]*height:\s*7px/s, "跳转标识弱化统一");
matches(profileWxss, /profile-member-failure\s*\{[^}]*position:\s*relative[^}]*min-height:\s*100px[^}]*margin-top:\s*16px/s, "MY-03 失败卡保持自然流间距");
matches(profileWxml, /暂时无法打开 Root 会员中心/, "会员中心失败状态真实呈现");
matches(profileScript, /ROOT_PROFILE_MEMBER_TARGET_V1/, "登录前保存会员中心目标");
matches(profileScript, /navigateToMiniProgram\(\{[\s\S]*shortLink,/s, "订单与优惠券通过正式短链接进入会员中心");
excludes(profileScript, /rootMemberCenterOrdersPath|rootMemberCenterCouponsPath/, "不得把微信短链接当作内部页面路径");
matches(profileScript, /success:[\s\S]*memberLinkFailure:\s*false/, "成功后清除失败状态");
matches(profileScript, /fail:[\s\S]*memberLinkFailure:\s*true/, "跳转失败保留当前页面");
excludes(profileWxml, /退出登录/, "我的首页不再放置退出登录按钮");
matches(registerWxml, /保存资料<\/button>\s*<button wx:if="\{\{editing\}\}" class="register-page__logout"[^>]*>退出登录<\/button>/s, "退出登录紧跟编辑资料保存按钮");
matches(registerScript, /clearTransientHealthData\(\)/, "退出登录清除内存健康状态");
excludes(registerScript, /ROOT4U_INITIAL_SUBMIT_KEY_V1|ROOT4U_START_PENDING_V1/, "退出登录不再维护已下线健康提交键");
matches(registerScript, /clearToken\(\)/, "退出登录清除登录态和资料缓存");
matches(registerScript, /clearSessionPageCache\(\)/, "退出登录清除会话页面缓存");
matches(registerScript, /router\.go\("\/pages\/profile\/index"\)/, "退出后返回我的首页");
excludes(profileWxml, /会员等级|积分|余额/, "不得恢复会员资产摘要");

matches(aboutWxml, /<page-navigation show-home="\{\{false\}\}"/, "关于页复用统一返回控件");
matches(aboutWxss, /about-page__title\s*\{[^}]*top:\s*130px/s, "MY-04 标题坐标");
matches(aboutWxss, /about-page__wordmark\s*\{[^}]*top:\s*210px[^}]*width:\s*126px[^}]*height:\s*33px/s, "文字 Logo 坐标");
matches(aboutWxml, /人如草木，根定而生。/, "品牌核心文案");
matches(aboutWxml, /bindtap="openPhggReference"/, "关于页提供 PHGG 科学档案入口");
matches(aboutWxml, /ROOT 核心原料 PHGG 科学参考文献集/, "PHGG 入口使用完整科学参考文献集标题");
matches(aboutWxss, /about-page__links\s*\{[^}]*top:\s*520px[^}]*height:\s*230px/s, "关于页链接区坐标");
matches(aboutWxss, /about-page__row\s*\{[^}]*height:\s*46px/s, "五个关于页入口保持可点击高度");
matches(aboutWxss, /about-page__links\s*\{[^}]*width:\s*calc\(100% - 40px\)/s, "关于页保持双侧 20px 边距");
matches(supportWxml, /support-page__contact[^>]*style="width:\s*100%;\s*margin:\s*64rpx 0 0;"[\s\S]*bindtap="openWeComCustomerService"/s, "企微客服按钮显式占满内容区");
matches(supportWxml, /open-type="contact"[\s\S]*bindcontact="onNativeContact"/s, "企微客服失败后保留微信客服降级入口");
matches(supportWxss, /support-page__contact\s*\{[^}]*width:\s*100%[^}]*margin:\s*64rpx 0 0[^}]*box-sizing:\s*border-box/s, "客服与反馈按钮占满内容区且不受原生按钮外边距影响");

matches(privacyWxml, /个人信息收集清单/, "隐私清单入口");
matches(privacyWxml, /第三方信息共享清单/, "第三方清单入口");
matches(privacyWxss, /privacy-account-page__title\s*\{[^}]*top:\s*130px/s, "MY-05 标题坐标");
matches(privacyWxss, /privacy-account-page__menu--privacy\s*\{[^}]*top:\s*292px[^}]*height:\s*172px/s, "隐私菜单坐标");
matches(privacyWxss, /privacy-account-page__account\s*\{[^}]*top:\s*534px[^}]*height:\s*94px/s, "注销入口坐标");
matches(privacyWxss, /cancellation-sheet\s*\{[^}]*bottom:\s*0[^}]*height:\s*596px/s, "MY-06 确认弹层底部定位");
matches(privacyWxss, /cancellation-sheet\s*\{[^}]*width:\s*100%/s, "注销弹层适配宽屏");
matches(privacyWxss, /cancellation-sheet__keep\s*\{[^}]*top:\s*442px[^}]*height:\s*50px/s, "保留账号主按钮坐标");
matches(privacyWxss, /cancellation-sheet__submit\s*\{[^}]*top:\s*502px[^}]*height:\s*46px/s, "注销提交按钮坐标");
matches(privacyScript, /请联系客服完成注销/, "未冻结受理规则时不得伪造提交成功");
excludes(privacyScript, /request\([\s\S]*delet|request\([\s\S]*cancel/i, "不得调用不存在的注销受理入口");

matches(legalScript, /collection:\s*\{/, "个人信息收集清单有对应内容");
matches(legalScript, /sharing:\s*\{/, "第三方共享清单有对应内容");
excludes(legalScript, /打卡|任务进度|奖励资格|自动向你发送营销消息/, "法律说明不保留旧活动任务叙事");
matches(registerScript, /options\.mode === "edit"/, "登录用户可进入资料编辑模式");
matches(registerScript, /资料已更新/, "资料编辑保存反馈");

console.log(`profile high-fidelity contract: ${checks}/${checks} PASS`);
