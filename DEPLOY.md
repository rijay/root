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
```

本轮内测直接使用 CloudBase MySQL，不再以容器临时 SQLite 承接业务数据。小程序始终通过 `wx.cloud.callContainer -> myroot-api -> MySQL`，不允许直连数据库。Store Module 使用连接池、迁移锁、修订号行锁和事务内核心关系表同步；20 并发写、容器重启、双实例、跨实例幂等、结算奖励幂等和数据库恢复均已实测。生产启动还会读取 `SHOW GRANTS FOR CURRENT_USER()`：运行账号必须只在 `MYSQL_DATABASE` 上具备 `SELECT / INSERT / UPDATE / DELETE / CREATE / ALTER`，存在 `*.*` 数据权限、额外 schema 权限或 `GRANT OPTION` 时失败关闭。正式发布仍需完成真机跳转、业务回滚和批准的外部 Gate。

CloudBase 生产环境与 MySQL Store 决策见 `docs/cloudbase_mysql_store_decision.md`；该文件只记录占位变量、验证步骤和证明要求，真实 secret 仍只放 CloudBase 环境变量或密钥管理。

5. 在微信云托管控制台打开该服务的云调用/开放接口服务能力，并放行 `wxa/business/getuserphonenumber`。正式小程序手机号快捷登录依赖这个开放接口；服务端会优先使用 `wx.cloud.callContainer` 注入的 `x-wx-openid` 和云托管开放接口取手机号，AppSecret 直连只作为本地或非云托管 Adapter 的兜底路径。
6. 云托管最小实例数设为 1、最大实例数先设为 2；数据库关闭自动暂停，避免团队内测时容器和数据库双重冷启动。若后续并发持续增加，再依据连接池等待、事务耗时和数据库连接数调节，不直接放大实例数。
7. 从项目根目录构建 Element Plus Admin，并复制到 backend-only 部署上下文；否则 `/admin` 会回退旧静态后台：

```bash
npm run admin:build
npm run deploy:prepare-admin
```

8. 部署完成后访问 `/health` 和 `/ready`。前者确认进程存活，后者必须返回 `store.kind=mysql`、迁移版本 `005_notification_subscription_grants.sql` 和有效修订号。
9. 访问 `https://myroot-api-273748-8-1437260454.sh.run.tcloudbase.com/admin`，确认 Element Plus Admin 可打开；访问 `/admin/assets/*.js` 确认返回 200；访问 `/admin-legacy` 确认旧静态后台回退页可打开。内测环境同样以控制台展示的 `myroot-test` 服务域名为准。
10. 执行 `npm run production-env --prefix backend -- --target production`，确认生产环境变量矩阵已列出所有缺失项和负责人。
11. 再执行 `npm run calibrate -- --base-url https://myroot-api-273748-8-1437260454.sh.run.tcloudbase.com --target gray`，确认发布记录能返回 ROOT 后端状态。内测环境改用控制台展示的 `myroot-test` 服务域名。
12. 执行 `npm run jobs:manifest --prefix backend -- --base-url https://myroot-api-273748-8-1437260454.sh.run.tcloudbase.com --strict`，确认 CloudBase 定时 Job 的频率、命令和环境变量清单为 `PASS`。内测环境先只生成 Manifest，不开启 execute。
13. 微信开放平台认证和应用绑定完成后，通过真实 CloudBase 请求访问 `GET /api/v1/admin/cloudbase-identity-probe`，确认返回 `READY`；本地 curl 只能验证路由形状，真实 openid/unionid 必须由 CloudBase 注入，发布记录只保留脱敏预览。

## 1.1 CloudBase 定时 Job

上线前先生成发布 Manifest：

```bash
npm run jobs:manifest --prefix backend -- --base-url https://<myroot-api-host> --strict
```

Manifest 只保留两个正式 Job：

1. `health_data_retention_cleanup`：每日 04:15 调用 `POST /api/v1/jobs/health-data-retention-cleanup`；正式执行前必须完成隐私配置、dry-run 和单独授权。
2. `v1_runtime_cycle`：每分钟调用 `POST /api/v1/jobs/v1-runtime-cycle`；默认 preview，仅由独立 CloudBase timer scheduler 调用。

生产环境使用 `ROOT_ADMIN_JOB_ROUTE_TOKENS` 为两个路径配置互不复用的轮换 token，并启用 `ROOT_REQUIRE_SCOPED_JOB_TOKENS=true`。CloudBase 配置和本地 Manifest 不证明函数已经部署或取得执行授权。

0% 候选验收可使用 CloudBase 官方 URL 参数定向流量：稳定版保持默认版本，候选版只匹配一次性非秘密参数。Cloud Function 临时设置 `ROOT_JOB_ROUTE_QUERY=<key>=<value>`，灰度验证脚本设置同值 `ROOT_CANARY_ROUTE_QUERY` 或传 `--route-query <key>=<value>`；调度器会把参数附加到 Job Interface，默认未配置时 URL 完全不变。验收结束后移除两个变量并恢复百分比流量配置，路由参数不能替代鉴权，也不得承载 token、密码或用户标识。

生产 MySQL 使用私网地址时，CloudRun 候选必须显式继承当前稳定版本的 `VpcConf`。CloudBase CLI `3.5.7` 的差异配置转换不会自动提交 `VpcConf`；2026-07-12 的 `020/021` 因遗漏该项，在应用监听 80 端口前无法连接 MySQL，探针均以 `connection refused` 失败。发布脚本必须从稳定版本 `DescribeVersionDetail` 回读 VPC 配置，在 `UpdateCloudRunServer.Items` 中显式提交 `{ Key: "VpcConf", VpcConf: ... }`，并在候选创建后再次回读 `DescribeVersionDetail.VpcConf`。缺 VPC、稳定版不是默认版本或候选百分比不为 0 时立即停止，不进入探针。

CloudRun 中的 CloudBase 对象存储使用服务端 HTTP Interface，生产候选必须同时配置 `ROOT_CLOUDBASE_STORAGE_TRANSPORT=HTTP`、匹配生产环境的 `ROOT_CLOUDBASE_ENV_ID` 和服务端 `CLOUDBASE_APIKEY`。API Key 只保存于受控密钥存储，不写入仓库、命令参数、发布文档或客户端代码。探针只允许上传一个随机小对象，并按上传授权返回的精确 `cloudObjectId` 删除；上传结果含糊时只对该精确 ID 做补偿删除，禁止按目录或前缀清理。2026-07-13 的 025 候选已完成 HTTP 200、上传确认、删除确认、审计匹配和目录 `total=0` 回读。

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
ROOT_CANARY_EXPECTED_VERSION=0.5.12 \
ROOT_CANARY_EXPECTED_STORE_KIND=mysql \
ROOT_CANARY_EXPECTED_MIGRATION_VERSION=005_notification_subscription_grants.sql \
npm run verify:canary -- \
  --execute-object-probe \
  --request-id canary-object-<发布批次>

# 3. 任一核心 Gate 失败立即回滚
tcb cloudrun traffic rollback \
  -e myroot-prod-d5gl3gzg7115f149a \
  -s myroot-api
```

脚本退出码：`0` 全部通过；`2` 未命中候选健康探针；`3` 候选 Store 未就绪；`4` CloudBase 对象存储上传或删除未通过；`5` 候选公开隐私说明缺处理者、有效联系方式、正整数保存天数或版本归因。不要把 Admin token 写入命令参数、文档或证据包。

健康数据清理首次开启 execute 前必须完成 dry-run、隐私保存期限核对和单独授权；v1 Runtime cycle 保持独立 preview/execute 控制。Job token 不写入仓库，只放 CloudBase 环境变量或密钥管理，并按路径独立配置。

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
- 两个 Cloud Function 当前合计 11 个触发器，代码包继续保持上一轮已验证版本；027 部署后只读回读为 `Active / Available`、各 6 个变量、10+1 个启用触发器，定向路由精确匹配 027 且 `ROOT_JOB_DRY_RUN=true`。本轮没有更新 Function 或调用 Job。
- 微信公众平台已确认 `v0.5.10` 为体验版；独立用户流程已生成匹配的 `SCHEDULED` 提醒任务，未来时刻 dry-run 返回 `DRY_RUN_READY`，事后回读确认任务 `attempts=0`、授权额度未占用且送达记录未增加。该结果不是实际送达证明。
- CloudBase 对象存储生产探针已在 025 候选完成单对象上传、按返回对象标识精确删除、审计匹配和探针目录 `total=0` 回读；正式业务对象 execute 仍需按各自 Gate 独立授权。
- 经新的单独授权，025 候选仅执行一次单用户真实提醒；Job Interface 返回 `HTTP 200 / code=0`，唯一任务返回 `FAILED / 1006 / external HTTP 412 / externalErrorCode=null / deliveryOutcome=UNKNOWN`。没有重试；匹配额度按 v0.5.10 语义进入 `REVIEW_REQUIRED`。发送后 dry-run 无到期任务或卡住的 `SENDING`，函数仍保持全局 dry-run；修复并取得全新额度与新授权前不得再次发送。
- `v0.5.11` 已部署为 `myroot-api-026 / URL_PARAMS / 0%`，定向 `/health`、`/ready`、隐私和 Admin Gate 通过，15 次无参数健康请求均未命中 026；未上传新的体验版。该候选包含微信 JSON POST 的 UTF-8 `Content-Length`、64 KiB 响应上限和脱敏诊断，但本轮没有执行微信业务 POST 或提醒发送，不能据此判定 412 根因已修复或消息已送达。
- `v0.5.12` 已部署为 `myroot-api-027 / URL_PARAMS / 0%`，显式 `ROOT_RELEASE_ID=v0.5.12+ef9fab932a08`；定向健康、就绪、隐私和 Admin Gate 通过，15 次无参数请求未命中 027。完整证据见 `docs/production_gray_release_027_2026-07-13.md`。
- v0.5.12 将生产证明分为运行环境与发布候选两种范围。5 个发布级证明由后端自动绑定当前 `version + releaseId`，其中 `releaseId` 必须来自显式、唯一的 `ROOT_RELEASE_ID`；正式 Gate 拒绝版本号 fallback、旧候选、缺版本字段或客户端伪造的绑定。其余环境级证明可跨候选复用。线上现有 4 条环境级 VERIFIED 已回读确认均带 `evidenceRef`；T-012/T-015 虽已有本地材料，但尚未写入正式 Evidence Intake。
- 迁移后快照已非破坏性恢复到隔离库并回读 24 张表、迁移版本与快照版本；恢复演练库保留至审计结束。
- 已按 `docs/release_readiness.md` 跑完最小手工验收矩阵。
- 正式发布前仍需用真实账号核对有赞订单、物流、企业微信和奖励履约 Adapter 字段与回执。

官方参考：

- 微信小程序网络能力文档：https://developers.weixin.qq.com/miniprogram/dev/framework/ability/network.html
- 微信开发者工具 CI/上传文档：https://developers.weixin.qq.com/miniprogram/dev/devtools/ci.html
- 获取手机号接口文档：https://developers.weixin.qq.com/miniprogram/dev/api/open-api/phonenumber/wx.getPhoneNumber.html
