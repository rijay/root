# ROOT 7日打卡小程序部署说明

## 1. 后端上线

1. 在微信云托管里选择 Express.js 模板创建服务，或复用已有 `express-x7te` 服务。
2. 不要继续使用 `WeixinCloud/wxcloudrun-express` 示例仓库；需要把服务代码源替换为本项目的 `root_seven_day_checkin/backend`。
3. `backend/` 已包含云托管可用的 `Dockerfile`，容器默认监听 `80` 端口。
4. 在云托管服务配置里设置：

```bash
PORT=80
WECHAT_APPID=正式小程序 AppID
WECHAT_APPSECRET=正式小程序 AppSecret
ROOT_PUBLIC_BASE_URL=https://express-x7te-258599-9-1404419431.sh.run.tcloudbase.com
ROOT_SQLITE_FILE=/tmp/root-checkin.sqlite
```

`ROOT_SQLITE_FILE=/tmp/root-checkin.sqlite` 只适合云托管冒烟和小范围体验；容器重启或多实例扩缩容可能导致数据丢失。正式生产需要把 Store Module 的 Adapter 切到云托管配套 MySQL 或其他可备份、可迁移、可审计的 Implementation。

5. 在微信云托管控制台打开该服务的云调用/开放接口服务能力，并放行 `wxa/business/getuserphonenumber`。正式小程序手机号快捷登录依赖这个开放接口；服务端会优先使用 `wx.cloud.callContainer` 注入的 `x-wx-openid` 和云托管开放接口取手机号，AppSecret 直连只作为本地或非云托管 Adapter 的兜底路径。
6. 如果普通用户仍偶发 `cloud.callContainer:fail timeout`，在云托管服务配置里把最小实例数设置为 1，或确保小程序端已发布包含 45 秒登录超时的版本；云托管从 0 实例冷启动时可能超过 10 秒。
7. 部署完成后访问 `https://express-x7te-258599-9-1404419431.sh.run.tcloudbase.com/health`，确认返回 `{"code":0}`。
8. 访问 `https://express-x7te-258599-9-1404419431.sh.run.tcloudbase.com/`，确认后台页面可打开。
9. 再执行 `npm run calibrate -- --base-url https://express-x7te-258599-9-1404419431.sh.run.tcloudbase.com --target gray`，确认发布记录能返回 ROOT 后端状态。

## 2. 小程序改正式接口

打开 `miniprogram/config/env.js`，把：

```js
const productionApiBaseUrl = "https://api.example.com";
```

改成你的正式接口域名，例如：

```js
const productionApiBaseUrl = "https://express-x7te-258599-9-1404419431.sh.run.tcloudbase.com";
```

开发版仍会访问 `http://127.0.0.1:8787`；体验版和正式版会访问 `productionApiBaseUrl`。

## 3. 微信公众平台配置

在微信公众平台进入小程序后台：

1. 开发管理 -> 开发设置 -> 服务器域名。
2. 在 `request 合法域名` 添加正式接口域名，例如 `https://api.your-domain.com`。
3. 如果后续启用图片上传/下载，再分别配置 `uploadFile 合法域名` 和 `downloadFile 合法域名`。
4. 确认域名是 HTTPS，不使用 IP、localhost、127.0.0.1 或带端口的地址。

## 4. 上传、体验、审核、发布

1. 用微信开发者工具打开 `miniprogram` 目录。
2. 确认右上角账号是该小程序管理员或开发者。
3. 点击“上传”，填写版本号和备注。
4. 到微信公众平台 -> 版本管理，把开发版本设为体验版，先用真机完整走一遍登录、画像、订单匹配、物流等待、Day1 启动、Day4 问卷、Day6 优惠券、Day8 问卷、免单申请。
5. 确认无误后提交审核。
6. 审核通过后，在版本管理中点击发布。

## 5. 发布前检查

- `miniprogram/config/env.js` 的 `productionApiBaseUrl` 已替换。
- 微信公众平台已配置 `request 合法域名`。
- 后端 HTTPS 证书有效，`/health` 可访问。
- 后端已配置 `WECHAT_APPID` 和 `WECHAT_APPSECRET`。
- 云托管开放接口服务已放行 `wxa/business/getuserphonenumber`，手机号快捷登录真机可用。
- 小程序发布包不包含开发调试登录入口，后端未启用直接手机号登录测试开关。
- 生产数据已接入 SQLite、PostgreSQL 或 MySQL 等正式数据仓库 Adapter；如使用 `ROOT_STORE_FILE`，仅作为内部灰度。
- 已按 `docs/release_readiness.md` 跑完最小手工验收矩阵。
- 有赞订单、物流、企业微信 Adapter 字段已用真实样本核对。

官方参考：

- 微信小程序网络能力文档：https://developers.weixin.qq.com/miniprogram/dev/framework/ability/network.html
- 微信开发者工具 CI/上传文档：https://developers.weixin.qq.com/miniprogram/dev/devtools/ci.html
- 获取手机号接口文档：https://developers.weixin.qq.com/miniprogram/dev/api/open-api/phonenumber/wx.getPhoneNumber.html
