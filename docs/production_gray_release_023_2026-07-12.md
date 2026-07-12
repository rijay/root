# myRoot CloudBase 灰度候选 023 证据

日期：2026-07-12

状态：`DEPLOYED_AT_ZERO_PERCENT_DIRECTED`

## 1. 发布对象

- 环境：`myroot-prod-d5gl3gzg7115f149a`
- 服务：`myroot-api`
- 稳定版本：`myroot-api-012`，无参数请求的默认版本
- 候选版本：`myroot-api-023`，只匹配一次性 URL 参数
- 应用版本：`0.5.6`
- 候选包：180 个条目、1,048,175 bytes
- 候选包 SHA-256：`055e904bff74288589bbdafbfc6c98dbccc5bf309d25f3cf6a5905a318d2a156`
- 候选来源提交：`44b4d3a`，仅本地提交，未 push
- 一次性路由值、CloudBase API Key、数据库口令、Admin token、Job token、VPC ID 与子网 ID 均未写入仓库或本证据。

## 2. 022 关闭与 023 部署

1. 022 的对象存储探针返回 HTTP 502，且目录回读为 0 个对象；控制台随后执行“取消灰度”，稳定版 012 保持 100%，022 变为 `0% / HasTraffic=false`。
2. 023 由已通过 `15/15` 验收的后端目录重新封装；包内不含 `node_modules`、`.git`、日志、SQLite 或数据文件，JWT/私钥候选扫描无命中。
3. 023 状态为 `normal`，端口 80、1 CPU、2 GB、最小 1、最大 2，显式继承稳定版 VPC。
4. 候选共 48 个环境变量，使用 `myroot_app_v2`、schema 级最小权限、隐私 180 天配置、次日提醒配置和 CloudBase HTTP 对象存储配置。
5. 发布单为 `URL_PARAMS`，候选比例为 0；CloudRun 的 `HasTraffic=true` 表示版本进入可匹配条件路由，不表示获得随机百分比流量。

## 3. API Key 与对象存储配置

- 服务端 API Key 名称：`myroot-api-object-storage-20260712`
- 有效期：180 天，到期时间 `2027-01-08 19:17:38 +08:00`
- API Key 仅在创建时读取一次并保存到 macOS 钥匙串；剪贴板已清空，明文未写入仓库、命令参数或证据文档。
- 候选使用 `ROOT_CLOUDBASE_STORAGE_TRANSPORT=HTTP`，环境 ID 必须与生产环境一致。
- 上传流程为：获取单对象上传授权、向授权 URL PUT 探针载荷、按返回的精确 `cloudObjectId` 删除。
- 上传超时或非 2xx 等含糊结果会保留精确对象 ID 并立即尝试补偿删除，不允许前缀清理。

## 4. 候选就绪证据

1. 定向 `/health`：HTTP 200，`version=0.5.6`、`releaseId=0.5.6`。
2. 定向 `/ready`：HTTP 200，MySQL connected，迁移为 `004_external_evidence_minimization.sql`。
3. MySQL 最小权限：`leastPrivilegeReady=true`、`privilegeScope=SCHEMA`、`privilegePolicyEnforced=true`。
4. 公开隐私说明：处理者存在、公开联系方式有效、保存期限 180 天、政策版本存在。
5. Production Env Matrix 包含必需的 CloudBase 对象存储组，并要求 HTTP transport、生产环境 ID 和服务端 API Key 同时存在。

## 5. 对象存储生产探针

- 请求时间：2026-07-12 19:37 +08:00
- 提供方：`CLOUDBASE`
- 对象键：`release-probes/2026-07-12/canary-object-023-20260712T113723136Z-c9b730dd.json`
- HTTP 状态：200；业务码：0；探针状态：`VERIFIED`
- 上传确认：`true`
- 精确删除确认：`true`
- 残留对象可能性：`false`
- 审计：`CLOUDBASE_OBJECT_STORAGE_PROBE`，匹配对象键，1 条
- 探针后直接列举 `release-probes/2026-07-12/`，结果为 `total=0`。

该探针只验证 CloudBase 对象存储最小写删闭环，不代表生命周期导出、媒体文件或其他业务对象已开放 execute。

## 6. 默认流量与 Cloud Function

1. 配置 023 条件路由前，无参数 `/health` 连续 5 次均为 HTTP 200 且未返回 `0.5.6`。
2. 配置条件路由后，无参数 `/health` 连续 5 次仍未返回 `0.5.6`；带条件请求首次命中 023。
3. 对象探针完成后，无参数 `/health` 再连续 5 次仍未返回 `0.5.6`。
4. `myroot-job-dispatcher` 保持 10 个触发器，`myroot-health-retention` 保持 1 个触发器；两函数均 `Active / Available`。
5. 两函数均保持 `ROOT_JOB_DRY_RUN=true`，候选路由变量已更新为 023 且未披露其值。
6. 11/11 个 Job 全部返回 `releaseVersion=0.5.6`、HTTP 200、业务码 0、`dryRun=true`；未发送订阅消息、未清理健康数据、未调用真实有赞/企微/物流/发券或奖励动作。

## 7. 当前结论与剩余 Gate

023 已达到可继续验证的 0% 定向候选状态：VPC、MySQL、迁移 004、schema 级最小权限、隐私、对象存储写删和 11/11 Job dry-run 均通过；稳定版 012 仍承接默认流量。

正式发布仍由以下事项阻塞：

1. 上传 `v0.5.6` 体验版并完成真机隐私、登录、图片、打卡、结算和 Root 会员中心跳转。
2. 完成有赞、企微、物流、发券与奖励 Adapter 的真实脱敏小批量校准和负责人回执。
3. 经独立确认后完成 5% 灰度、真实告警观察和完整业务回滚证明。
4. 归档最终证据包并完成产品、运营、研发三方签字。

在上述 Gate 关闭前，不开启 Cloud Function execute，不提升候选流量，不执行 100% 切流。
