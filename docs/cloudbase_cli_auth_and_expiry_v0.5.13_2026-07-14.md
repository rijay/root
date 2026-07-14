# CloudBase CLI 身份与环境到期回读

日期：2026-07-14

状态：`CLOUDBASE_CLI_AUTH_PASS / WECHAT_DEVTOOLS_CLI_AUTH_PASS / ENV_NORMAL / AUTO_RENEW_ON / BILLING_ASSURANCE_OWNER_CONFIRMED / NO_CLOUD_WRITE`

## 1. 实际读取来源

1. CloudBase CLI 3.5.7 的 `cloudbase login --flow web` 登录状态回读。
2. 同一完整权限会话中的只读 `cloudbase env:list`。
3. 微信开发者工具 CLI 的只读 `islogin`。
4. CloudBase CLI 的只读通用调用 `TCB.DescribeBillingInfo`；只输出套餐、付费模式、自动续费、状态与到期时间。
5. 腾讯云官方 `DescribeBillingInfo` 数据结构、CloudBase 套餐续费与价格说明。

## 2. 回读结果

1. CloudBase CLI 返回已登录，不需要重复授权。
2. CLI 可见生产环境 `myroot-prod-d5gl3gzg7115f149a`，来源为 CloudBase，套餐为标准版，状态为 `Normal`。
3. 环境创建时间为 `2026-06-23 17:21:31`，到期时间为 `2026-07-23 23:59:59`。
4. 微信开发者工具 CLI 初次返回 `login=false`；新的官方登录二维码完成扫码后，独立 `islogin` 回读为 `login=true`。
5. 本轮没有选择环境、更新变量、下载或部署 Function、上传小程序、修改套餐或执行续费。
6. `DescribeBillingInfo` 返回 `PackageId=baas_pf_standard / IsAutoRenew=true / Status=NORMAL / PayMode=PREPAYMENT / ExpireTime=2026-07-23 23:59:59 / IsAlwaysFree=false`。
7. 行动时刷新再次回读环境、计费、两个 Function、CloudRun 发布单与微信开发者工具登录态：环境和计费字段未漂移，`islogin=true`；两个 Function 仍为 `Active / Available`、10+1 个启用触发器、六项变量精确相等且 `ROOT_JOB_DRY_RUN=true`，云端修改时间未变化。
8. CloudRun 发布单仍为 `myroot-api-012 -> myroot-api-027 / URL_PARAMS / flowRatio=0 / gray success`。15 次无参数 `/health` 均为 HTTP 200、业务码 0 且未出现 027 候选元数据；`/ready` 继续证明 MySQL 已连接、迁移版本为 `005_notification_subscription_grants.sql`。
9. 本轮 CLI JSON 只保存在 `/private/tmp`，其中可能含环境变量值的 Function 与 CloudRun 详情文件已回读为权限 `0600`。没有把变量值、路由值、Admin token 或用户数据写入仓库或对话。
10. 费用中心 `DescribeAccountBalance` 只读调用因当前 CLI 身份缺少 `finance:trade` 权限而失败，没有返回余额、UIN 或支付信息。项目负责人随后明确确认腾讯云及其他项目费用不构成上线风险，因此计费保障 Gate 以负责人确认关闭；不再申请费用权限，不创建告警，也不执行手工续费。

## 3. 结论

CloudBase CLI 与微信开发者工具 CLI 身份均已恢复，生产稳定流量和 027 候选也没有漂移。自动续费已开启，项目负责人已明确确认费用保障，因此计费不再阻塞正式灰度。当前 CLI 不能独立读取账户余额，这一证据限制保留在记录中；手工提前续费仍属于账户与计费写动作，本轮不执行，也不能由部署动作隐式代替。

官方依据：

1. <https://cloud.tencent.com/document/product/876/128590>：续费 Interface 会自动下单并支付，默认周期 1 个月。
2. <https://cloud.tencent.com/document/product/876/46895>：CloudBase 付费环境采用包年包月预付费，可在环境资源购买页续费。
3. <https://cloud.tencent.com/document/api/876/34822>：`DescribeBillingInfo` 的 `IsAutoRenew`、`PayMode` 与 `ExpireTime` 字段定义。
