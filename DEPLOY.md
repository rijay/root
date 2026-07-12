# ROOT 7日打卡小程序部署说明

## 1. 后端上线

1. 腾讯云 CloudBase 环境使用 `myroot-prod-d5gl3gzg7115f149a`，云托管名称统一为 `myroot-api`。本轮团队内测的 `develop`、`trial` 和 `release` 都调用这一环境；旧 `myroot-test-d4gclpzxx286deda6`、`express-i4c5` 和 `express-x7te` 不再承接本轮数据。
2. 不要继续使用 `WeixinCloud/wxcloudrun-express` 示例仓库；需要把服务代码源替换为本项目的 `root_seven_day_checkin/backend`。
3. `backend/` 已包含云托管可用的 `Dockerfile`，容器默认监听 `80` 端口。
4. 在云托管服务配置里设置环境变量。内测环境和正式环境复用同一套后端 Interface，差异只放在 CloudBase 环境、Store Adapter 和 secret 中：

```bash
PORT=80
WECHAT_APPID=wx7727a02565aed1c2
WECHAT_APPSECRET=<myRoot 小程序 AppSecret>
ROOT_PUBLIC_BASE_URL=https://myroot-api-273748-8-1437260454.sh.run.tcloudbase.com
ROOT_ADMIN_TOKEN=后台访问口令
ROOT_JOB_BASE_URL=https://myroot-api-273748-8-1437260454.sh.run.tcloudbase.com
ROOT_ADMIN_JOB_TOKEN=定时任务专用后台口令
ROOT_REQUIRE_HEALTH_CONSENT=true
ROOT_PRIVACY_CONTROLLER_NAME=杭州连生健康科技有限公司
ROOT_PRIVACY_CONTACT=hydennis@foxmail.com
ROOT_HEALTH_DATA_RETENTION_DAYS=180
ROOT_HEALTH_DATA_RETENTION_CLEANUP_ENABLED=true
ROOT_HEALTH_DATA_RETENTION_CLEANUP_LIMIT=50
ROOT_CHECKIN_REMINDER_ENABLED=true
ROOT_CHECKIN_REMINDER_TEMPLATE_ID=SOABCc3dk6tItVnjglFc94X6FVQo4LuZvnoZlHJTaBc
ROOT_CHECKIN_REMINDER_TEMPLATE_VERSION=v2026-06-28-tpl10850
ROOT_CHECKIN_REMINDER_HOUR=9
ROOT_CHECKIN_REMINDER_PAGE=pages/tasks/index
ROOT_CHECKIN_REMINDER_MINIPROGRAM_STATE=formal
ROOT_CHECKIN_REMINDER_TEMPLATE_TITLE=活动提醒
ROOT_CHECKIN_REMINDER_TEMPLATE_DATA_JSON='{"thing3":{"value":"{{campaignTitle}}"},"thing2":{"value":"{{actionText}}"},"thing1":{"value":"{{productName}}"}}'
ROOT_STORE_ADAPTER=mysql
MYSQL_ADDRESS=云托管 MySQL 地址
MYSQL_USERNAME=云托管 MySQL 用户名
MYSQL_PASSWORD=云托管 MySQL 密码
MYSQL_DATABASE=myroot-prod-d5gl3gzg7115f149a
MYSQL_CONNECTION_LIMIT=8
MYSQL_CONNECT_TIMEOUT_MS=10000
ROOT_ENFORCE_MYSQL_LEAST_PRIVILEGE=true
ROOT_CLOUDBASE_STORE_DECISION=MYSQL_ON_CLOUDBASE
ROOT_CLOUDBASE_ENV_ID=myroot-prod-d5gl3gzg7115f149a
ROOT_CLOUDBASE_REGION=ap-shanghai
ROOT_CLOUDBASE_STORE_BACKUP_PLAN=发布前快照+每日备份
ROOT_CLOUDBASE_STORE_ROLLBACK_PLAN=按发布前快照回滚
ROOT_CLOUDBASE_STORE_PROOF=生产证明引用
YOUZAN_CLIENT_ID=<有赞应用 client id>
YOUZAN_ORDER_LIST_URL=https://open.youzanyun.com/api/youzan.trades.sold.get/4.0.4
YOUZAN_CUSTOMER_LIST_URL=https://open.youzanyun.com/api/youzan.scrm.customer.list/1.0.0
YOUZAN_USER_QUERY_URL=https://open.youzanyun.com/api/youzan.users.info.query/1.0.1
YOUZAN_ACCESS_TOKEN=<有赞托管或刷新后的访问 token>
YOUZAN_ACCESS_TOKEN_EXPIRES_AT=<ISO 8601 到期时间，发布时至少剩余24小时>
YOUZAN_GRANT_ID=<ROOT 店铺 ID>
YOUZAN_TOKEN_MANAGEMENT_MODE=STATIC_ROTATION
YOUZAN_TOKEN_ROTATION_OWNER=<轮换负责人>
ROOT_YOUZAN_IDENTITY_RECONCILE_ENABLED=false
ROOT_YOUZAN_IDENTITY_RECONCILE_REFRESH_HOURS=168
```

`STATIC_ROTATION` 下，`YOUZAN_CLIENT_SECRET` 只在受控轮换终端或密码管理器中用于换取 token，不进入 CloudRun 运行容器；容器只持有调用所需的 access token、到期时间与非秘密轮换元数据。

本轮内测直接使用 CloudBase MySQL，不再以容器临时 SQLite 承接业务数据。小程序始终通过 `wx.cloud.callContainer -> myroot-api -> MySQL`，不允许直连数据库。Store Module 使用连接池、迁移锁、修订号行锁和事务内核心关系表同步；20 并发写、容器重启、双实例、跨实例幂等、结算奖励幂等和数据库恢复均已实测。生产启动还会读取 `SHOW GRANTS FOR CURRENT_USER()`：运行账号必须只在 `MYSQL_DATABASE` 上具备 `SELECT / INSERT / UPDATE / DELETE / CREATE / ALTER`，存在 `*.*` 数据权限、额外 schema 权限或 `GRANT OPTION` 时失败关闭。正式发布仍需关闭真实外部 Adapter、真机跳转、业务回滚和三方签字 Gate。

CloudBase 生产环境与 MySQL Store 决策见 `docs/cloudbase_mysql_store_decision.md`；该文件只记录占位变量、验证步骤和证明要求，真实 secret 仍只放 CloudBase 环境变量或密钥管理。

5. 在微信云托管控制台打开该服务的云调用/开放接口服务能力，并放行 `wxa/business/getuserphonenumber`。正式小程序手机号快捷登录依赖这个开放接口；服务端会优先使用 `wx.cloud.callContainer` 注入的 `x-wx-openid` 和云托管开放接口取手机号，AppSecret 直连只作为本地或非云托管 Adapter 的兜底路径。
6. 云托管最小实例数设为 1、最大实例数先设为 2；数据库关闭自动暂停，避免团队内测时容器和数据库双重冷启动。若后续并发持续增加，再依据连接池等待、事务耗时和数据库连接数调节，不直接放大实例数。
7. 从项目根目录构建 Element Plus Admin，并复制到 backend-only 部署上下文；否则 `/admin` 会回退旧静态后台：

```bash
npm run admin:build
npm run deploy:prepare-admin
```

8. 部署完成后访问 `/health` 和 `/ready`。前者确认进程存活，后者必须返回 `store.kind=mysql`、迁移版本 `004_external_evidence_minimization.sql` 和有效修订号。
9. 访问 `https://myroot-api-273748-8-1437260454.sh.run.tcloudbase.com/admin`，确认 Element Plus Admin 可打开；访问 `/admin/assets/*.js` 确认返回 200；访问 `/admin-legacy` 确认旧静态后台回退页可打开。内测环境同样以控制台展示的 `myroot-test` 服务域名为准。
10. 执行 `npm run production-env --prefix backend -- --target production`，确认生产环境变量矩阵已列出所有缺失项和负责人。
11. 再执行 `npm run calibrate -- --base-url https://myroot-api-273748-8-1437260454.sh.run.tcloudbase.com --target gray`，确认发布记录能返回 ROOT 后端状态。内测环境改用控制台展示的 `myroot-test` 服务域名。
12. 执行 `npm run jobs:manifest --prefix backend -- --base-url https://myroot-api-273748-8-1437260454.sh.run.tcloudbase.com --strict`，确认 CloudBase 定时 Job 的频率、命令和环境变量清单为 `PASS`。内测环境先只生成 Manifest，不开启 execute。
13. 微信开放平台认证和应用绑定完成后，通过真实 CloudBase 请求访问 `GET /api/v1/admin/cloudbase-identity-probe`，确认返回 `READY`；本地 curl 只能验证路由形状，真实 openid/unionid 必须由 CloudBase 注入，发布记录只保留脱敏预览。

## 1.1 CloudBase 定时 Job

上线前先生成发布 Manifest：

```bash
npm run jobs:manifest --prefix backend -- --base-url https://myroot-api-273748-8-1437260454.sh.run.tcloudbase.com --campaign ROOT_7D_RESET --strict
```

Manifest 当前包含 11 个 Job：

1. `adapter_retry_due`：每 10 分钟执行一次，调用 `POST /api/v1/jobs/adapter-retry-due`。
2. `operational_alerts`：每 30 分钟执行一次，调用 `POST /api/v1/jobs/operational-alerts`。
3. `checkin_reminders`：每 10 分钟执行一次，调用 `POST /api/v1/jobs/checkin-reminders`。
4. `wework_touch_due`：每 10 分钟执行一次，调用 `POST /api/v1/jobs/wework-touch-due`。
5. `lifecycle_settlement_due`：每 15 分钟执行一次，调用 `POST /api/v1/jobs/lifecycle-settlement-due`。
6. `lifecycle_settlement_cleanup`：每小时执行一次，调用 `POST /api/v1/jobs/lifecycle-settlement-cleanup`。
7. `lifecycle_users_export`：每天上午执行一次，调用 `POST /api/v1/jobs/lifecycle-users-export`。
8. `lifecycle_user_exports_delivery_retry`：每 20 分钟执行一次，调用 `POST /api/v1/jobs/lifecycle-user-exports-delivery-retry`。
9. `lifecycle_user_exports_cleanup`：每天凌晨执行一次，调用 `POST /api/v1/jobs/lifecycle-user-exports-cleanup`。
10. `health_data_retention_cleanup`：每天凌晨 04:15 执行一次，调用 `POST /api/v1/jobs/health-data-retention-cleanup`；默认 dry-run，正式执行前必须完成隐私主体、联系方式、保存天数和清理开关配置。
11. `youzan_identity_reconcile`：每小时第 25 分钟执行一次，调用 `POST /api/v1/jobs/youzan-identity-reconcile`；默认每轮最多 5 个 UnionID，成功身份每 168 小时复核一次；重复 Root 归属、缺失用户桥接或已有 `yz_open_id` 归属冲突只创建待办，不自动改绑。

CloudBase 控制台配置时必须注入：

```bash
ROOT_JOB_BASE_URL=https://myroot-api-273748-8-1437260454.sh.run.tcloudbase.com
ROOT_ADMIN_JOB_TOKEN=定时任务专用后台口令
ROOT_ALERT_CAMPAIGN_ID=ROOT_7D_RESET
```

提醒模板、微信凭据和发送状态只配置在 CloudRun `myroot-api`；Cloud Function 仅以 Job token 调用后端，不重复保存这些值。

仓库已提供共享代码目录 `cloudfunctions/myroot-job-dispatcher` 与根目录 `cloudbaserc.json`。CloudBase 单函数最多 10 个定时触发器，因此生产拓扑拆为 `myroot-job-dispatcher` 10 个触发器和 `myroot-health-retention` 1 个健康数据清理触发器，合计覆盖 11 个 Job；两个函数复用同一代码目录。配置只保存函数代码、规格和触发器，不保存任何环境变量；否则再次执行 `tcb fn deploy` 可能把生产 token 写进仓库，或用不完整变量覆盖云端配置。`ROOT_JOB_BASE_URL`、`ROOT_ADMIN_JOB_TOKEN`、`ROOT_JOB_DRY_RUN` 等变量统一在 CloudBase 控制台维护。2026-07-12 两个生产函数均为 `Active / Available`，各保留原 5 项变量并临时增加 `ROOT_JOB_ROUTE_QUERY`，且 `ROOT_JOB_DRY_RUN=true`；通过 0% 候选定向路由后，11/11 个 Job 均返回 `releaseVersion=0.5.6`、HTTP 200、业务码 0 和 `dryRun=true`。真实外部 Adapter 完成小批量校准及负责人确认前不得开启 execute。

0% 候选验收可使用 CloudBase 官方 URL 参数定向流量：稳定版保持默认版本，候选版只匹配一次性非秘密参数。Cloud Function 临时设置 `ROOT_JOB_ROUTE_QUERY=<key>=<value>`，灰度验证脚本设置同值 `ROOT_CANARY_ROUTE_QUERY` 或传 `--route-query <key>=<value>`；调度器会把参数附加到 Job Interface，默认未配置时 URL 完全不变。验收结束后移除两个变量并恢复百分比流量配置，路由参数不能替代鉴权，也不得承载 token、密码或用户标识。

生产 MySQL 使用私网地址时，CloudRun 候选必须显式继承当前稳定版本的 `VpcConf`。CloudBase CLI `3.5.7` 的差异配置转换不会自动提交 `VpcConf`；2026-07-12 的 `020/021` 因遗漏该项，在应用监听 80 端口前无法连接 MySQL，探针均以 `connection refused` 失败。发布脚本必须从稳定版本 `DescribeVersionDetail` 回读 VPC 配置，在 `UpdateCloudRunServer.Items` 中显式提交 `{ Key: "VpcConf", VpcConf: ... }`，并在候选创建后再次回读 `DescribeVersionDetail.VpcConf`。缺 VPC、稳定版不是默认版本或候选百分比不为 0 时立即停止，不进入探针。

CloudRun 中的 CloudBase 对象存储使用服务端 HTTP Interface，生产候选必须同时配置 `ROOT_CLOUDBASE_STORAGE_TRANSPORT=HTTP`、匹配生产环境的 `ROOT_CLOUDBASE_ENV_ID` 和服务端 `CLOUDBASE_APIKEY`。API Key 只保存于受控密钥存储，不写入仓库、命令参数、发布文档或客户端代码。探针只允许上传一个随机小对象，并按上传授权返回的精确 `cloudObjectId` 删除；上传结果含糊时只对该精确 ID 做补偿删除，禁止按目录或前缀清理。2026-07-12 的 023 候选已完成 HTTP 200、上传确认、删除确认、审计匹配和目录 `total=0` 回读。

有赞身份对账首次开放 execute 前，必须先完成 User Query Interface 权限与 token 生命周期确认，再把 `ROOT_YOUZAN_IDENTITY_RECONCILE_ENABLED` 改为 `true`。自用型无容器 token 由 `client_id + client_secret + grant_id` 换取；当前版本采用单一负责人集中轮换，不允许两个实例各自换 token。生产调用会检查轮换模式与到期时间，缺失或已过期时在请求有赞前失败关闭。建议先运行：

```bash
ROOT_JOB_BASE_URL=https://myroot-api-273748-8-1437260454.sh.run.tcloudbase.com \
ROOT_ADMIN_JOB_TOKEN=*** \
npm run youzan-identity-reconcile --prefix backend -- --dry-run --batch-size 5
```

不要把真实 token 写进命令历史、仓库或发布证据；证据只保留配置存在性、候选数、成功/失败数和冲突数。

## 生产灰度验证

灰度脚本只验证流量结果，不修改 CloudBase 流量。候选版本必须先通过 `/health` 版本归因和 `/ready` Store 检查；对象存储探针还需要显式开关、Admin token 和幂等请求号。

```bash
# 1. 经发布负责人确认后，在 CloudBase 设置 95% 稳定版、5% 候选版
tcb cloudrun traffic \
  -e myroot-prod-d5gl3gzg7115f149a \
  -s myroot-api \
  --stable 95 \
  --canary 5

# 2. 在当前 shell 安全注入 ROOT_ADMIN_TOKEN 后执行候选版验证
ROOT_PUBLIC_BASE_URL=https://myroot-api-273748-8-1437260454.sh.run.tcloudbase.com \
ROOT_CANARY_EXPECTED_VERSION=0.5.6 \
ROOT_CANARY_EXPECTED_STORE_KIND=mysql \
ROOT_CANARY_EXPECTED_MIGRATION_VERSION=004_external_evidence_minimization.sql \
npm run verify:canary -- \
  --execute-object-probe \
  --request-id canary-object-<发布批次>

# 3. 任一核心 Gate 失败立即回滚
tcb cloudrun traffic rollback \
  -e myroot-prod-d5gl3gzg7115f149a \
  -s myroot-api
```

脚本退出码：`0` 全部通过；`2` 未命中候选健康探针；`3` 候选 Store 未就绪；`4` CloudBase 对象存储上传或删除未通过；`5` 候选公开隐私说明缺处理者、有效联系方式、正整数保存天数或版本归因。不要把 Admin token 写入命令参数、文档或证据包。

首次开启 execute 前，先确认所有真实外部 Adapter 已完成小批量校准、负责人和告警路由已就绪，再把 Cloud Function 的 `ROOT_JOB_DRY_RUN` 改为 `false`。`ROOT_ADMIN_JOB_TOKEN` 不写入仓库，只放 CloudBase 环境变量或密钥管理；它只允许调用 `/api/v1/jobs/*`，不能访问通用后台 Interface。

## 2. 小程序改正式接口

打开 `miniprogram/config/env.js`，把：

```js
const productionApiBaseUrl = "https://api.example.com";
```

改成你的正式接口域名，例如：

```js
const productionApiBaseUrl = "https://myroot-api-273748-8-1437260454.sh.run.tcloudbase.com";
```

当前 `miniprogram/config/env.js` 的 `develop`、`trial` 和 `release` 均使用 `cloudContainer` 访问 `myroot-prod-d5gl3gzg7115f149a / myroot-api`。这是本轮团队内测的临时环境策略，便于直接验证 CloudBase SQL；后续恢复独立测试环境时只修改 `develop/trial` 配置。`productionApiBaseUrl` 只用于公网校准，不替代小程序云调用。

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

- `miniprogram/config/env.js` 的 `develop/trial/release` 已按本轮策略指向 `myroot-prod-d5gl3gzg7115f149a / myroot-api`。
- 微信公众平台已配置 `request 合法域名`。
- 后端 HTTPS 证书有效，`/health` 与 `/ready` 均可访问，后者证明 MySQL 迁移和快照可读。
- 后端已配置 `WECHAT_APPID` 和 `WECHAT_APPSECRET`。
- 云托管开放接口服务已放行 `wxa/business/getuserphonenumber`，手机号快捷登录真机可用。
- `GET /api/v1/admin/me` 可返回当前 operator、role 和 capabilities，Element Plus Admin 左侧菜单与 viewer/finance/operator/admin 权限预期一致。
- `backend/public/admin-dist` 已随部署产物发布，`/admin` 加载 Element Plus Admin，`/admin/assets/*.js` 返回 200，`/admin-legacy` 可作为旧后台回退入口；如使用自定义路径，已配置 `ROOT_ADMIN_DIST_DIR`。
- `GET /api/v1/admin/cloudbase-identity-probe` 已在真实 CloudBase 请求下验证 openid 与 unionid，身份探针为 `READY`，且已留存脱敏证明。
- 小程序发布包不包含开发调试登录入口，后端未启用直接手机号登录测试开关。
- 生产数据已接入 CloudBase MySQL Adapter；连接池、迁移版本、修订号与核心关系表均有实测证据。
- 两个 Cloud Function 当前合计 11 个触发器；11/11 已在 `v0.5.6` 候选定向路由上取得 HTTP 200、业务码 0、`dryRun=true` 证明，正式外部动作校准完成前继续保持 `ROOT_JOB_DRY_RUN=true`。
- CloudBase 对象存储生产探针已在 023 候选完成单对象上传、精确删除和空目录回读；正式业务对象 execute 仍需按各自 Gate 独立授权。
- 迁移后快照已非破坏性恢复到隔离库并回读 24 张表、迁移版本与快照版本；恢复演练库保留至审计结束。
- 已按 `docs/release_readiness.md` 跑完最小手工验收矩阵。
- 正式发布前仍需用真实账号核对有赞订单、物流、企业微信和奖励履约 Adapter 字段与回执。

官方参考：

- 微信小程序网络能力文档：https://developers.weixin.qq.com/miniprogram/dev/framework/ability/network.html
- 微信开发者工具 CI/上传文档：https://developers.weixin.qq.com/miniprogram/dev/devtools/ci.html
- 获取手机号接口文档：https://developers.weixin.qq.com/miniprogram/dev/api/open-api/phonenumber/wx.getPhoneNumber.html
