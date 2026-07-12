# myRoot CloudBase 灰度候选 018 证据

日期：2026-07-11

状态：`DEPLOYED_AT_ZERO_TRAFFIC`

## 1. 发布对象

- 环境：`myroot-prod-d5gl3gzg7115f149a`
- 服务：`myroot-api`
- 稳定版本：`myroot-api-012 / 100%`
- 候选版本：`myroot-api-018 / 0%`
- 本地发布版本：`0.5.4`
- 部署 ID：`018`
- Run ID：`multi_tenant_1wiYOK9Wz6l9YS`
- 部署时间：`2026-07-11 22:09:16`

## 2. 部署与运行证据

- CloudBase 版本状态：`normal`
- 镜像构建：`check_build_image : succ`
- EKS 虚拟服务：`check_eks_virtual_service : succ`
- Pod：`myroot-api-018-6865bbd876-p5pcl`
- Pod 状态：`Running`
- 实例规格：CPU 1 核、内存 2 GB、最小 1、最大 2
- 当前线上流量回读：仅 `myroot-api-012 / 100%`

## 3. MySQL 加法迁移证据

通过 `tcb db execute --read-only` 回读：

- `schema_migrations`：`001_store_snapshot.sql`、`002_core_relational.sql`、`003_privacy_consent.sql`
- `privacy_consent_record` 表：存在
- `privacy_consent_record` 记录数：`0`
- `root_store_snapshot.schema_version`：`3`
- 回读时修订号：`252`

稳定版公开 `/ready` 同时返回 HTTP 200、`store.kind=mysql`、`connected=true`、`migrationVersion=003_privacy_consent.sql`，证明共享数据库升级未中断当前 `012`。

## 4. 本地质量证据

- `npm run verify`：`10/10 PASS`
- JavaScript 语法：196 个文件通过
- 后端全量测试：通过
- 小程序校验：通过
- Element Plus Admin 校验与构建：通过
- 生产依赖审计：通过
- HTTP Interface 冒烟：通过

## 5. 尚未完成

1. 0% 候选无法经当前百分比公共路由单独命中，因此尚未用 `/health.version=0.5.4` 完成运行时归因。
2. CloudBase 日志服务未启用，不能检索容器应用日志；未获费用和配置确认前不启用。
3. `ROOT_REQUIRE_HEALTH_CONSENT`、`ROOT_PRIVACY_CONTROLLER_NAME`、`ROOT_PRIVACY_CONTACT`、`ROOT_HEALTH_DATA_RETENTION_DAYS` 当前均未配置。
4. 未获发布负责人明确确认前，不执行 `012 95% / 018 5%`。
5. 未完成对象存储探针、体验版真机隐私验证和微信公众平台隐私声明回读。

## 6. 下一 Gate

先确认隐私处理者信息与保存期限，再配置四个生产变量。之后由发布负责人明确确认是否执行 5% 灰度；灰度后必须验证候选 `/health`、`/ready`、健康同意状态、CloudBase 对象存储探针和错误日志，任一失败立即执行流量回滚。
