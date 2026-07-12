# CloudBase 生产环境与 MySQL Store 决策

状态：P0/P1 已完成 CloudBase 配置、部署与实测；正式发布外部 Gate 单独跟踪
决策日期：2026-07-11
适用范围：myRoot 会员小程序重构生产发布

## 1. 决策

正式生产 Store 选择：

```bash
ROOT_CLOUDBASE_STORE_DECISION=MYSQL_ON_CLOUDBASE
ROOT_STORE_ADAPTER=mysql
```

不选择 `CLOUDBASE_DATABASE`，因为当前代码没有 CloudBase Database Store Adapter；选择该项会被 CloudBase Store Gate 阻塞，直到新增对应 Adapter、迁移验证和回滚演练。

不选择 `JSON_FILE_GRAY`、`ROOT_STORE_FILE` 或 `ROOT_SQLITE_FILE` 作为正式生产 Store。它们只适合演示、内部灰度或单实例验证；容器重启、多实例扩缩容、发布回滚和审计留档都会有风险。

## 2. 已知 CloudBase 信息

当前小程序配置已拆分为内测与正式：

```bash
ROOT_PUBLIC_BASE_URL=https://myroot-api-273748-8-1437260454.sh.run.tcloudbase.com
ROOT_JOB_BASE_URL=https://myroot-api-273748-8-1437260454.sh.run.tcloudbase.com
ROOT_CLOUDBASE_ENV_ID=myroot-prod-d5gl3gzg7115f149a
ROOT_CLOUDBASE_REGION=ap-shanghai
```

微信开发者工具已完成腾讯云 CloudBase 环境绑定。本轮内测期间，开发版、体验版和正式版统一调用 `myroot-prod-d5gl3gzg7115f149a` 中的 `myroot-api`，由 `__wxConfig.envVersion` 继续区分微信运行版本。旧微信侧环境 `myroot-test-d4gclpzxx286deda6` 不再作为本轮数据源；正式发布前若恢复独立测试环境，只需替换小程序环境配置和对应 secret，不改业务 Interface。

## 3. 生产环境变量清单

以下变量应写入 CloudBase 环境变量或密钥管理，不能写入仓库。

```bash
PORT=80

WECHAT_APPID=<正式 myRoot 小程序 AppID>
WECHAT_APPSECRET=<正式 myRoot 小程序 AppSecret>

ROOT_PUBLIC_BASE_URL=https://myroot-api-273748-8-1437260454.sh.run.tcloudbase.com
ROOT_ADMIN_TOKEN=<后台访问口令>
ROOT_JOB_BASE_URL=https://myroot-api-273748-8-1437260454.sh.run.tcloudbase.com
ROOT_ADMIN_JOB_TOKEN=<定时任务专用口令>

ROOT_STORE_ADAPTER=mysql
MYSQL_ADDRESS=<CloudBase MySQL host:port>
MYSQL_USERNAME=<CloudBase MySQL username>
MYSQL_PASSWORD=<CloudBase MySQL password>
MYSQL_DATABASE=myroot-prod-d5gl3gzg7115f149a
MYSQL_CONNECTION_LIMIT=8
MYSQL_CONNECT_TIMEOUT_MS=10000

ROOT_CLOUDBASE_STORE_DECISION=MYSQL_ON_CLOUDBASE
ROOT_CLOUDBASE_ENV_ID=myroot-prod-d5gl3gzg7115f149a
ROOT_CLOUDBASE_REGION=ap-shanghai
ROOT_CLOUDBASE_STORE_BACKUP_PLAN=发布前快照+每日备份
ROOT_CLOUDBASE_STORE_ROLLBACK_PLAN=按发布前快照回滚，保留 MANUAL_SAMPLE 与后台人工入口
ROOT_CLOUDBASE_STORE_PROOF=<CloudBase 控制台截图/工单/发布记录引用>
```

可选但建议同批确认：

```bash
ROOT_ALERT_CAMPAIGN_ID=ROOT_7D_RESET
ROOT_LIFECYCLE_SETTLEMENT_CAMPAIGN_ID=ROOT_7D_RESET
ROOT_LIFECYCLE_EXPORT_CAMPAIGN_ID=ROOT_7D_RESET
ROOT_LIFECYCLE_EXPORT_SENSITIVITY=MASKED
ROOT_LIFECYCLE_EXPORT_RETENTION_DAYS=7
```

## 4. MySQL Store 行为

当前 MySQL Adapter 会在启动时：

1. 读取 `MYSQL_ADDRESS` 或 `MYSQL_HOST`、`MYSQL_USERNAME`、`MYSQL_PASSWORD`、`MYSQL_DATABASE`。
2. 建立连接池；默认上限 8，连接超时 10 秒。
3. 使用数据库级迁移锁顺序执行 `backend/db/migrations`，并校验已执行文件的 checksum。
4. 以 `root_store_snapshot` 的 `revision` 行锁串行化跨实例写入，响应只在事务提交后返回。
5. 在同一事务内同步用户、身份、活动、任务、问卷、提醒、结算、奖励和人工审核等核心关系表。
6. 后端启动日志应显示 `Store adapter: mysql(host:port/database)`；`GET /ready` 应返回 MySQL、迁移版本和修订号。

Adapter 不再尝试创建数据库。必须先在 CloudBase 选择已存在的数据库，并确认应用账号具备该库的建表、索引、变更表结构和数据读写权限。当前快照是兼容聚合读模型，核心关系表是同事务查询与审计事实；后续可以逐个把业务 Module 的读写 Implementation 迁到关系表，而不改变小程序 Interface。

## 5. 验证步骤

在 CloudBase 环境变量录入后，先不要直接开启全部定时执行，按以下顺序验证。

### 5.1 环境矩阵

```bash
npm run production-env --prefix backend -- --target production
```

通过标准：

1. `生产数据仓库` 为 `PASS`。
2. `CloudBase Store 决策` 为 `PASS`。
3. `CloudBase 定时 Job` 为 `PASS`。
4. 剩余阻塞只应来自有赞、企微、物流、Root 会员中心跳转或外部证明项。

### 5.2 MySQL 迁移、连接与快照

```bash
npm run db:migrate --prefix backend
npm run store:verify --prefix backend -- --mysql
```

迁移命令和应用启动都会幂等执行迁移；多实例同时冷启动由数据库级迁移锁保护。首次空库会建立初始快照和核心关系表，不要求导入旧数据。

### 5.3 后端健康

```bash
curl -s https://myroot-api-273748-8-1437260454.sh.run.tcloudbase.com/health
curl -s https://myroot-api-273748-8-1437260454.sh.run.tcloudbase.com/ready
```

通过标准：两者都返回 HTTP 200 和 `code=0`；`/ready` 中 `store.kind=mysql`、`store.migrationVersion=002_core_relational.sql` 且 `revision` 为非负整数。

### 5.4 发布记录

```bash
npm run release:evidence --prefix backend -- \
  --base-url https://myroot-api-273748-8-1437260454.sh.run.tcloudbase.com \
  --target production \
  --strict
```

通过标准：

1. `summary.cloudbaseStoreStatus` 不再是 `BLOCKED`。
2. `evidence.cloudbaseStoreReadiness.selectedDecision` 为 `MYSQL_ON_CLOUDBASE`。
3. `currentStoreAdapterKind` 为 `mysql`。
4. 发布证据包不包含 token、secret、openid、unionid 或手机号原文。

## 6. CloudBase Job 策略

当前 Manifest 包含 10 个 Job：

1. `adapter_retry_due`
2. `operational_alerts`
3. `checkin_reminders`
4. `wework_touch_due`
5. `lifecycle_settlement_due`
6. `lifecycle_settlement_cleanup`
7. `lifecycle_users_export`
8. `lifecycle_user_exports_delivery_retry`
9. `lifecycle_user_exports_cleanup`
10. `health_data_retention_cleanup`

上线前先生成 Manifest：

```bash
npm run jobs:manifest --prefix backend -- \
  --base-url https://myroot-api-273748-8-1437260454.sh.run.tcloudbase.com \
  --campaign ROOT_7D_RESET \
  --strict
```

首次创建触发器时，所有 Job 先用 dry-run 参数运行一轮；只有 dry-run 输出符合预期后，才切换 execute。

## 7. 发布证明

CloudBase + MySQL Store 这一项的生产证明至少包含：

1. CloudBase 环境 ID 与地域截图或控制台链接引用。
2. 云托管服务环境变量截图或变更单引用，敏感值打码。
3. MySQL 实例、数据库名、备份策略截图或工单引用。
4. 后端启动日志，证明 Store adapter 为 `mysql`。
5. `production-env` 报告，证明 Store 与 CloudBase Store Gate 为 `PASS`。
6. `release:evidence` 证据包留档，证明 `cloudbaseStoreStatus` 不再阻塞。

证明引用写入：

```bash
ROOT_CLOUDBASE_STORE_PROOF=<脱敏证明引用>
```

或通过 Element Plus Admin「开发发布」页随发布证据包留档。

## 8. 回滚

若 MySQL Store 切换后出现连接失败、写入异常或字段快照异常：

1. 暂停 CloudBase Job 的 execute 模式。
2. 保留当前 MySQL 数据库，不手工删表。
3. 优先回滚到上一云托管部署；如事务数据异常，再使用发布前数据库备份恢复快照和核心关系表，不能只恢复其中一边。
4. 暂停真实有赞、企微、物流 Adapter，改用 `MANUAL_SAMPLE` 和后台人工入口。
5. 重新运行 `npm run store:verify --prefix backend -- --mysql` 和 `npm run release:evidence --prefix backend -- --target production --strict`。

不得把 `ROOT_STORE_FILE` 或 `ROOT_SQLITE_FILE` 作为正式回滚目标；它们只能用于临时排查或内部灰度。

## 9. 2026-07-11 P0/P1 验证记录

本地使用 MySQL 8.0、两个独立后端进程和 8 连接池完成真实事务验证：

1. 空库首次迁移创建 24 张表，`schema_migrations` 记录 `001_store_snapshot.sql` 与 `002_core_relational.sql`；第二次执行 `applied=[]`。
2. 两个进程同时对另一空库执行迁移，两个进程都成功退出；一个应用 2 个版本，另一个在迁移锁后读取到 2 个版本且不重复执行。
3. 首轮 20 并发登录曾暴露快照浅拷贝缺陷：请求返回成功但修订号和关系表不增加。根因是运行态与 `before` 快照共享数组引用，变化检测误判为无变化。
4. `replaceStoreData` 改为深拷贝并增加别名共享回归测试后，两个后端实例各承接 10 个并发请求，20/20 返回成功；修订号连续增加 20，快照保留 20 个用户，`root_user=20`、`user_contact_method=20`、`user_lifecycle_event=40`。
5. 交换实例重复相同 20 个 `X-Request-Id` 后，仍返回原 20 个 token，修订号、用户和生命周期事件均不增加。
6. 停止两个后端、重启 MySQL、再启动后端后，20 个用户和关系表数量保持一致，重启前 token 可继续访问 `GET /api/v1/user/state`。
7. 使用 CloudBase 身份 header 形状走通 unionid 登录、活动加入、7 次打卡、完成后禁止第 8 次打卡、问卷和结算；关系表回读包含微信身份 1、任务事件 8、结算 1、奖励 2、奖励投递 1、人工复核 1，同一结算请求重复执行仍返回同一记录。
8. 配置正式打卡提醒模板后，模板、订阅和次日 Job 均同步到关系表；Job dry-run 返回 `DRY_RUN_READY`，页面为 `pages/tasks/index`、运行版本为 `trial`、模板字段为 `thing1/thing2/thing3`，未输出真实 openid。
9. 20 名用户跨两个实例并发执行“加入活动 + Day1 打卡”共 40 次业务写入，647ms 内全部成功；快照与关系表一致为参与者 22、任务事件 29、进度快照 22、提醒 Job 21，任务与提醒幂等键重复组均为 0。交换实例重复同一批 40 个请求后，修订号保持 90、各表数量不变。
10. 修正启动投影后，先后启动两个实例均从修订号 90 读取 22 个用户，启动完成后修订号仍为 90；启动不再用早期快照覆盖最新数据。两个 Store 同时持有修订号 90 时，第一个 `save()` 成功写到 91，第二个明确返回 `STORE_REVISION_CONFLICT`，数据库只保留先提交事件。
11. 以只包含 `users=[]`、schema version 1、revision 7 的旧快照启动后，Store 自动补齐当前所有集合、同步核心关系表，并把 schema version 更新到 2、revision 更新到 8；兼容归一化不再只停留在内存。
12. 修复后执行 `npm run verify`，JavaScript、后端测试、生产依赖审计、Element Plus Admin、小程序检查和 HTTP Interface 冒烟合计 10/10 通过。
13. CloudBase MySQL 应用账号 `myroot_app` 已具备投影清理所需的 `DELETE`，最终权限为 `SELECT / INSERT / UPDATE / DELETE / CREATE / ALTER`；未开放 `DROP`、用户管理或转授权。当前授权仍作用于 `*.*`，后续需单独确认后收敛至 myRoot 生产库。
14. 数据库自动暂停已关闭，自动备份保留 7 天；云托管副本策略已恢复为最小 1、最大 2，连接池上限 8、连接超时 10 秒。
15. Cloud Run 生效版本已推进到 `012` 并承接 100% 流量；`/health`、`/ready`、`/admin` 和 Admin 静态资源均返回 HTTP 200，MySQL 迁移版本为 `002_core_relational.sql`。
16. `myroot-job-dispatcher / lam-j1ik47nr` 已部署为 Active，9 个定时触发器全部启用。9/9 手工云端 dry-run 成功，16:20 与 16:30 的自动触发日志返回 `retCode=0`。
17. 定时 Job 使用独立的 `ROOT_ADMIN_JOB_TOKEN`，只允许访问 `/api/v1/jobs/*`；同一 token 访问 `/api/v1/admin/me` 返回 HTTP 401。Job 日志只输出聚合结果，不写用户明细或凭据。
18. 部署前快照 `9699594` 恢复后为 0 张表，因早于迁移被判定为不合格；随后创建迁移后逻辑备份 `9700109` 和快照 `9700117`。快照 `9700117` 已通过任务 `13145837` 非破坏性恢复到 `myroot-restore-drill-v2-20260711`，回读 24 张表、两条迁移记录、`schema_version=2` 和备份时修订号 76。

因此 CloudBase MySQL Store、真实小程序身份、并发与双实例、定时 Job、Admin 部署产物和数据库隔离恢复这些 P0/P1 项已完成。整体正式发布仍保持 `BLOCKED`，原因是 Root 会员中心真机打开证明、真实有赞/企微/物流/奖励履约 Adapter、小批量执行回执、完整业务回滚和三方签字尚未完成；这些事项不应与本次 Store 迁移完成状态混为一谈。完整脱敏证据见 [2026-07-11 CloudBase MySQL P0/P1 证据](./cloudbase_mysql_p0_p1_evidence_2026-07-11.md)。
