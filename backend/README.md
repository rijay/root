# ROOT 7日打卡后台

轻量 Node.js 后台，使用仓库锁定的运行依赖，便于先跑通 ROOT 试饮流程和 HTTP Interface。默认使用内存数据仓库；设置 `ROOT_STORE_FILE` 后可切到 JSON 文件 Adapter，用于灰度试跑和重启后保留本地数据；设置 `ROOT_SQLITE_FILE` 后可切到 SQLite Adapter，用于单实例小范围上线前验证。

> 当前运行与包版本仍为 `0.5.13`。内存、JSON 与 SQLite Adapter 只用于本地；v1.0.0 新增内容仍是默认禁用的本地 Foundation Implementation，不是正式运行时、Candidate 或发布授权。

## 常用命令

```bash
npm run dev
npm test
```

微信云托管快速部署时，选择 Express.js 模板即可；真正部署本项目时请把代码源替换为本目录 `backend/`，不要继续使用 `WeixinCloud/wxcloudrun-express` 示例仓库。本目录已包含 `Dockerfile`，容器默认监听 `80` 端口。若要让 backend-only 镜像服务 Element Plus Admin，部署前先在项目根目录执行：

```bash
npm run admin:build
npm run deploy:prepare-admin
```

该命令会把 `admin/dist` 复制到 `backend/public/admin-dist`。运行时也可以通过 `ROOT_ADMIN_DIST_DIR` 指定其他 Admin build 目录。

本地灰度试跑需要保留数据时：

```bash
ROOT_STORE_FILE=/Users/rijay/Documents/Root/root_seven_day_checkin/backend/data/dev-store.json npm run dev
```

需要用 SQL 文件承载数据时：

```bash
ROOT_SQLITE_FILE=/Users/rijay/Documents/Root/root_seven_day_checkin/backend/data/root-checkin.sqlite npm run dev
```

## 生产环境变量

```bash
PORT=8787
WECHAT_APPID=正式小程序 AppID
WECHAT_APPSECRET=正式小程序 AppSecret
ROOT_PUBLIC_BASE_URL=https://api.your-domain.example
ROOT_REQUIRE_HEALTH_CONSENT=true
ROOT_PRIVACY_CONTROLLER_NAME=杭州连生健康科技有限公司
ROOT_PRIVACY_CONTACT=hydennis@foxmail.com
ROOT_HEALTH_DATA_RETENTION_DAYS=180
ROOT_HEALTH_DATA_RETENTION_CLEANUP_ENABLED=true
ROOT_HEALTH_DATA_RETENTION_CLEANUP_LIMIT=50
ROOT_HEALTH_ADVICE_MODEL_ENABLED=true
ROOT_HEALTH_ADVICE_MODEL_BASE_URL=https://your-env.api.tcloudbasegateway.com/v1/ai/cloudbase
ROOT_HEALTH_ADVICE_MODEL_API_KEY=由正式环境密钥配置注入
ROOT_HEALTH_ADVICE_MODEL_NAME=hy3
ROOT_HEALTH_ADVICE_MODEL_PROCESSOR_NAME=以实际订单和数据处理协议为准
ROOT_HEALTH_ADVICE_MODEL_SECONDARY_USE=NONE
ROOT_HEALTH_ADVICE_MODEL_PROCESSING_REGION=CN_MAINLAND
ROOT_HEALTH_ADVICE_MODEL_OTHER_PROCESSORS=NONE
ROOT_HEALTH_ADVICE_MODEL_LOG_RETENTION_DAYS=7
ROOT_HEALTH_ADVICE_MODEL_CACHE_RETENTION_MINUTES=5
ROOT_HEALTH_ADVICE_MODEL_DATA_POLICY_VERIFIED=true
ROOT_CLOUDBASE_ENV_ID=CloudBase环境ID
ROOT_STORE_ADAPTER=mysql
MYSQL_ADDRESS=MySQL私网地址:3306
MYSQL_USERNAME=最小权限应用账号
MYSQL_PASSWORD=由正式环境密钥配置注入
MYSQL_DATABASE=目标数据库名
MYSQL_CONNECTION_LIMIT=8
MYROOT_CLOUDRUN_MAX_INSTANCES=2
MYSQL_SERVER_MAX_CONNECTIONS=100
MYROOT_MYSQL_CONNECTION_HEADROOM=20
MYROOT_MYSQL_CAPACITY_EVIDENCE_REF=受控容量证据引用
MYSQL_CONNECT_TIMEOUT_MS=10000
ROOT_PHONE_HMAC_KEY=由正式环境密钥配置注入
ROOT_COMMAND_REQUEST_DIGEST_KEY=由正式环境密钥配置注入
ROOT_COMMAND_REQUEST_DIGEST_KEY_ID=command-request-digest-v1
ROOT_COMMAND_REQUEST_DIGEST_VERIFICATION_KEYS_JSON={}
ROOT_COMMAND_RESULT_ENCRYPTION_KEY=由正式环境密钥配置注入
ROOT_COMMAND_RESULT_KEY_ID=command-result-v1
ROOT_COMMAND_RESULT_DECRYPTION_KEYS_JSON={}
ROOT_KEY_INVENTORY_RETIRED_KEY_IDS_JSON={"REQUEST_DIGEST":[],"COMMAND_RESULT":[],"INBOX_CONTENT":[],"NOTIFICATION_RECEIPT":[]}
ROOT_ADMIN_TOKEN=由正式环境密钥配置注入
```

正式环境登录会使用 `wx.login` 和 `getPhoneNumber` 返回的 code，到微信服务端换取 openid 和手机号。未配置 `WECHAT_APPID` / `WECHAT_APPSECRET` 时，正式手机号登录会拒绝执行，避免无授权手机号进入。

健康建议模型必须遵守 [`docs/v0.7.0_health_ai_data_management_standard_2026-08-26.md`](../docs/v0.7.0_health_ai_data_management_standard_2026-08-26.md)：供应商请求/响应日志最长保留 7 天、服务端临时缓存最长 5 分钟、无训练等二次使用、只在中国大陆处理且无其他受托方。上述六项数据策略变量缺失或不符合固定值时，模型 Adapter 会 fail-close 并使用经审核固定建议。`ROOT_HEALTH_ADVICE_MODEL_DATA_POLICY_VERIFIED=true` 只能在缓存最长时限等账户或合同级数据策略已核验并归档脱敏证据后配置；该布尔值本身不是上线证据。

微信订阅发送只允许 `https://api.weixin.qq.com/cgi-bin/message/subscribe/send`。即使配置了 `ROOT_WECHAT_OPENAPI_BASE_URL` 或 `ROOT_WECHAT_SUBSCRIBE_SEND_URL`，受保护运行时也拒绝非官方 origin、明文、userinfo、额外 query/fragment、端口或路径漂移；订阅 access token 永不发送到 loopback。发送 Adapter 在获取 token 前和网络调用前分别校验，服务器在 `ROOT_CHECKIN_REMINDER_SEND_ENABLED=true` 时启动前再次校验，底层 HTTP Implementation 不跟随 redirect。该本地防护不代表 Candidate/生产网络出口、模板、额度或真实送达已经验收。

`ROOT_STORE_FILE` 是可选项：不设置时使用内存 Adapter；设置后每个 HTTP Interface 请求在返回前保存到该 JSON 文件。JSON 文件 Adapter 只建议用于本地排查和演示。

`ROOT_SQLITE_FILE` 优先级高于 `ROOT_STORE_FILE`。SQLite Adapter 使用事务把当前 Store Interface 的整块数据保存到 `root_store_snapshot`，只适合单实例本地验证。任何 CloudBase Candidate、内测或正式环境均必须显式使用 MySQL Adapter；当前仅完成本机一次性 MySQL 证明，尚未验证 Candidate/生产环境配置与运行结果。

MySQL Adapter 使用连接池和数据库级迁移锁，应用启动时幂等执行 `db/migrations`。业务请求通过快照修订号行锁串行化跨实例写入，成功响应只在事务提交后发出；用户、微信身份、活动、任务、问卷、提醒、结算、奖励和人工审核等关系表与兼容快照在同一事务内同步。命令结果保护的 `A256GCM:v1` Interface 固定 131072-byte 明文/密文、174764-character canonical base64 与 184320-byte envelope 上限，本地兼容路径也共享 128 KiB 上限；Proxy/accessor/Symbol/继承 shape、非规范 base64、超限或认证后的非法 UTF-8 均 fail-close。可通过 `GET /ready` 检查连接、迁移版本、修订号与可选的持久 Runtime attestation。2026-07-18 已在一次性 MySQL `8.0.43`（镜像 digest `sha256:3e646bcda0d9448ffa3d2024eef04e1bca95528ec19b9e8b76749da9d97d4a10`）空库完成 `001–057`：57 个 migration marker、52 张表；生成快照 SHA-256=`e84fe654b674981917c472cc73593657dd6a9189dd32b736ff1bae895be7a7c3`、migration-set digest=`fa98e2432fc7210615d5508597d93c4203dc414a2636d633eb5e12c63a053b27`、schema body digest=`e7290b12d0aa2d2455d6abff50f7c1af8dfd335188ce200a348aa27dab32acb9`，独立随机库 verify 结果 `matches=true`。当前 migration-set 已扩展至 001～066；Attempt 9 为 12 PASS / 1 FAIL / 0 SKIP 并已清理，根因是测试夹具 SLO profile 漂移。migration 066 增加告警严重度与 SLO profile 的跨事实校验。R10 未执行且已被取代；R11 绑定完整执行闭包、工具链、阶段重验、允许输出回滚和结构化 outcome，但未授权、未执行，因此 058～066 仍无完整真实引擎证明，旧 snapshot 不得手工更新。动态快照命令要求实例只存在固定且为空的沙箱 marker schema、精确校验 `DATABASE()`，并以同目录临时文件原子替换 snapshot；Runner 后续失败会恢复执行前 snapshot/build outputs。上述历史证明不关闭 CloudBase Candidate/生产 preflight、脱敏事实 parity、容量、锁竞争、EXPLAIN、多连接 crash-replay、最小权限、旧实例 drain/rollback compatibility 实证；这些 Gate 仍保持 OPEN/HARD BLOCKER。

当前本地聚合回归（2026-07-20）：Backend 1291 tests，1282 PASS / 9 SKIP / 0 FAIL；9 个 SKIP 均为默认关闭的真实 MySQL 分支。历史一次性授权只完整实证 migration 001～057。Attempt 8 使用 R8 包得到 12 PASS / 1 FAIL / 0 SKIP 后立即停止并清理；R8 nonce 已消费，Schema 快照与最终 verify 未运行。结构化诊断将唯一失败定位为 runtime-principal 真实引擎夹具写入过期 authority version；R9 已从运行时 Module 导入唯一常量并冻结，但未授权、未执行。14 Gate 正式上线 Readiness Validator 仍派生 14 OPEN / 3 HARD BLOCKER / 0 CLOSED，且永不自行授权发布。`v1:foundation:check` PASS；最近一次最终 `npm run verify -- --json` 为 `17/18`，覆盖 445 个 JavaScript 文件、65 个 immutable migration 文件、Production env matrix 与 HTTP Interface smoke，唯一失败是 committed `schema.sql` 仍绑定 001～057。运行/包版本仍为 `0.5.13`；详见 `docs/evidence/v1.0.0/local_mysql_readiness_ledger_2026-07-19.md`，该结果不是远端 CI、Candidate/生产或发布授权。

生产环境会在迁移前读取 `SHOW GRANTS FOR CURRENT_USER()` 并强制最小权限。运行账号只能在 `MYSQL_DATABASE` 对应 schema 上具备 `SELECT / INSERT / UPDATE / DELETE / CREATE / ALTER`；存在全局数据权限、额外 schema 权限或 `GRANT OPTION` 时拒绝启动。非生产环境可用 `ROOT_ENFORCE_MYSQL_LEAST_PRIVILEGE=true` 显式启用同一检查；`/ready` 和发布证据只暴露是否通过与权限作用域，不返回账号或原始授权语句。

## 正式上线保留的可靠性能力

当前后端保留并持续验证以下通用能力：微信可信身份、隐私与健康单独同意、命令幂等与结果保护、MySQL 迁移和最小权限、审计、内容发布 Gate、健康数据到期清理及 Candidate 验证。旧任务分享 Inbox/Replay、V1 Runtime Control、旧路由兼容 Registry 和 Fact Authority 证明层已退出正式运行范围；历史 migration 仍保持不可改写，后续只通过新的 forward migration 处理历史表。

`GET /api/v1/admin/release-record` 只汇总正式内容发布状态，不再读取旧 Adapter、订单、咨询或结算证明。

## 主要 HTTP Interface 路径

- `POST /api/v1/auth/login`
- `GET /api/v1/privacy/notice`
- `GET|POST /api/v1/privacy/health-consent`
- `GET /api/v1/user/state`
- `GET|POST /api/v1/user/formal-profile`
- `GET /api/v1/public/content/welcome|home|detail|action`
- `GET|POST /api/v1/health/root4u/*`
- `GET|POST /api/v1/activities/*`
- `POST /api/v1/jobs/health-data-retention-cleanup`
- `/api/v1/admin/*`：只保留正式内容、活动、Root4U、用户查询、审计和发布记录 Interface。

任务、奖励、打卡、内部订单、退款、咨询、外部 Adapter 与旧 Admin Interface 均返回 `404`。

本地管理台：`/` 或 `/admin`。

注意：默认内存 Adapter 适合联调和演示。JSON 文件与 SQLite Adapter 不承接 CloudBase 内测或正式数据；多人、多实例和跨重启验证统一使用 MySQL Adapter。
