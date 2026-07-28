# ROOT 7日身体重启计划

基于 ROOT 试饮流程更新 PRD 的小程序与后台项目，已收敛为「线下获客 / 企业微信承接 / 有赞订单 / 物流送达 / 小程序打卡 / 运营待办 / 退款 / 复购转化」的演示闭环。

> 当前运行与包版本仍为 `0.5.13`。`v1.0.0` 只形成了本地、默认禁用的 Foundation Implementation；尚未创建 Candidate、体验版或正式发布授权，也未执行生产 DDL、真实订阅发送或版本提升。

## 项目结构

- `miniprogram/`：原生微信小程序，覆盖智能首页、注册问卷、活动介绍、订单匹配、7天打卡、Day4/Day8 问卷、Day6 复购礼、日常打卡、历史记录、免单申请、个人中心。
- `backend/`：Node.js HTTP Interface 与本地运营后台，路径统一走 `/api/v1/`，内置内存 Adapter、JSON 文件 Adapter、SQLite Adapter、MySQL Adapter 和测试。
- `backend/db/schema.sql`：当前是由一次性 MySQL `8.0.43` 空库执行 `001–057` 后生成、再由独立随机库回读验证一致的 52 表检查快照；它只证明本地 migration set 与生成文件一致，不是 Candidate 或生产迁移证据。
- `docs/v1.0.0_launch_gate_closure_tracker_2026-07-17.md`：v1.0.0 当前唯一 Gate 权威入口。
- `docs/release_readiness.md`：v0.5.x 历史上线验收证据；其中已关闭结论不得跨 v1 releaseId 复用。
- `docs/internal_test_release_gate_tracker_2026-06-29.md`：内测期间正式发布 Gate、反馈分流和新需求台账。
- `docs/external_adapter_samples.md`：有赞订单、物流状态、企业微信线索的真实样本字段规格。
- `docs/adapter_calibration_playbook.md`：真实账号接入前的校准顺序、配置表和回滚判断。
- `docs/release_record_template.md`：发布记录、签字位、证据检查和回滚动作模板。

## 运行后台

```bash
cd /Users/rijay/Documents/Root/root_seven_day_checkin/backend
npm run dev
```

后台 API 默认运行在 `http://127.0.0.1:8787`。`http://127.0.0.1:8787/admin` 会在 `admin/dist` 存在时加载 Element Plus Admin；`http://127.0.0.1:8787/admin-legacy` 保留旧静态后台回退。

需要生成 Element Plus Admin 产物时：

```bash
cd /Users/rijay/Documents/Root/root_seven_day_checkin
npm run admin:build
npm run deploy:prepare-admin
```

需要重启后保留本地灰度数据时：

```bash
ROOT_STORE_FILE=/Users/rijay/Documents/Root/root_seven_day_checkin/backend/data/dev-store.json npm run dev
```

需要用 SQLite 文件做单实例上线前验证时：

```bash
ROOT_SQLITE_FILE=/Users/rijay/Documents/Root/root_seven_day_checkin/backend/data/root-checkin.sqlite npm run dev
```

云托管正式环境需要使用 MySQL Adapter：

```bash
ROOT_STORE_ADAPTER=mysql \
MYSQL_ADDRESS=10.11.103.164:3306 \
MYSQL_USERNAME=myroot_app \
MYSQL_PASSWORD=****** \
MYSQL_DATABASE=myroot-prod-d5gl3gzg7115f149a \
MYSQL_CONNECTION_LIMIT=8 \
MYROOT_V1_RUNTIME_CONNECTION_LIMIT=3 \
MYROOT_CLOUDRUN_MAX_INSTANCES=2 \
MYSQL_SERVER_MAX_CONNECTIONS=100 \
MYROOT_MYSQL_CONNECTION_HEADROOM=20 \
MYROOT_MYSQL_CAPACITY_EVIDENCE_REF=受控容量证据引用 \
MYSQL_CONNECT_TIMEOUT_MS=10000 \
ROOT_PHONE_HMAC_KEY=****** \
ROOT_COMMAND_REQUEST_DIGEST_KEY=****** \
ROOT_COMMAND_REQUEST_DIGEST_KEY_ID=command-request-digest-v1 \
ROOT_COMMAND_REQUEST_DIGEST_VERIFICATION_KEYS_JSON='{}' \
ROOT_COMMAND_RESULT_ENCRYPTION_KEY=****** \
ROOT_COMMAND_RESULT_KEY_ID=command-result-v1 \
ROOT_COMMAND_RESULT_DECRYPTION_KEYS_JSON='{}' \
ROOT_INBOX_CONTENT_ENCRYPTION_KEY=****** \
ROOT_INBOX_CONTENT_KEY_ID=inbox-content-v1 \
ROOT_INBOX_CONTENT_DECRYPTION_KEYS_JSON='{}' \
ROOT_NOTIFICATION_PROVIDER_RECEIPT_HMAC_KEY=****** \
ROOT_NOTIFICATION_PROVIDER_RECEIPT_HMAC_KEY_ID=notification-receipt-v1 \
ROOT_KEY_INVENTORY_RETIRED_KEY_IDS_JSON='{"REQUEST_DIGEST":[],"COMMAND_RESULT":[],"INBOX_CONTENT":[],"NOTIFICATION_RECEIPT":[]}' \
ROOT_ADMIN_TOKEN=****** \
npm run dev
```

MySQL Adapter 启动时会先校验版本化 HMAC 请求摘要、命令结果 AES-256-GCM 保护与通知 provider receipt HMAC 元数据，再取得数据库级迁移锁并执行 `backend/db/migrations`；Inbox Core 则在取得 MySQL 连接前独立校验 Inbox 内容 AES-256-GCM 保护。命令结果使用冻结的 `A256GCM:v1` 持久化策略：受保护与本地兼容路径都限制为 131072 bytes（128 KiB）序列化明文/密文，canonical base64 上限为 174764 characters，完整 envelope 上限为 184320 bytes；只有 `protection=A256GCM` 被保留为 envelope 判别符，普通业务字段名不会被误判。超限稳定返回 `COMMAND_RESULT_PLAINTEXT_TOO_LARGE`；decode 在认证前完成 descriptor-safe exact snapshot、canonical base64 与大小检查，认证后的非法 UTF-8 也 fail-close。每个业务请求用 `root_store_snapshot.revision` 行锁保护跨实例写入，并在同一事务内同步核心关系表。应用账号不需要创建数据库，但必须拥有目标库的建表、索引、变更表结构和数据读写权限。四域 current key 均须至少 32 UTF-8 字节、无首尾空白且具备足够字符多样性，key id 均须使用持久化安全格式；只能由正式环境密钥配置注入。请求摘要、命令结果和 Inbox 的历史 key 分别进入有界 verification/decryption keyring，仅按持久 `keyId` 读/验；所有新写入始终使用 current key，unknown/retired fail-close。`NOTIFICATION_RECEIPT` 只盘点 provider receipt digest 的 scheme/key reference/shape；原始 receipt 按设计不持久化，因此本地 inventory 不能声称离线认证其内容。正式入口会在连接 Store 前校验已接入 Module 的保护配置，`GET /ready` 同时验证连接、迁移版本、当前修订号、命令请求摘要与命令结果保护状态；Inbox worker 尚未接入正式运行时，因此其 Registry、保护状态与 worker readiness 仍是上线 Gate。

### v1.0.0 本地 Foundation 状态

以下 Module 已落盘并纳入本地验证，但其 Interface 均不构成正式运行时或发布授权：

| Module | 本地开关 / 状态 | 当前限制 |
| --- | --- | --- |
| Inbox Worker Harness | `MYROOT_INBOX_WORKER_HARNESS_ENABLED=false` | 仅由受控 Runtime cycle 调用；不接正式流量 |
| Governed Replay Control | `MYROOT_INBOX_REPLAY_CONTROL_ENABLED=false` | 仅受治理选择与授权记录；无自动调度 |
| Inbox Shadow Replay Runner | `MYROOT_INBOX_SHADOW_REPLAY_RUNNER_ENABLED=false` | 只写 shadow projection；无 Outbox、无网络 |
| Outbox→Inbox Bridge Harness | `MYROOT_OUTBOX_INBOX_BRIDGE_ENABLED=false` | 仅由受控 Runtime cycle 调用；无正式告警接收端或流量接线 |
| v1 Runtime Orchestration Foundation | `MYROOT_V1_RUNTIME_ORCHESTRATOR_ENABLED=false`；kill-switch 默认 engaged | 仅由 Runtime Control 执行受控 one-shot；每个协调/子 Module 连接先核对实际目标库，历史 dead-letter/companion 三锚点与 postflight 均 fail-close；无 Candidate 多实例证明 |
| v1 Runtime Control Plane | `MYROOT_V1_RUNTIME_CONTROL_PLANE_ENABLED=false`；`ROOT_V1_RUNTIME_READY_REQUIRED=false` | `032/033` 持久化 cycle/alert、DB-time lease/generation fencing、30 秒续租、默认 preview 的 HTTP Interface 与专属 CloudBase timer scheduler 已落盘；`/ready` 只读持久证明，不执行 inventory/worker；调度配置未部署、无 Candidate 运行、正式告警接收端或发布授权 |
| Notification Delivery Core | `MYROOT_NOTIFICATION_DELIVERY_FOUNDATION_ENABLED=false` | 关系型 grant/job/attempt/transition、只读 `inspectSendAttempt` 与 replay/ACK-unknown 收敛已落盘；无真实微信发送，且尚无持久 provider-call lease/owner/expiry/generation fencing |
| Migration Execution Foundation | `MYROOT_MIGRATION_EXECUTION_FOUNDATION_ENABLED=false` | 仅 `LOCAL_ISOLATED` 合成 `TASK_SHARE` scope；无网络、Outbox、生产执行或运行时 reversal |
| v1 Route Negotiation Foundation | `MYROOT_V1_ROUTE_NEGOTIATION_ENABLED=false` | `runtimeIntegrated=false`；不发送 v1 headers |
| Release Evidence Contract Registry | `NON_RUNTIME_FOUNDATION_CONTRACT` | 无运行开关；Candidate/runtime/releaseId 均未授权 |
| Key Inventory Readiness Foundation | `ROOT_KEY_INVENTORY_READINESS_ENABLED=false` | 仅目标库绑定的只读快照：固定 10 秒 statement deadline 并精确回读/复原，核验 `REQUEST_DIGEST / COMMAND_RESULT / INBOX_CONTENT / NOTIFICATION_RECEIPT` 四域；REQUEST_DIGEST 同时覆盖 command、task-event、UnionID provenance 与 legacy/v1 recipient-binding HMAC 引用，receipt 域覆盖 attempt/transition 的 digest metadata。四域 current/retired/unknown 与前三域 previous 分类、schema/index/enforced CHECK、全状态 envelope metadata 均 fail-close，并认证每条可解密受保护记录；每来源最多 1000 条，出现第 1001 条即 fail-close；receipt 因原文不持久化仅能 metadata-only，且当前没有 previous-key keyring；由受控 cycle 运行，`/ready` 只读其持久 attestation；legacy `sha256:v0` 只做 metadata 可见告警并在正常 replay 时升级；无 Candidate inventory/rotation 证明 |

这些 Implementation 不关闭 PRD baseline 具名签署、真实 AppID↔AppCode/微信身份、身份与订阅绑定的混合版本发布兼容、真实 MySQL 多实例、密钥轮换、UED handoff、健康与隐私内容、活动运营、订阅真机送达、持久 provider-call 所有权、权威 Adapter Requirement Registry、远端 CI 或正式发布 Gate。

Runtime Orchestration 只有在 orchestrator、Bridge 与 Worker 三个开关均为精确 `true`，`MYROOT_V1_RUNTIME_KILL_SWITCH=DISENGAGED`，`MYROOT_V1_RUNTIME_OWNER` 为稳定具名 owner，且目标与容量检查通过时，才允许一次 one-shot。Store 将 MySQL 连接预算拆为六项：普通请求 main pool（`MYSQL_CONNECTION_LIMIT`）、Runtime Orchestration pool（`MYROOT_V1_RUNTIME_CONNECTION_LIMIT`）、Registrar pool（`MYROOT_V1_RUNTIME_ALERT_REGISTRAR_MYSQL_CONNECTION_LIMIT`）、固定 1 连接的 Registrar heartbeat pool、Worker pool（`MYROOT_V1_RUNTIME_ALERT_WORKER_MYSQL_CONNECTION_LIMIT`）和 Inspector pool（`MYROOT_V1_RUNTIME_ALERT_INSPECTOR_MYSQL_CONNECTION_LIMIT`）。Runtime Orchestration pool 必须为 `3..64`，三类告警角色 pool 分别必须为 `1..64`；连接取得仍受各 Module 的 fail-close deadline 约束。生产环境矩阵按 `(MYSQL_CONNECTION_LIMIT + MYROOT_V1_RUNTIME_CONNECTION_LIMIT + MYROOT_V1_RUNTIME_ALERT_REGISTRAR_MYSQL_CONNECTION_LIMIT + 1 + MYROOT_V1_RUNTIME_ALERT_WORKER_MYSQL_CONNECTION_LIMIT + MYROOT_V1_RUNTIME_ALERT_INSPECTOR_MYSQL_CONNECTION_LIMIT) * MYROOT_CLOUDRUN_MAX_INSTANCES + MYROOT_MYSQL_CONNECTION_HEADROOM <= MYSQL_SERVER_MAX_CONNECTIONS` 计算容量，并要求 `MYROOT_MYSQL_CAPACITY_EVIDENCE_REF`。Registrar、Worker、Inspector 的 username、预期 `CURRENT_USER()` 和凭据必须互异，且角色 username/凭据不得复用 main pool；这些配置校验和本地算式不等于真实容量或最小权限已经验收。

Runtime Control Plane 以 `scheduleId + scheduledAt + inputDigest` 固定 cycle identity，持久化 claim/finalize/alert，使用 DB time、owner、generation 和独立 heartbeat lease 防止跨实例重复执行；heartbeat 失败不写成功终态，由 stale recovery 收敛。专属 `myroot-v1-runtime-scheduler` 只接受 CloudBase timer `v1_runtime_cycle`，由规范化 `event.Time` 生成完全相同的 `scheduleId=requestId`，调用 HTTPS Runtime route 后强制核对响应 identity；它默认 preview，execute 还要求显式配置、专属权限与运行授权。`cloudbaserc.json` 和 Job Manifest 只是待发布配置，不代表 timer 已部署或启用。`GET /ready` 只读取 ledger attestation，避免在探针路径执行 Key Inventory 或 worker。

用于 Candidate 的 Runtime scope 与容量证据必须共同绑定逻辑 environment id、有效 MySQL host/port/user/database、CloudBase environment id、`MYROOT_V1_RUNTIME_TARGET_GENERATION`、Cloud Run `K_REVISION` 或显式 `ROOT_RELEASE_ARTIFACT_DIGEST`、main/Runtime Orchestration/Registrar/Registrar heartbeat/Worker/Inspector 六项连接限额、实例/服务器/headroom 容量输入，以及当前/历史/退休 key 配置指纹；任一绑定输入变化都不得复用旧 SAFE attestation。协调连接及子 Module 连接还必须以 `DATABASE()` 证明目标库，告警数据库连接还要核对预期 `CURRENT_USER()`。环境变量进入 scope 只证明运行时读取到的声明发生联动，不会自证构建摘要来源、平台 environment、克隆/恢复代际、真实 principal/grants、真实容量、timer-only IAM 或 Candidate 运行证据；这些仍须由受控发布证据关闭。advisory lock 只提供 non-overlap coordination，业务写 fencing 由持久 ledger 的 generation/lease 承担。Key Inventory 使用固定 10 秒 `max_execution_time`，逐连接精确回读并在结束时复原为 0，任一设置/复原失败都会销毁连接；它认证每条受保护记录及 Inbox completion manifest keyed digest，每个来源硬上限 1000 条，超限即 fail-close。报告不返回 secret、密文或明文。本轮一次性 MySQL 8.0.43 合成探针只证明本地目标库漂移、Bridge 三锚点与密文见证；未使用真实会员数据，不能替代 Candidate 的平台身份、权限、容量、并发、全量 inventory 或 rotation 证据。

如需区分多名后台操作人，可用 `ROOT_ADMIN_TOKENS` 替代单口令，操作记录会写入对应 `operatorId`：

```json
{
  "ops-a": { "token": "******", "role": "operator" },
  "ops-b": { "token": "******", "role": "operator" },
  "admin": { "token": "******", "role": "admin" }
}
```

Element Plus Admin 会通过 `GET /api/v1/admin/me` 读取当前 operator、role 和 capabilities，并按能力隐藏左侧菜单；正式环境建议至少核对 viewer、finance、operator、admin 四类 token，并确认 `/admin/assets/*.js` 返回 200。backend-only 云托管部署会读取 `backend/public/admin-dist`，如需自定义路径可设置 `ROOT_ADMIN_DIST_DIR`。

后台启动后可生成发布校准报告：

```bash
npm run calibrate -- --base-url http://127.0.0.1:8787 --target production --strict
```

需要核对生产环境变量矩阵时：

```bash
npm run production-env -- --target production
```

需要核对 CloudBase 定时 Job 发布配置时：

```bash
npm run jobs:manifest -- --base-url https://myroot-api-273748-8-1437260454.sh.run.tcloudbase.com --campaign ROOT_7D_RESET --strict
```

需要检查 CloudBase 身份 header 透传时，本地可先验证后台探针路由形状；真实 openid/unionid 必须在 CloudBase 请求中确认：

```bash
curl -s "http://127.0.0.1:8787/api/v1/admin/cloudbase-identity-probe" \
  -H "X-WX-OPENID: local-openid-for-route-shape" \
  -H "X-WX-UNIONID: local-unionid-for-route-shape"
```

拿到真实导出文件后可先跑样本准入：

```bash
npm run samples -- --base-url http://127.0.0.1:8787 --mode preview --youzan-file ./samples/youzan.csv
npm run adapters -- --base-url http://127.0.0.1:8787 --source youzan --mode preview --limit 1
```

迁移到 MySQL 前先校验当前快照；正式写入前建议先 dry-run：

```bash
npm run store:verify -- --json ./data/dev-store.json
npm run store:migrate:mysql -- --json ./data/dev-store.json --dry-run
npm run store:migrate:mysql -- --json ./data/dev-store.json
```

## 运行小程序

1. 用微信开发者工具打开 `/Users/rijay/Documents/Root/root_seven_day_checkin/miniprogram`。
2. 使用测试 AppID，或保留 `touristappid`。
3. 本地联调时关闭合法域名校验，项目已在 `project.config.json` 中设置 `urlCheck: false`。
4. 登录链路始终使用微信手机号授权；开发调试入口不进入发布包。

## v0.5.13 / 7日计划已覆盖范围（非 v1.0.0 验收）

- 全局状态机：`GUEST / UNREGISTERED / REGISTERED_IDLE / CHECKIN_ACTIVE / CHECKIN_COMPLETED / CHECKIN_FAILED / DAILY_USER`。
- Flow View Presenter Module：首页主动作由 `flowView` 和 `homeView` 提供。
- 身份和订单：收货手机号匹配有赞订单，订单匹配不自动启动打卡。
- 物流前置：只有 `DELIVERED` 后才能启动 Day1。
- 打卡：7天进度、今日提交、补卡时间窗、断卡审核、历史记录。
- 问卷：Day4 中期问卷不阻塞 Day5，Day8 收尾问卷是退款前置条件。
- 免单：完成7天并提交 Day8 后生成人工退款工作项，后台可审核通过。
- 优惠券：Day6 触发复购礼，支持领取、核销和复购点击观察。
- 日常模式：退款完成或点击继续打卡后进入 DAILY_USER，展示累计/连续/最长连续、趋势图和复购入口。
- 后台：Summary、运营待办、用户详情、反馈聚合、退款队列、优惠券转化。
- 真实样本导入：有赞订单、物流状态、企业微信线索可先预览校验，再导入灰度数据仓库；支持 JSON、CSV 和表格复制文本，并沉淀取样评审台账。
- 自动匹配：用户微信授权手机号与有赞收货手机号唯一命中时自动绑定；多订单或多用户命中进入后台人工冲突待办。
- 每日导入：后台订单页支持有赞订单 CSV 与物流状态 CSV 预览、批次锁定、确认写入和冲突处理。
- 数据稳定：MySQL Store Adapter 支持快照导入、导出和校验，后台访问可通过 `ROOT_ADMIN_TOKEN` 或 `ROOT_ADMIN_TOKENS` 做最低保护。
- 上线校准：上线闸口、Adapter 校准、发布记录、Element Plus 开发发布页、菜单级权限、Element Plus Admin 主入口、backend-only Admin build 部署包、CloudBase 身份透传探针和命令行校准报告会把真实发布阻塞项集中展示。

## 验证

```bash
npm run verify --prefix /Users/rijay/Documents/Root/root_seven_day_checkin
npm test --prefix /Users/rijay/Documents/Root/root_seven_day_checkin/backend
npm run check --prefix /Users/rijay/Documents/Root/root_seven_day_checkin/miniprogram
npm run v1:foundation:check --prefix /Users/rijay/Documents/Root/root_seven_day_checkin
npm run db:schema-snapshot:verify --prefix /Users/rijay/Documents/Root/root_seven_day_checkin
```

`npm run verify` 会执行 JavaScript 语法检查、后端测试、小程序校验，并启动临时 SQLite 后台做 HTTP Interface 冒烟。`npm run v1:foundation:check` 同时验证默认禁用的本地 Foundation、Fact Authority Registry 与离线 schema provenance；`db:schema-snapshot:verify` 还需要专用的一次性 MySQL 8.0，且该实例必须只存在 `myroot_schema_snapshot_sandbox_marker` 这一个非系统 schema，并且 marker schema 自身为空，命令才会在随机数据库中重跑全部 migration。仅使用 localhost 不足以通过，避免误连本地生产隧道。以上均不关闭 M1、V1-Txx 或正式发布 Gate。

2026-07-20 当前本地基线：Backend 共 1317 tests，1308 PASS / 9 SKIP / 0 FAIL；9 个 SKIP 均为默认关闭的真实 MySQL 分支。历史一次性授权只完整实证 migration 001～057。Attempt 9 使用 R9 包得到 12 PASS / 1 FAIL / 0 SKIP 后立即停止并清理；R9 nonce 已消费，schema snapshot 与最终 verify 未运行。根因是夹具 SLO profile 漂移（`BLOCKER / 60`，正式值为 `BLOCKER_IMMEDIATE / 300`）；源头夹具已引用唯一 Policy Module，并新增 immutable migration 066。R10 未执行且已被取代；R11 packet SHA=`d0369e06f7fb57a2085cd5a567bf775370fe0ae2a43178179465a435e7aa3016`、nonce=`dd1a2ef2-8687-4509-a799-0960748cb6fd`，绑定 688 个执行输入、Node/npm 工具链、四阶段精确 argv、mutable-output 失败回滚与结构化 outcome，合同 44/44、Foundation PASS。R11 未授权、未执行；未授权调用在 Docker 前拒绝，受管容器 0、nonce marker 0。微信订阅发送现仅允许官方精确 origin/path，并在取 token 前、网络 Seam、服务器启动与生产环境矩阵四层 fail-close；聚焦测试 103/103 PASS。14 Gate Readiness Validator 仍派生 14 OPEN / 3 HARD BLOCKER / 0 CLOSED。最近最终离线检查为 `17/18`，覆盖 450 个 JavaScript 文件、66 个 immutable migration 文件、1317 个 Backend tests、Production env matrix 与 HTTP Interface smoke，唯一失败是 committed `schema.sql` 仍绑定 001～057。运行/包版本仍为 `0.5.13`；这些本地结果不关闭远端 CI、Candidate/生产或真实微信送达 Gate。

当前运行版本 `0.5.13` 默认使用内存 Adapter，适合本地演示；JSON 文件和 SQLite 只保留为本地排查 Adapter。2026-07-18 已在绑定随机 `127.0.0.1` 端口的一次性 MySQL `8.0.43`（镜像 digest `sha256:3e646bcda0d9448ffa3d2024eef04e1bca95528ec19b9e8b76749da9d97d4a10`）空库执行完整 `001–057`：57 个 migration marker、52 张表；生成快照 SHA-256 为 `e84fe654b674981917c472cc73593657dd6a9189dd32b736ff1bae895be7a7c3`，migration-set digest 为 `fa98e2432fc7210615d5508597d93c4203dc414a2636d633eb5e12c63a053b27`，schema body digest 为 `e7290b12d0aa2d2455d6abff50f7c1af8dfd335188ce200a348aa27dab32acb9`；独立随机库 verify 结果 `matches=true`。Activity generation 037/038、Activity P0 039～045、Runtime Ledger 与 Identity/recipient-binding 049～057 四组真实引擎集成测试各 `2/2 PASS`；049～057 采用单表 stage/backfill/enforce 迁移，历史 UnionID 与无冻结 recipient binding 的 grant 均 fail-close 到人工复核语义。随机数据库、容器与临时 `127.0.0.1` 监听均已删除，未读取真实会员数据。这些本地证明不代表 CloudBase Candidate、生产迁移、多实例恢复、容量、最小权限、旧实例 drain/rollback compatibility 或业务 cutover 已验证。本轮团队内测若连接 CloudBase `myroot-prod-d5gl3gzg7115f149a / myroot-api`，数据必须写入 CloudBase MySQL。云托管需设置 `ROOT_STORE_ADAPTER=mysql`、六池连接预算变量、Registrar/Worker/Inspector 三类独立 MySQL 角色配置和后台口令；受保护运行时必须将 `ROOT_ADMIN_JOB_ROUTE_TOKENS` 配成“精确 Job pathname -> 独立轮换列表”并设置 `ROOT_REQUIRE_SCOPED_JOB_TOKENS=true`，缺少精确路由 token 时 fail-close，不回落 legacy 或通用后台 token；仅 local/test 兼容路径可在显式关闭 strict 时使用 `ROOT_ADMIN_JOB_TOKEN(S)`。该本地 token Interface 只收敛泄露半径，不代表 CloudBase timer-only IAM 已配置或验收；专属 Runtime scheduler 仍须保持 timer-only、默认 preview 并取得独立部署/IAM 证据。v1 正式上线前必须以 `docs/v1.0.0_launch_gate_closure_tracker_2026-07-17.md` 为权威入口；`docs/release_readiness.md` 只供核对 v0.5.x 历史证据。在全部 v1 Gate 关闭前，release 状态保持 `NOT AUTHORIZED`。
