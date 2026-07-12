# myRoot CloudBase 灰度候选 019 证据

日期：2026-07-11

状态：`DEPLOYED_AT_ZERO_TRAFFIC`

## 1. 发布对象

- 环境：`myroot-prod-d5gl3gzg7115f149a`
- 服务：`myroot-api`
- 稳定版本：`myroot-api-012 / 100%`
- 当前候选版本：`myroot-api-019 / 0%`
- 应用版本：`0.5.4`
- 部署 ID：`019`
- Run ID：`multi_tenant_1wiYYgX6toY3LO`
- 部署时间：`2026-07-11 22:19:59`
- 上一候选 `018` 已由 `019` 取代，不作为后续灰度对象。

## 2. 部署与运行证据

- CloudBase 版本状态：`normal`
- 镜像构建：`check_build_image : succ`
- EKS 虚拟服务：`check_eks_virtual_service : succ`
- Pod：`myroot-api-019-bddc9b856-pfw9c`
- Pod 状态：`Running`
- 当前线上流量回读：仅 `myroot-api-012 / 100%`

## 3. 数据库与稳定版证据

- MySQL 已应用 `003_privacy_consent.sql`。
- `privacy_consent_record` 表存在，当前 0 条记录。
- `root_store_snapshot.schema_version=3`。
- 稳定版 `/health` 和 `/ready` 均返回 HTTP 200。
- 稳定版 `/ready` 返回 `store.kind=mysql`、`connected=true`、`migrationVersion=003_privacy_consent.sql`。

## 4. 当前候选范围

`019` 包含：

1. 微信平台隐私授权统一承接。
2. CloudBase 打卡图片真实上传与失败清理。
3. 健康类敏感个人信息追加式同意/撤回记录。
4. 未同意或撤回后拒绝身体画像、问卷和打卡写入，同时保留商品浏览与人工协助。
5. 审计来源由服务端固定，不信任客户端自报。
6. 身体画像在展示录入流程前先过同意 Gate。
7. 生产保存期限必须是正整数。

## 5. 仍未通过的 Gate

- `019` 仍为 0%，尚未通过公共请求验证 `/health.version=0.5.4`。
- CloudBase 日志服务未启用，无法检索应用日志。
- 隐私处理者名称、联系方式、保存天数和强制开关尚未配置。
- 微信公众平台隐私声明与体验版真机隐私流程尚未回读。
- 未获发布负责人确认前，不执行 `012 95% / 019 5%`。

## 6. 22:54 复核

- CloudBase 服务详情仍只显示 `myroot-api-012 / 100%`，未发生流量变更。
- 公网 `/ready` 返回 MySQL connected 与 `003_privacy_consent.sql`。
- 云函数与 CloudRun 的 Job token 脱敏哈希一致，`adapter_retry_due` 云端调用以 `dryRun=true` 成功。
- 根目录 CloudBase 函数配置已移除明文环境变量，最终验收新增敏感键扫描并达到 11/11 `PASS`。

## 7. 后续本地版本说明

- 仓库已开始封装 `v0.5.5` 健康数据保存期限清理，但该版本尚未部署，不能把本记录中的 `019 / v0.5.4` 视为已包含该能力。
- `v0.5.5` 应作为下一候选部署，继续保持 0% 或经明确批准的小流量；本记录仍只证明 `019` 的构建和 0% 候选状态。
- 仓库 CloudBase Manifest 已增加第 10 个健康数据清理触发器，线上 Cloud Function 当前仍为已验证的 9 个触发器。
