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
const privacyWxml = read("subpkg/profile/pages/privacy-account/index.wxml");
const privacyWxss = read("subpkg/profile/pages/privacy-account/index.wxss");
const privacyScript = read("subpkg/profile/pages/privacy-account/index.js");
const legalScript = read("pages/legal/index.js");
const registerScript = read("pages/register/index.js");

matches(profileWxss, /profile-page__title\s*\{[^}]*top:\s*78px[^}]*left:\s*20px/s, "MY-01/02 标题坐标");
matches(profileWxss, /profile-identity\s*\{[^}]*top:\s*130px[^}]*width:\s*calc\(100% - 40px\)[^}]*height:\s*72px/s, "身份区坐标与宽屏边距");
matches(profileWxss, /profile-card\s*\{[^}]*left:\s*20px[^}]*width:\s*calc\(100% - 40px\)/s, "会员卡片保持双侧 20px 边距");
matches(profileWxss, /profile-login\s*\{[^}]*top:\s*226px[^}]*left:\s*20px[^}]*height:\s*52px/s, "访客登录按钮坐标");
matches(profileWxml, /style="width: 350px;" bindtap="openLogin"/, "原生按钮宽度必须显式固定");
matches(profileWxss, /content--guest \.profile-card--member\s*\{[^}]*top:\s*306px[^}]*height:\s*128px/s, "访客会员入口坐标");
matches(profileWxss, /content--member \.profile-card--support\s*\{[^}]*top:\s*382px[^}]*height:\s*176px/s, "会员菜单坐标");
matches(profileWxss, /profile-row__hint\s*\{[^}]*width:\s*96px[^}]*text-align:\s*right/s, "入口提示统一右对齐");
matches(profileWxss, /profile-row__arrow\s*\{[^}]*width:\s*4px[^}]*height:\s*8px/s, "跳转标识弱化统一");
matches(profileWxss, /profile-member-failure\s*\{[^}]*top:\s*374px[^}]*height:\s*100px/s, "MY-03 失败卡坐标");
matches(profileWxml, /暂时无法打开 Root 会员中心/, "会员中心失败状态真实呈现");
matches(profileScript, /ROOT_PROFILE_MEMBER_TARGET_V1/, "登录前保存会员中心目标");
matches(profileScript, /success:[\s\S]*memberLinkFailure:\s*false/, "成功后清除失败状态");
matches(profileScript, /fail:[\s\S]*memberLinkFailure:\s*true/, "跳转失败保留当前页面");
matches(profileScript, /clearTransientHealthData\(\)/, "退出登录清除内存健康状态");
matches(profileScript, /ROOT4U_INITIAL_SUBMIT_KEY_V1/, "退出登录清除健康提交键");
excludes(profileWxml, /会员等级|积分|余额/, "不得恢复会员资产摘要");

matches(aboutWxml, /<page-navigation show-home="\{\{false\}\}"/, "关于页复用统一返回控件");
matches(aboutWxss, /about-page__title\s*\{[^}]*top:\s*130px/s, "MY-04 标题坐标");
matches(aboutWxss, /about-page__wordmark\s*\{[^}]*top:\s*210px[^}]*width:\s*126px[^}]*height:\s*33px/s, "文字 Logo 坐标");
matches(aboutWxml, /人如草木，根定而生。/, "品牌核心文案");
matches(aboutWxss, /about-page__links\s*\{[^}]*top:\s*530px[^}]*height:\s*200px/s, "关于页链接区坐标");
matches(aboutWxss, /about-page__links\s*\{[^}]*width:\s*calc\(100% - 40px\)/s, "关于页保持双侧 20px 边距");

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
