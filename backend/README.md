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

拿到真实导出文件后，可以批量跑样本准入：

```bash
npm run samples -- --base-url http://127.0.0.1:8788 --mode preview --youzan-file ./samples/youzan.csv
npm run samples -- --base-url http://127.0.0.1:8788 --mode import --youzan-file ./samples/youzan.csv --fulfillment-file ./samples/fulfillment.csv --wework-file ./samples/wework.csv --require-all-ready
```

真实 Adapter 配置好后，可以先小批量运行：

```bash
npm run adapters -- --base-url http://127.0.0.1:8788 --source youzan --mode preview --limit 1
npm run adapters -- --base-url http://127.0.0.1:8788 --source fulfillment --mode import --limit 1
npm run adapters -- --base-url http://127.0.0.1:8788 --source wework --mode preview --limit 1
```

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
ROOT_CLOUDBASE_ENV_ID=CloudBase环境ID
ROOT_STORE_ADAPTER=mysql
MYSQL_ADDRESS=MySQL私网地址:3306
MYSQL_USERNAME=最小权限应用账号
MYSQL_PASSWORD=由正式环境密钥配置注入
MYSQL_DATABASE=目标数据库名
MYSQL_CONNECTION_LIMIT=8
MYROOT_V1_RUNTIME_CONNECTION_LIMIT=3
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
ROOT_INBOX_CONTENT_ENCRYPTION_KEY=由正式环境密钥配置注入
ROOT_INBOX_CONTENT_KEY_ID=inbox-content-v1
ROOT_INBOX_CONTENT_DECRYPTION_KEYS_JSON={}
ROOT_NOTIFICATION_PROVIDER_RECEIPT_HMAC_KEY=由正式环境密钥配置注入
ROOT_NOTIFICATION_PROVIDER_RECEIPT_HMAC_KEY_ID=notification-receipt-v1
ROOT_KEY_INVENTORY_RETIRED_KEY_IDS_JSON={"REQUEST_DIGEST":[],"COMMAND_RESULT":[],"INBOX_CONTENT":[],"NOTIFICATION_RECEIPT":[]}
ROOT_ADMIN_TOKEN=由正式环境密钥配置注入
YOUZAN_CLIENT_ID=有赞应用 client id
YOUZAN_GRANT_ID=有赞 ROOT 店铺 id
YOUZAN_ACCESS_TOKEN=有赞访问 token
YOUZAN_ACCESS_TOKEN_EXPIRES_AT=2099-01-01T00:00:00+08:00
YOUZAN_TOKEN_MANAGEMENT_MODE=STATIC_ROTATION
YOUZAN_TOKEN_ROTATION_OWNER=轮换负责人
YOUZAN_ORDER_LIST_URL=https://open.youzanyun.com/api/youzan.trades.sold.get/4.0.4
YOUZAN_ORDER_LIST_METHOD=POST
YOUZAN_ORDER_LIST_DATA_PATH=data.items
YOUZAN_ORDER_LIST_CURSOR_PATH=data.nextCursor
YOUZAN_ORDER_FIELD_MAP={"youzanOrderNo":"tid","receiverPhone":"receiver_tel"}
YOUZAN_CUSTOMER_LIST_URL=https://open.youzanyun.com/api/youzan.scrm.customer.list/1.0.0
YOUZAN_USER_QUERY_URL=https://open.youzanyun.com/api/youzan.users.info.query/1.0.1
ROOT_YOUZAN_IDENTITY_RECONCILE_ENABLED=false
ROOT_YOUZAN_IDENTITY_RECONCILE_BATCH_SIZE=5
ROOT_YOUZAN_IDENTITY_RECONCILE_REFRESH_HOURS=168
ROOT_FULFILLMENT_SECRET=物流推送或拉取密钥
ROOT_FULFILLMENT_LIST_URL=https://example.com/fulfillment/events
ROOT_FULFILLMENT_LIST_METHOD=POST
ROOT_FULFILLMENT_LIST_DATA_PATH=data.events
ROOT_FULFILLMENT_LIST_CURSOR_PATH=data.nextCursor
ROOT_FULFILLMENT_FIELD_MAP={"youzanOrderNo":"order_no","deliveryStatus":"logistics_status"}
WEWORK_CORP_ID=企业微信 corp id
WEWORK_CONTACT_SECRET=企业微信客户联系 secret
WEWORK_ACCESS_TOKEN=企业微信访问 token
WEWORK_CONTACT_LIST_URL=https://example.com/wework/external-contacts
WEWORK_CONTACT_LIST_METHOD=POST
WEWORK_CONTACT_LIST_DATA_PATH=data.contacts
WEWORK_CONTACT_LIST_CURSOR_PATH=data.nextCursor
WEWORK_CONTACT_FIELD_MAP={"externalContactId":"external_userid","remarkName":"remark","receiverPhone":"mobile"}
```

`YOUZAN_CLIENT_SECRET` 属于 token 换取凭据，只保存在密码管理器或受控轮换终端，不配置到 CloudRun。`STATIC_ROTATION` 的运行容器只需要 client id、grant id、access token、到期时间和轮换负责人元数据。

正式环境登录会使用 `wx.login` 和 `getPhoneNumber` 返回的 code，到微信服务端换取 openid 和手机号。未配置 `WECHAT_APPID` / `WECHAT_APPSECRET` 时，正式手机号登录会拒绝执行，避免无授权手机号进入。

微信订阅发送只允许 `https://api.weixin.qq.com/cgi-bin/message/subscribe/send`。即使配置了 `ROOT_WECHAT_OPENAPI_BASE_URL` 或 `ROOT_WECHAT_SUBSCRIBE_SEND_URL`，受保护运行时也拒绝非官方 origin、明文、userinfo、额外 query/fragment、端口或路径漂移；订阅 access token 永不发送到 loopback。发送 Adapter 在获取 token 前和网络调用前分别校验，服务器在 `ROOT_CHECKIN_REMINDER_SEND_ENABLED=true` 时启动前再次校验，底层 HTTP Implementation 不跟随 redirect。该本地防护不代表 Candidate/生产网络出口、模板、额度或真实送达已经验收。

`ROOT_STORE_FILE` 是可选项：不设置时使用内存 Adapter；设置后每个 HTTP Interface 请求在返回前保存到该 JSON 文件。JSON 文件 Adapter 只建议用于本地排查和演示。

`ROOT_SQLITE_FILE` 优先级高于 `ROOT_STORE_FILE`。SQLite Adapter 使用事务把当前 Store Interface 的整块数据保存到 `root_store_snapshot`，只适合单实例本地验证。任何 CloudBase Candidate、内测或正式环境均必须显式使用 MySQL Adapter；当前仅完成本机一次性 MySQL 证明，尚未验证 Candidate/生产环境配置与运行结果。

MySQL Adapter 使用连接池和数据库级迁移锁，应用启动时幂等执行 `db/migrations`。业务请求通过快照修订号行锁串行化跨实例写入，成功响应只在事务提交后发出；用户、微信身份、活动、任务、问卷、提醒、结算、奖励和人工审核等关系表与兼容快照在同一事务内同步。命令结果保护的 `A256GCM:v1` Interface 固定 131072-byte 明文/密文、174764-character canonical base64 与 184320-byte envelope 上限，本地兼容路径也共享 128 KiB 上限；Proxy/accessor/Symbol/继承 shape、非规范 base64、超限或认证后的非法 UTF-8 均 fail-close。可通过 `GET /ready` 检查连接、迁移版本、修订号与可选的持久 Runtime attestation。2026-07-18 已在一次性 MySQL `8.0.43`（镜像 digest `sha256:3e646bcda0d9448ffa3d2024eef04e1bca95528ec19b9e8b76749da9d97d4a10`）空库完成 `001–057`：57 个 migration marker、52 张表；生成快照 SHA-256=`e84fe654b674981917c472cc73593657dd6a9189dd32b736ff1bae895be7a7c3`、migration-set digest=`fa98e2432fc7210615d5508597d93c4203dc414a2636d633eb5e12c63a053b27`、schema body digest=`e7290b12d0aa2d2455d6abff50f7c1af8dfd335188ce200a348aa27dab32acb9`，独立随机库 verify 结果 `matches=true`。当前 migration-set 已扩展至 001～066；Attempt 9 为 12 PASS / 1 FAIL / 0 SKIP 并已清理，根因是测试夹具 SLO profile 漂移。migration 066 增加告警严重度与 SLO profile 的跨事实校验。R10 未执行且已被取代；R11 绑定完整执行闭包、工具链、阶段重验、允许输出回滚和结构化 outcome，但未授权、未执行，因此 058～066 仍无完整真实引擎证明，旧 snapshot 不得手工更新。动态快照命令要求实例只存在固定且为空的沙箱 marker schema、精确校验 `DATABASE()`，并以同目录临时文件原子替换 snapshot；Runner 后续失败会恢复执行前 snapshot/build outputs。上述历史证明不关闭 CloudBase Candidate/生产 preflight、脱敏事实 parity、容量、锁竞争、EXPLAIN、多连接 crash-replay、最小权限、旧实例 drain/rollback compatibility 实证；这些 Gate 仍保持 OPEN/HARD BLOCKER。

当前本地聚合回归（2026-07-20）：Backend 1291 tests，1282 PASS / 9 SKIP / 0 FAIL；9 个 SKIP 均为默认关闭的真实 MySQL 分支。历史一次性授权只完整实证 migration 001～057。Attempt 8 使用 R8 包得到 12 PASS / 1 FAIL / 0 SKIP 后立即停止并清理；R8 nonce 已消费，Schema 快照与最终 verify 未运行。结构化诊断将唯一失败定位为 runtime-principal 真实引擎夹具写入过期 authority version；R9 已从运行时 Module 导入唯一常量并冻结，但未授权、未执行。14 Gate 正式上线 Readiness Validator 仍派生 14 OPEN / 3 HARD BLOCKER / 0 CLOSED，且永不自行授权发布。`v1:foundation:check` PASS；最近一次最终 `npm run verify -- --json` 为 `17/18`，覆盖 445 个 JavaScript 文件、65 个 immutable migration 文件、Production env matrix 与 HTTP Interface smoke，唯一失败是 committed `schema.sql` 仍绑定 001～057。运行/包版本仍为 `0.5.13`；详见 `docs/evidence/v1.0.0/local_mysql_readiness_ledger_2026-07-19.md`，该结果不是远端 CI、Candidate/生产或发布授权。

生产环境会在迁移前读取 `SHOW GRANTS FOR CURRENT_USER()` 并强制最小权限。运行账号只能在 `MYSQL_DATABASE` 对应 schema 上具备 `SELECT / INSERT / UPDATE / DELETE / CREATE / ALTER`；存在全局数据权限、额外 schema 权限或 `GRANT OPTION` 时拒绝启动。非生产环境可用 `ROOT_ENFORCE_MYSQL_LEAST_PRIVILEGE=true` 显式启用同一检查；`/ready` 和发布证据只暴露是否通过与权限作用域，不返回账号或原始授权语句。

真实平台 Adapter 目前先开放 `MANUAL_SAMPLE` Adapter：运营粘贴有赞、物流、企业微信导出样本即可走同一套预览、导入、评审和准入 Interface。有赞开放平台、物流推送、企业微信客户联系 Adapter 已在后台展示配置状态；凭证和平台请求方式补齐后，只替换对应 Adapter 的 Implementation。真实 Adapter 成功导入后会保存增量游标；缺配置、缺 Implementation 或运行失败都会记录在 Adapter 运行台账里。

有赞订单已提供可配置 HTTP Implementation：设置 `YOUZAN_ACCESS_TOKEN` 与 `YOUZAN_ORDER_LIST_URL` 后，`YOUZAN_OPEN` Adapter 会进入配置态 `READY`；该状态只说明前置配置完整，不等于真实账号联调、数据校准或 Candidate 验证通过。生产环境还必须配置应用 client id、店铺 `grant_id`、`STATIC_ROTATION`、轮换负责人和 token 到期时间；到期或策略缺失会在网络请求前失败关闭。不同有赞返回结构可通过 `YOUZAN_ORDER_LIST_DATA_PATH`、`YOUZAN_ORDER_LIST_CURSOR_PATH`、`YOUZAN_ORDER_LIST_HAS_MORE_PATH` 和 `YOUZAN_ORDER_FIELD_MAP` 对齐，不需要改订单导入 Interface。

有赞身份补链使用独立的 User Query Implementation：从 myRoot 已确认的 UnionID 小批量查询一个或多个 `yz_open_id`，再补链同身份的未归属订单。默认 dry-run；execute 还需要 `ROOT_YOUZAN_IDENTITY_RECONCILE_ENABLED=true` 和稳定 `request_id`。成功身份默认每 168 小时复核，捕获后续新增的有赞身份。同一 UnionID 关联多个 Root 用户、Root 用户桥接缺失、`yz_open_id` 已归属其他用户或订单归属不一致时，只创建复核待办，不覆盖现有客户或订单。对账记录只保存 UnionID 指纹和聚合结果，token、UnionID 与手机号不进入 Job 输出或审计。运行命令：

```bash
npm run youzan-identity-reconcile -- --dry-run --batch-size 5
```

物流状态也已提供可配置 HTTP Implementation：设置 `ROOT_FULFILLMENT_SECRET` 与 `ROOT_FULFILLMENT_LIST_URL` 后，`FULFILLMENT_PUSH` Adapter 会进入配置态 `READY`；该状态不等于真实物流联调、回执校准或 Candidate 验证通过。不同物流返回结构可通过 `ROOT_FULFILLMENT_LIST_DATA_PATH`、`ROOT_FULFILLMENT_LIST_CURSOR_PATH`、`ROOT_FULFILLMENT_LIST_HAS_MORE_PATH` 和 `ROOT_FULFILLMENT_FIELD_MAP` 对齐；密钥可通过 header、query 或 body 传递。

企业微信线索已提供可配置 HTTP Implementation：设置 `WEWORK_CONTACT_LIST_URL`，并配置 `WEWORK_ACCESS_TOKEN` 或 `WEWORK_CONTACT_SECRET` 后，`WEWORK_CONTACT` Adapter 会进入配置态 `READY`；该状态不等于真实企业微信联调、权限校准或 Candidate 验证通过。不同企业微信返回结构可通过 `WEWORK_CONTACT_LIST_DATA_PATH`、`WEWORK_CONTACT_LIST_CURSOR_PATH`、`WEWORK_CONTACT_LIST_HAS_MORE_PATH` 和 `WEWORK_CONTACT_FIELD_MAP` 对齐；无法匹配用户的线索会继续进入人工匹配待办。

## v1.0.0 本地 Foundation Modules

| Module | 本地状态 | 正式 Gate |
| --- | --- | --- |
| Inbox Worker Harness | `MYROOT_INBOX_WORKER_HARNESS_ENABLED=false` | 仅由受控 Runtime cycle 调用；无正式 runtime 流量接线 |
| Governed Replay Control | `MYROOT_INBOX_REPLAY_CONTROL_ENABLED=false` | 未在 Candidate/生产 MySQL 授权运行 |
| Inbox Shadow Replay Runner | `MYROOT_INBOX_SHADOW_REPLAY_RUNNER_ENABLED=false` | 仅 shadow projection；无 Outbox / network |
| Outbox→Inbox Bridge Harness | `MYROOT_OUTBOX_INBOX_BRIDGE_ENABLED=false` | 仅由受控 Runtime cycle 调用；无正式告警接收端或流量接线 |
| v1 Runtime Orchestration Foundation | `MYROOT_V1_RUNTIME_ORCHESTRATOR_ENABLED=false`；kill-switch 默认 engaged | 仅由 Runtime Control 执行 one-shot；每个协调/子 Module 连接先核对实际目标库，历史 dead-letter/companion 三锚点与 postflight 均 fail-close；无 Candidate 多实例证明 |
| v1 Runtime Control Plane | `MYROOT_V1_RUNTIME_CONTROL_PLANE_ENABLED=false`；`ROOT_V1_RUNTIME_READY_REQUIRED=false` | `032/033` cycle/alert ledger、DB-time lease/generation fencing、30 秒续租、默认 preview 的 HTTP Interface 与专属 CloudBase timer scheduler；`/ready` 只读 attestation；调度配置未部署，无 Candidate 运行、告警接收端或发布授权 |
| Notification Delivery Core | `MYROOT_NOTIFICATION_DELIVERY_FOUNDATION_ENABLED=false` | 关系权威 Inspect Interface 与 replay/ACK-unknown 收敛已落盘；无真实微信发送/设备回执，也无持久 provider-call lease/owner/expiry/generation fencing |
| Migration Execution Foundation | `MYROOT_MIGRATION_EXECUTION_FOUNDATION_ENABLED=false` | 仅 `LOCAL_ISOLATED` 合成 `TASK_SHARE` scope；无网络 / Outbox / 生产执行 / 运行时 reversal |
| v1 Route Negotiation Foundation | `MYROOT_V1_ROUTE_NEGOTIATION_ENABLED=false` | `runtimeIntegrated=false` |
| Release Evidence Contract Registry | `NON_RUNTIME_FOUNDATION_CONTRACT` | Candidate/runtime/releaseId authorized 均为 `false` |
| Key Inventory Readiness Foundation | `ROOT_KEY_INVENTORY_READINESS_ENABLED=false` | 目标库绑定的只读快照使用固定 10 秒 statement deadline 并精确回读/复原，核验 `REQUEST_DIGEST / COMMAND_RESULT / INBOX_CONTENT / NOTIFICATION_RECEIPT` 四域；REQUEST_DIGEST 覆盖 command、task-event、UnionID provenance 与 legacy/v1 recipient-binding HMAC，receipt 域覆盖 attempt/transition digest metadata。四域 current/retired/unknown 与前三域 previous、schema/index/enforced CHECK、全状态 envelope metadata 漂移均 fail-close，并认证每条可解密受保护记录；每来源最多 1000 条；receipt 因原文不持久化仅能 metadata-only，且当前没有 previous-key keyring；由受控 cycle 运行而 `/ready` 只读持久结果；无 Candidate inventory/rotation 证明 |

这些 Module 的 Interface 只形成可测试 Seam；当前不提供生产流量、网络发送、Candidate 创建或 release 权限。

Runtime Orchestration 仅在 orchestrator、Bridge、Worker 三个开关精确为 `true`，`MYROOT_V1_RUNTIME_KILL_SWITCH=DISENGAGED`、`MYROOT_V1_RUNTIME_OWNER` 合法且目标与容量检查通过时运行一次固定顺序 cycle。Store 的生产连接预算包含六项：main pool（`MYSQL_CONNECTION_LIMIT`）、Runtime Orchestration pool（`MYROOT_V1_RUNTIME_CONNECTION_LIMIT`）、Registrar pool（`MYROOT_V1_RUNTIME_ALERT_REGISTRAR_MYSQL_CONNECTION_LIMIT`）、固定 1 连接的 Registrar heartbeat pool、Worker pool（`MYROOT_V1_RUNTIME_ALERT_WORKER_MYSQL_CONNECTION_LIMIT`）和 Inspector pool（`MYROOT_V1_RUNTIME_ALERT_INSPECTOR_MYSQL_CONNECTION_LIMIT`）。Runtime Orchestration pool 必须为 `3..64`，三类告警角色 pool 分别必须为 `1..64`；连接取得继续受对应 Module 的 fail-close deadline 约束。生产矩阵强制 `(MYSQL_CONNECTION_LIMIT + MYROOT_V1_RUNTIME_CONNECTION_LIMIT + MYROOT_V1_RUNTIME_ALERT_REGISTRAR_MYSQL_CONNECTION_LIMIT + 1 + MYROOT_V1_RUNTIME_ALERT_WORKER_MYSQL_CONNECTION_LIMIT + MYROOT_V1_RUNTIME_ALERT_INSPECTOR_MYSQL_CONNECTION_LIMIT) * MYROOT_CLOUDRUN_MAX_INSTANCES + MYROOT_MYSQL_CONNECTION_HEADROOM <= MYSQL_SERVER_MAX_CONNECTIONS`，要求容量证据引用，并拒绝三类角色之间或与 main pool 复用 username/凭据，以及角色之间复用预期 `CURRENT_USER()`。这些静态配置与算式不构成真实容量、grants 或独立 principal 证明。协调连接及发给 Bridge/Worker 的每个连接都会先用 `DATABASE()` 证明实际目标库，告警角色连接还会核对预期 `CURRENT_USER()`；复用连接发生目标漂移时在事务或业务 SQL 前销毁。`GET_LOCK=NULL` 是协调失败而不是 busy。advisory lock 仅用于 non-overlap coordination；持久 ledger 以 generation/lease 提供 cycle fencing。Bridge 对 scoped DEAD source、linked source 与 self-claimed OUTBOX 三个锚点核对 companion 漂移，cycle 新增 dead-letter、终态或 postflight blocker 时返回 `REVIEW_REQUIRED`。

Runtime Control Plane 以持久 cycle/alert ledger 收敛跨实例 claim、终态、ACK unknown 与 stale recovery，租约使用 DB time、owner、generation fencing，并由独立 heartbeat pool 在长任务期间每 30 秒续期；heartbeat 失败不会写成功终态。专属 `myroot-v1-runtime-scheduler` 只接受 CloudBase timer `v1_runtime_cycle`，从规范化 `event.Time` 生成完全相同的 `scheduleId=requestId`，只调用固定 HTTPS Runtime route，并强制核对响应 identity。调度默认 preview；execute 必须显式开启并具有专属 `RUNTIME_CYCLE_EXECUTE` 权限。Job 凭据使用 `ROOT_ADMIN_JOB_ROUTE_TOKENS`（精确 pathname 对应独立轮换列表）；受保护运行时同时强制 `ROOT_REQUIRE_SCOPED_JOB_TOKENS=true`，缺少精确路由 token、跨路由复用或试图回落 legacy/通用后台 token 均 fail-close。仅 local/test 兼容路径可在显式关闭 strict 时保留 `ROOT_ADMIN_JOB_TOKEN(S)`。`cloudbaserc.json` 与 Job Manifest 只是本地待发布配置，不等于 scheduler 已部署、timer-only IAM 已启用或获得运行授权。`GET /ready` 只执行 ledger `inspect`，不在探针路径运行 inventory 或 worker。

用于 Candidate 的 Runtime scope 与容量证据必须共同绑定逻辑 environment id、有效 MySQL host/port/user/database、CloudBase environment id、`MYROOT_V1_RUNTIME_TARGET_GENERATION`、Cloud Run `K_REVISION` 或显式 64 位小写 build artifact digest、main/Runtime Orchestration/Registrar/Registrar heartbeat/Worker/Inspector 六项连接限额、实例/服务器/headroom 容量输入，以及当前/历史/退休 key 配置指纹；任一绑定输入变化都不得复用旧 SAFE attestation。环境声明进入 scope 不自证构建摘要来源、真实平台 identity、克隆/恢复代际、真实 principal/grants、真实容量或 timer-only IAM，这些 Candidate 证据仍是上线 Gate。请求摘要与命令结果历史 key 分别通过 `ROOT_COMMAND_REQUEST_DIGEST_VERIFICATION_KEYS_JSON`、`ROOT_COMMAND_RESULT_DECRYPTION_KEYS_JSON` 暂存，Inbox 延续 `ROOT_INBOX_CONTENT_DECRYPTION_KEYS_JSON`；三者均为最多 8 项的有界 JSON object，只供按持久 `keyId` 读/验，新写始终使用 current key。Key Inventory 要求 `MYSQL_DATABASE` 与 `DATABASE()` 一致，并通过 `ROOT_KEY_INVENTORY_RETIRED_KEY_IDS_JSON` 的精确 `{ "REQUEST_DIGEST": [], "COMMAND_RESULT": [], "INBOX_CONTENT": [], "NOTIFICATION_RECEIPT": [] }` 四域结构声明退休 key id；它以固定 10 秒 `max_execution_time` 在只读一致快照内对账 command/task-event/UnionID provenance/recipient-binding 请求摘要 key references，认证每条可解密受保护记录及 Inbox completion manifest keyed digest，并检查 notification attempt/transition provider receipt digest 的 scheme/key reference/shape。原始 provider receipt 不持久化，所以该域只能 metadata-only，不构成离线内容认证。设置与复原都精确回读，失败即销毁连接。legacy `sha256:v0` 仅保留 metadata 可见警告并在正常 replay 时升级；每个来源最多 1000 条，出现第 1001 条即 fail-close；报告不返回 secret、密文或明文。本轮使用真实 MySQL 8.0.43 引擎上的本机一次性合成数据探针，未使用真实会员数据；该 session-local 证明不等于 Candidate/生产平台身份、权限、容量、并发、全量 inventory 或 rotation 通过。

legacy 发布记录 Module 会通过 `GET /api/v1/admin/release-record` 汇总上线闸口、Adapter 校准、最近 Adapter 运行、数据仓库 Adapter、环境变量存在性、签字位和回滚动作，仅用于辅助评审。它不能替代 V1-T06 的 Candidate Manifest、Adapter Requirement/Attestation、Data Migration、UAT、Rollback、Signoff 与 Evidence Index 同源证据；当前 Release Evidence Contract Registry 也仅为 non-runtime Foundation。

## 主要 HTTP Interface 路径

- `POST /api/v1/auth/login`
- `GET /api/v1/privacy/notice`：无需登录的公开处理者、联系方式与保存期限说明；只返回用户应知信息。
- `GET /api/v1/privacy/health-consent`
- `POST /api/v1/privacy/health-consent`
- `GET /api/v1/user/state`
- `POST /api/v1/user/profile`
- `POST /api/v1/order/match`
- `POST /api/v1/checkin/start`
- `GET /api/v1/checkin/session`
- `POST /api/v1/checkin/submit`
- `GET /api/v1/checkin/records`
- `POST /api/v1/refund/apply`
- `GET /api/v1/refund/status`
- `GET /api/v1/coupon/status`
- `POST /api/v1/coupon/claim`
- `POST /api/v1/coupon/repurchase-click`
- `POST /api/v1/user/continue-daily`：兼容旧入口，当前版本返回拒绝，不开放任务完成后继续打卡。
- `GET /api/v1/daily/stats`
- `POST /api/v1/daily/submit`：兼容旧入口，当前版本返回拒绝，不新增日常打卡。
- `GET /api/v1/daily/history`
- `GET /api/v1/daily/trend`
- `POST /api/v1/event/track`
- `POST /api/v1/jobs/health-data-retention-cleanup`：健康敏感数据到期清理，默认 dry-run；execute 需要清理开关和稳定 `request_id`。
- `POST /api/v1/jobs/youzan-identity-reconcile`：UnionID 到有赞 `yz_open_id` 小批量对账，默认 dry-run；execute 需要独立开关和稳定 `request_id`。
- `GET /api/v1/admin/dashboard`
- `GET /api/v1/admin/launch-readiness`
- `GET /api/v1/admin/adapter-calibration`
- `GET /api/v1/admin/release-record`
- `GET /api/v1/admin/tasks`
- `POST /api/v1/admin/tasks/:taskId/complete`：需要 `REVIEW_RESOLVE` capability 与稳定 `X-Request-Id`。
- `POST /api/v1/admin/tasks/:taskId/resolve`：需要 `REVIEW_RESOLVE` capability 与稳定 `X-Request-Id`。
- `GET /api/v1/admin/users/:userId/detail`
- `POST /api/v1/admin/users/:userId/follow`
- `GET /api/v1/admin/external-adapters`
- `POST /api/v1/admin/external-adapters/run`
- `GET /api/v1/admin/external-samples/template`
- `POST /api/v1/admin/external-samples/preview`
- `POST /api/v1/admin/external-samples/import`
- `POST /api/v1/admin/external-status-mappings`
- `POST /api/v1/admin/refunds/:refundId/approve`：需要 `REFUND_APPROVE` capability 与稳定 `X-Request-Id`。
- `POST /api/v1/admin/coupons/:couponId/use`：需要 `COUPON_USE` capability 与稳定 `X-Request-Id`。

以上四类后台命令均以 `X-Request-Id` 做请求级幂等，并记录操作者、请求号、变更前后状态和原因审计。默认角色中，`operator` 可处理任务与核销券，`finance` 可审批退款并核销券，`viewer` 仅可读。

本地管理台：`/` 或 `/admin`。

注意：默认内存 Adapter 适合联调和演示。JSON 文件与 SQLite Adapter 不承接 CloudBase 内测或正式数据；多人、多实例和跨重启验证统一使用 MySQL Adapter。
