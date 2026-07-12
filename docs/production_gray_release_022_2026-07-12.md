# myRoot CloudBase 灰度候选 022 证据

日期：2026-07-12

状态：`DEPLOYED_AT_ZERO_PERCENT_DIRECTED`

## 1. 发布对象

- 环境：`myroot-prod-d5gl3gzg7115f149a`
- 服务：`myroot-api`
- 稳定版本：`myroot-api-012`，无参数请求的默认版本
- 候选版本：`myroot-api-022`，仅匹配一次性 URL 参数
- 应用版本：`0.5.6`
- 候选包：182 个条目、1,052,249 bytes
- 候选包 SHA-256：`fe5e81763426fd7fa1a8164a05b076acc51e9d59f04fa1246403676156e07dc0`
- 一次性路由值、数据库口令、Job token、VPC ID 与子网 ID 均未写入仓库或本证据。

## 2. 020/021 失败与根因

1. `myroot-api-020`、`myroot-api-021` 均完成镜像构建，但 Liveness/Readiness 探针在 80 端口得到 `connection refused`，版本状态为 `deploy_failed`，没有承接线上流量。
2. 两个失败版本的 CPU、内存、端口、Dockerfile 和 46 个环境变量名称与目标一致，但 `DescribeVersionDetail` 回读均缺少 VPC 配置；稳定版 `012` 与此前正常候选 `019` 均具备 VPC。
3. 后端会在监听 80 端口前创建 MySQL Store 并等待就绪，因此缺失 VPC 时无法访问生产 MySQL 私网地址，应用不会进入监听状态。
4. CloudBase CLI `3.5.7` 的差异配置转换未自动提交 `VpcConf`。022 的部署请求改为从稳定版版本快照读取 VPC，并在 `UpdateCloudRunServer.Items` 中显式提交 `VpcConf`。
5. 迁移文件 `001/002` 还曾因尾部空行变化导致校验和漂移；已恢复与生产登记一致的字节、增加不可变迁移清单与最终验收 Gate。该问题修复后，021 仍因 VPC 缺失失败，证明两者是独立问题。

## 3. 022 部署与流量证据

- 版本状态：`normal`
- 端口/规格：80、1 CPU、2 GB、最小 1、最大 2
- 环境变量：46 个名称，候选使用 `myroot_app_v2`
- VPC：候选版本回读为已配置
- 发布模式：`URL_PARAMS`
- 默认版本：`myroot-api-012`
- 候选百分比：0
- 无参数 `/health` 连续 20 次均命中稳定版，未观察到 `0.5.6`
- 带一次性参数的候选探针首次即命中 `0.5.6`

`HasTraffic=true` 只表示版本已进入可匹配的路由配置，不代表获得随机百分比流量；本轮以 `FlowRatio=0`、稳定版默认路由和 20 次无参数探针共同判定无随机候选流量。

## 4. 候选探针

1. `/health`：HTTP 200，`version=0.5.6`、`releaseId=0.5.6`。
2. `/ready`：HTTP 200，MySQL connected，迁移为 `004_external_evidence_minimization.sql`。
3. MySQL 最小权限：`leastPrivilegeReady=true`、`privilegeScope=SCHEMA`、`privilegePolicyEnforced=true`。
4. `/api/v1/privacy/notice`：HTTP 200，处理者存在、公开联系方式有效、保存期限 180 天、政策版本存在。
5. 稳定域名无参数 `/health` 与 `/ready` 继续为 HTTP 200；共享生产 Store 已登记迁移 004。

## 5. 数据库账号与迁移

- `myroot_app_v2@'%'` 全局只有 `USAGE`。
- 目标 schema 只有 `SELECT / INSERT / UPDATE / DELETE / CREATE / ALTER`。
- 无额外 schema、全局数据权限或 `GRANT OPTION`。
- 候选启动成功应用迁移 004，证明 VPC、候选口令和最小权限策略同时可用。
- 旧 `myroot_app` 未删除，暂作为稳定版 012 的回滚账号；正式切换后再按独立变更停用。

## 6. Cloud Function dry-run

- `myroot-job-dispatcher`：10 个触发器，`Active / Available`
- `myroot-health-retention`：1 个触发器，`Active / Available`
- 两函数各保留原配置并增加候选路由变量，共 6 个环境变量，`ROOT_JOB_DRY_RUN=true`
- 11/11 个 Job 同步调用全部返回 `releaseVersion=0.5.6`、HTTP 200、业务码 0、`dryRun=true`
- `checkin_reminders` 与 `health_data_retention_cleanup` 原有 404 已关闭；健康数据清理回读 `retentionDays=180`、`executed=false`
- 本轮未发送订阅消息、未清理真实健康数据、未执行有赞/企微/物流/奖励外部动作。

## 7. 仍未关闭的正式发布 Gate

1. CloudBase 对象存储上传/删除候选探针尚未显式执行。
2. `v0.5.6` 小程序尚未上传体验版，隐私、登录、图片、打卡、结算和 Root 会员中心跳转仍需真机证明。
3. 有赞、企微、物流、发券与奖励 Adapter 仍缺真实小批量校准和负责人回执。
4. 5% 灰度、完整业务回滚、证据包归档与产品/运营/研发三方签字尚未完成。

022 是可验证的 0% 候选，不等于正式上线完成。
