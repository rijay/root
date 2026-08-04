# myRoot 小程序性能 R0 证据说明

> 状态：性能预算与测量基础已建立；当前旧产品数据只能作为非正式基线。

## 基础库

- 最低基础库：`2.32.3`。正式登录旅程使用的 `wx.requirePrivacyAuthorize` 从该版本开始支持。
- 验收稳定版本：`3.15.2`，与 `miniprogram/project.config.json` 一致。
- 被最低版本覆盖的其他能力：`wx.getPerformance` `2.11.0`、按需注入 `2.11.1`、`chooseAvatar` `2.21.2`。

来源为微信开放文档：

- <https://developers.weixin.qq.com/miniprogram/dev/api/open-api/privacy/wx.requirePrivacyAuthorize.html>
- <https://developers.weixin.qq.com/miniprogram/dev/api/base/performance/wx.getPerformance.html>
- <https://developers.weixin.qq.com/miniprogram/dev/framework/ability/lazyload.html>
- <https://developers.weixin.qq.com/miniprogram/dev/component/button.html>

## 本地命令

```bash
node miniprogram/scripts/performance-budget.test.js
node miniprogram/scripts/performance-monitor.test.js
node miniprogram/scripts/request.test.js
node --test backend/tests/performance_metrics_module.test.js
node scripts/miniprogram-performance-report.js --legacy
```

`--legacy` 只读取本地源码、分包和素材体积并输出 `LEGACY_NON_FORMAL_BASELINE`。它不会连接生产环境、写数据库、上传微信版本或生成正式上线 Gate 的通过结论。

`npm run evidence:local:write` 会生成当前正式范围的本地源码包体快照 `package-budget.json`，并把尚未取得的真机证据写成明确的 `BLOCK` 状态；`npm run evidence:local:check` 用于防止快照与当前代码漂移。

候选版本阶段使用 `--candidate --events <events.json>`。每个核心旅程必须包含版本、平台、系统、微信版本、基础库、设备档位、网络、入口、代码包状态、至少 30 次样本、P75、P95 和差异结论；同时必须用微信构建产物报告交叉验证本地源码体积估算。

## 隐私与运行规则

- 允许字段仅用于技术性能，不接收手机号、昵称、头像、微信身份原值、健康答案、健康结论或会员资产。
- 开发版、体验版和候选版本按 100% 采样；正式环境普通事件默认 10%，关键失败与内存告警 100%。
- 正式环境上报默认关闭，启用属于发布动作，需要单独批准。
- 接收端只写结构化技术日志，不增加性能业务表。
- 监测关闭、采样丢弃或上报失败不得阻塞用户旅程。

## 尚未关闭的 Gate

- 当前包体是本地源码估算，不是微信构建产物体积。
- 尚无 iOS/Android 真机 30 次样本、P75/P95、弱网、帧率和内存证据。
- 尚未证明结构化日志路径可支持正式发布后 72 小时观察。
- 因此当前证据不能用于声称新产品已满足正式上线性能 Gate。
