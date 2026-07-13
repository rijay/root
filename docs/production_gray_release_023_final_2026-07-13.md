# myRoot CloudBase 候选 023 最终归档

归档时间：2026-07-13 11:17:50 +08:00

状态：`ARCHIVED_BEFORE_024_REPLACEMENT`

## 1. 归档目的

在获得 CloudBase CLI 行动时授权后，先固化 023 的最终只读证据，再结束其 0% 条件灰度并部署 `v0.5.7` 候选。该归档不包含路由值、环境变量值、VPC/子网 ID、数据库口令、Admin/Job token 或对象存储 Key。

## 2. 当前发布单

| 项目 | 回读结果 |
| --- | --- |
| 环境 | `myroot-prod-d5gl3gzg7115f149a` |
| 应用 | `myroot-api / normal / container` |
| 默认版本 | `myroot-api-012 / normal` |
| 条件候选 | `myroot-api-023 / normal` |
| 发布状态 | `grayStatus=success / releaseStatus=gray / IsReleasing=true` |
| 流量策略 | `URL_PARAMS / flowRatio=0` |
| 条件路由 | 键 `myroot_canary`；值存在、长度 20，未输出 |
| 运行配置 | `1 CPU / 2 GB / min 1 / max 2 / port 80 / VPC present` |
| 开放方式 | `PUBLIC / MINIAPP / OA` |
| 运行变量 | 48 个名称且无重复；隐私、提醒和对象存储必需名称存在 |

## 3. 默认流量保护

无条件参数调用 `/health` 连续 5 次，均返回 HTTP 200 和稳定版响应形态，未出现 `version=0.5.6`。这证明归档时 023 没有获得随机默认流量。

## 4. 023 定向探针

1. 带既有条件路由调用 `/health`：HTTP 200、业务码 0、`version=0.5.6`、`releaseId=0.5.6`。
2. 带既有条件路由调用 `/ready`：HTTP 200、业务码 0、`version=0.5.6`、`releaseId=0.5.6`。
3. Store：`mysql / connected=true / migration=004_external_evidence_minimization.sql`。
4. 最小权限：`leastPrivilegeReady=true / privilegeScope=SCHEMA / privilegePolicyEnforced=true`。

## 5. 行动授权与下一步

负责人已确认授权 CloudBase CLI。授权范围为：创建 `v0.5.7` 本地提交且不 push，结束 023 的 0% 条件灰度，部署预期 024，复用同一条件路由恢复 `URL_PARAMS / 0%`；012 始终承接默认流量，不上传小程序、不执行真实外部动作。

若平台版本、发布单、路由、VPC、运行变量名或默认流量保护发生漂移，执行必须停止并保留 012。
