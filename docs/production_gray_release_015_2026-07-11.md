# myRoot 生产灰度版本 015 验证记录

日期：2026-07-11

后续状态：`015` 已被带对象存储生产探针的 `016` 取代为最新候选版；本记录仅保留部署审计历史。

## 发布标识

- CloudBase 环境：`myroot-prod-d5gl3gzg7115f149a`
- 云托管 Module：`myroot-api`
- 稳定版本：`myroot-api-012 / 100%`
- 候选版本：`myroot-api-015 / 0%`
- 后端版本：`0.5.1`
- `/health` 与 `/ready` 已增加 `version` 和 `releaseId`，用于灰度请求归因。

## 本地 Gate

- `npm run verify`：`10/10 PASS`
- JavaScript 语法：183 个文件通过
- 后端测试：184 项通过
- 生产依赖审计：0 个已知漏洞
- Admin、小程序、Job Manifest、生产环境矩阵、HTTP Interface smoke：通过

## CloudBase Gate

- 创建时间：`2026-07-11 21:04:52`
- 版本状态：`normal`
- Pod：`myroot-api-015-7475bc4486-zctzf`
- Pod 状态：`Running`
- 镜像构建：`succ`
- EKS 虚拟运行环境创建：`succ`
- 资源：1 CPU、2 GB 内存、最小 1 副本、最大 2 副本、端口 80
- 当前候选流量：0%
- 当前稳定流量：100%

## 下一步与回滚

1. 经明确确认后，把 `015` 灰度流量设为 5%，`012` 保持 95%。
2. 通过 `/health.data.version=0.5.1` 确认命中 `015`。
3. 对 `015` 执行 `/ready`、登录、用户状态、商品、商品跳转和 CloudBase 对象存储上传/删除验证。
4. 任一核心检查失败即执行 `tcb cloudrun traffic rollback`，恢复 `012 / 100%`。
5. 验证通过后仍需再次确认，才可执行全量发布。
