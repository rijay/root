# myRoot 0.7.0 CloudBase UnionID Gate

日期：2026-08-28  
环境：`myroot-prod-d5gl3gzg7115f149a / myroot-api`  
范围：微信开发者工具运行态只读探针；未登录、未创建用户、未修改业务数据

## 现场结果

1. `GET /health` 经 `wx.cloud.callContainer` 返回 HTTP 200、业务码 0，CloudBase 到 `myroot-api` 的调用通道正常。
2. 不带后台口令访问身份探针返回 HTTP 401、业务码 40101，符合生产后台鉴权要求。
3. 经明确授权，以一次性隐藏输入的后台口令执行 `GET /api/v1/admin/cloudbase-identity-probe?appCode=MYROOT`：HTTP 200、业务码 0，但身份状态为 `BLOCKED`，`source=UNVERIFIED_TRANSPORT`，`openidPresent=false`、`unionidPresent=false`、`readyForUnionPrimaryKey=false`。
4. 上述 false 不表示测试会员没有 UnionID；请求已到达后端，但当前稳定版启动组合未注入 `trustedWechatIdentityAdapter`，原始 CloudBase Header 按安全设计不能直接升级为可信身份。
5. 本次只保留状态与布尔值；后台口令、OpenID、UnionID、手机号、有赞账号标识和原始响应均未写入文件、Git 或日志证据。

## 本地修复

1. 新增 CloudBase 可信微信身份 Adapter，并在服务启动时注入现有 `trustedWechatIdentityAdapter` Seam。
2. Adapter 仅在同时配置 CloudBase 环境 ID 与微信 AppID 时启用。
3. 只有 `X-WX-ENV`、`X-WX-APPID`、`X-WX-SOURCE`、`X-WX-PLATFORM` 与生产配置及官方来源/平台组合匹配时，才接受平台注入的 openid/unionid。
4. 普通公网请求、配置缺失、环境或 AppID 不匹配、来源/平台组合异常、缺少 openid，以及资源复用身份头均 fail-close。
5. 腾讯云官方资料说明 CloudBase SDK 调用会自动携带小程序身份与环境 Header，并将平台自动注入 openid 用于避免前端伪造：
   - <https://docs.cloudbase.net/anyservice/usage>
   - <https://docs.cloudbase.net/mp-skill/recipe-5-payment>

## 验证

- 定向身份与服务测试：21/21 PASS。
- Backend 全量回归：669 PASS / 4 SKIP / 0 FAIL；4 个 SKIP 为既有真实 MySQL 条件分支。
- 根级 `npm run verify`：6/6 PASS。
- `git diff --check`：PASS。

## 尚未关闭的 Gate

本地代码和测试通过不等于生产身份打通。当前生产稳定版仍为 `BLOCKED`；下一步必须先形成独立候选部署授权与回滚方案，再在候选流量中复测同一只读探针。只有候选实际返回 `READY`、`unionidPresent=true`、`readyForUnionPrimaryKey=true` 后，才可继续测试会员的有赞订单/优惠券摘要，不得提前记录为通过。
