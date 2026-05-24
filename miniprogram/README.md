# ROOT 7日身体重启小程序

原生微信小程序实现，页面路径按 PRD V2.1 调整。底部仅保留「首页 / 我的」两个 Tab，`pages/home/index` 是智能首页容器，会读取 `/api/v1/user/state` 并直接渲染登录、注册、活动、首程打卡、完成态或日常打卡视图。

## 页面

- `/pages/home/index` 智能首页容器，按用户状态渲染登录/问卷/活动/打卡/日常打卡
- `/pages/order/match` 有赞订单匹配
- `/subpkg/checkin/pages/today/index` 今日打卡填写
- `/subpkg/checkin/pages/history/index` 历史记录
- `/subpkg/checkin/pages/result/index` 完成结果
- `/subpkg/refund/pages/apply/index` 免单申请
- `/subpkg/refund/pages/status/index` 免单状态
- `/pages/profile/index` 个人中心
- `/subpkg/profile/pages/tags/index` 健康画像
- `/subpkg/profile/pages/orders/index` 我的订单
- `/subpkg/profile/pages/about/index` 关于我们
- `/subpkg/profile/pages/support/index` 联系客服

## 配置

接口地址和云托管调用信息在 `config/env.js`：

```js
const productionApiBaseUrl = "https://express-x7te-258599-9-1404419431.sh.run.tcloudbase.com";
const cloudEnvId = "prod-d3grtjkva76c93e00";
const cloudServiceName = "express-x7te";
```

开发版会自动使用 `http://127.0.0.1:8787` 直连本地后台，方便调试。体验版和正式版会自动使用 `wx.cloud.callContainer` 调用微信云托管，不需要单独配置 request 合法域名；登录链路统一使用微信手机号授权。

## 调试排错

如果微信开发者工具提示「模拟器启动失败」或只显示 `[] [object Object]`，先按下面顺序处理：

1. 在微信开发者工具右上角重新登录当前小程序开发者账号。
2. 关闭或调整系统/工具代理，确保 `https://servicewechat.com` 可以被开发者工具正常访问。
3. 在开发者工具里执行「工具 -> 清缓存 -> 清除全部缓存」，然后重新打开 `miniprogram` 目录。
4. 确认详情里的基础库版本为 `3.15.2`，本机已缓存该版本基础库。

本机日志里对应的真实错误是 `EPROTO wrong version number` 和 `access_token missing`，属于开发者工具请求微信服务端失败，不是小程序页面代码的运行时报错。
