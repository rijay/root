# 2026-07-11 CloudBase MySQL P0/P1 证据

> **HISTORICAL_V0_5_ONLY / NOT_V1_EVIDENCE**：本文只证明 2026-07-11 对应 v0.5.x 环境和 releaseId 的历史状态，不得用于关闭 v1.0.0 的 Candidate/生产 MySQL、容量、可信微信身份、timer-only IAM、远端 CI 或部署 provenance Gate。v1 当前状态仅以 [v1 Gate tracker](./v1.0.0_launch_gate_closure_tracker_2026-07-17.md) 为准。

## 结论

myRoot 已具备团队内测所需的生产同构数据层：小程序通过 `wx.cloud.callContainer` 访问 CloudBase 云托管，后端使用 CloudBase SQL MySQL Store Adapter，并通过迁移、20 并发写、双实例、滚动重启、UnionID、商品镜像、关系表一致性、定时 Job 和隔离恢复验证。

P0/P1 CloudBase 数据层迁移与内测运行准备已经完成。这份记录不代表正式发布批准；正式发布仍需要体验版真机实际打开 Root 会员中心并记录跳转证明、真实外部 Adapter 小批量校准、完整业务回滚演练，以及产品、运营、研发三方签字。

## 目标配置

| 项目 | 实测值 |
|---|---|
| CloudBase 环境 | `myroot-prod-d5gl3gzg7115f149a` |
| 云托管 Module | `myroot-api` |
| 当前生效部署 | `012`，100% 流量 |
| Store Adapter | `mysql` |
| MySQL 数据库 | `myroot-prod-d5gl3gzg7115f149a` |
| MySQL 应用账号 | `myroot_app` |
| 账号权限 | `SELECT / INSERT / UPDATE / DELETE / CREATE / ALTER` |
| 未开放权限 | `DROP`、用户管理、转授权 |
| 连接池 | 上限 8，连接超时 10 秒 |
| 生产副本策略 | 最小 1，最大 2 |
| 自动暂停 | 已关闭 |
| 自动备份 | 每日，保留 7 天 |
| P0/P1 完成后快照 | `9700117`，状态成功 |
| Cloud Function | `myroot-job-dispatcher` / `lam-j1ik47nr`，Active |

## 迁移与关系表

`SHOW TABLES` 返回 24 张表：

`campaign_definition`、`campaign_participant`、`campaign_rule_version`、`manual_review_item`、`notification_delivery`、`notification_job`、`notification_subscription`、`notification_template`、`questionnaire_answer`、`reward_delivery_job`、`reward_grant`、`reward_inventory_pool`、`reward_inventory_reservation`、`reward_recovery_record`、`root_store_snapshot`、`root_user`、`schema_migrations`、`settlement_record`、`task_definition`、`task_event`、`task_progress_snapshot`、`user_contact_method`、`user_lifecycle_event`、`wechat_identity`。

首次完整迁移验收时的就绪探针如下；后续证明写入会继续推进修订号：

```json
{
  "code": 0,
  "store": {
    "kind": "mysql",
    "connected": true,
    "migrationVersion": "002_core_relational.sql",
    "revision": 54
  }
}
```

## 小程序云调用

使用微信开发者工具官方 `miniprogram-automator`，从 AppID `wx7727a02565aed1c2` 调用生产 CloudBase：

| 检查 | 结果 |
|---|---|
| `/health` | HTTP 200，业务码 0 |
| `/ready` | HTTP 200，MySQL 已连接，迁移版本正确 |
| `/api/v1/auth/login` | HTTP 200，令牌存在，`unionidStatus=LINKED` |
| `/api/v1/user/state` | HTTP 200，路由为注册引导页 |
| `/api/v1/products` | HTTP 200，商品数 1 |
| 商品 | `ROOT_PREBIOTIC_7D_RESET / ROOT益生元 7天身体重启计划` |
| `/api/v1/products/jump` | HTTP 200，AppID 正确，短链匹配，`envVersion=release` |
| 20 并发读 | 20/20 成功 |
| 20 并发登录写 | 20/20 成功，全部 `unionidStatus=LINKED` |

身份探针结果为 `READY`：

| 检查 | 结果 |
|---|---|
| `openid_header` | `PASS` |
| `unionid_header` | `PASS` |
| `privacy_guard` | `PASS` |
| `readyForUnionPrimaryKey` | `true` |

生产切换证明已写入：`cutover_e21e13762c7b4c / cloudbase_unionid / VERIFIED`。原始 `openid`、`unionid` 与令牌未写入本文档。

## 双实例与重启

1. 运行配置写入重启证明标记后，生效版本切换为 `009`，新实例创建时间晚于写入测试。
2. 临时把副本策略调为 2/2，确认两个 `009` 实例同时为 Running。
3. 双实例期间再次执行 20 个并发登录写请求，20/20 成功。
4. SQL 回读为 `root_user=1`、`wechat_identity=1`、商品数 1，快照修订号推进到 53，没有重复主账号。
5. 验证后恢复生产策略为最小 1、最大 2；记录脱敏 UnionID 证明后修订号推进到 54。

## 定时 Job

1. 已部署 `myroot-job-dispatcher` Cloud Function，配置 9 个启用状态的定时触发器，覆盖 Adapter 重试、运营预警、打卡提醒、企微触达、活动结算、结算清理、生命周期导出、导出交付重试和导出清理。
2. 9/9 Job 手工云端调用均返回 HTTP 200、业务码 0，且 `dryRun=true`。
3. 16:20 与 16:30 的真实定时日志证明触发器会自动运行，相关执行均为 `retCode=0`。
4. `ROOT_ADMIN_JOB_TOKEN` 只允许访问 `/api/v1/jobs/*`；同一 token 访问 `/api/v1/admin/me` 返回 HTTP 401，避免定时执行身份获得通用后台权限。
5. Job 日志只保留状态和聚合计数，不记录用户明细、openid、unionid、后台 token 或完整业务响应。
6. 当前保持 `ROOT_JOB_DRY_RUN=true`；真实外部 Adapter 完成小批量校准前不启用 execute。

生产切换证明已写入：`cutover_048dd6e93ef06a / cloudbase_jobs_created / VERIFIED`。

## 备份恢复

1. 首次使用部署前快照 `9699594` 恢复到隔离库 `myroot-restore-drill-20260711`，恢复任务 `13145426` 成功结束，但目标库为 0 张表。该快照早于数据库迁移，验收判定为不合格，不能作为回滚证明。
2. 迁移完成后创建逻辑备份 `9700109 / myroot-api-0.5.0-postmigration-20260711` 和快照 `9700117 / myroot-api-0.5.0-postmigration-snapshot-20260711`，两者状态均为成功。
3. 使用快照 `9700117` 非破坏性恢复到 `myroot-restore-drill-v2-20260711`，任务 `13145837` 达到 100% 并成功结束；生产库未被覆盖或删除。
4. 隔离库回读 24 张表，`schema_migrations` 包含 `001_store_snapshot.sql` 与 `002_core_relational.sql`，快照 `schema_version=2`、`revision=76`，核心用户与身份关系数量和备份时点一致。
5. 恢复过程中生产 `/ready` 持续返回 HTTP 200。两个恢复演练库暂时保留为审计证据，后续删除需单独确认。

本次只证明数据库快照可恢复。完整生产回滚 Gate 还包含外部 Adapter 回退、`MANUAL_SAMPLE`、字段快照一致性和运营人工兜底，因此没有把 `rollback_drill_completed` 冒充为 `VERIFIED`。

## Admin 部署证据

1. 当前 `012` 镜像内 `/admin` 与静态资源均返回 HTTP 200，`/admin-legacy` 保留为回退入口。
2. backend-only 镜像通过 `admin-build-manifest.json` 识别 6/6 Admin Module；`adminTransitionReadiness` 为 `NEEDS_REVIEW`，blocker 为 0。
3. 唯一 warning 是旧 Admin 尚未批准下线。团队内测阶段继续保留旧入口，符合当前回退策略。

## 发布 Gate

| Gate | 当前状态 |
|---|---|
| CloudBase Store | `READY`，5/5，0 blocker，0 warning |
| CloudBase UnionID | `VERIFIED` |
| CloudBase 定时 Job | `VERIFIED`，9/9 触发器启用并完成 dry-run |
| Root 会员中心 appId | `VERIFIED` |
| Root 会员中心 path | 已配置，缺失数为 0 |
| Root 会员中心真机跳转证明 | 未完成，保持阻塞 |
| 生产切换证明 | 4 项 `READY`、6 项仍阻塞 |
| 整体生产发布 | `BLOCKED`，40 个待关闭项 |

没有写入 Root 会员中心生产跳转 `VERIFIED` 证明，因为本轮只调用了后端跳转 Interface，尚未在体验版真机真实打开目标小程序。

## P0/P1 之外的正式发布事项

1. 体验版真机点击商品购买，真实打开 Root 会员中心短链，再写入生产跳转证明。
2. 配置并校准真实有赞、物流、企微和奖励履约 Adapter，以小批量成功回执关闭对应 Gate。
3. 在 execute 开启前完成真实外部动作的负责人确认、告警路由和停用开关验收。
4. 完成业务级回滚演练、外部通道证明以及产品、运营、研发三方签字。
5. 审计留存期结束后，经确认删除两个隔离恢复演练库。

## 本地回归

`npm run verify` 于 2026-07-11 再次执行，结果为 10/10 `PASS`，覆盖 188 个 JavaScript 文件语法、187 项后端测试、0 漏洞生产依赖审计、Admin 校验与构建、小程序校验、Job Manifest、Production Env Matrix 和 HTTP Interface smoke。
