# myRoot 生产灰度版本 016 验证记录

日期：2026-07-11

后续状态：`016` 已被支持 Job token 无中断轮换的 `017` 取代为最新候选版；本记录仅保留部署审计历史。

## 发布标识

- CloudBase 环境：`myroot-prod-d5gl3gzg7115f149a`
- 云托管 Module：`myroot-api`
- 稳定版本：`myroot-api-012 / 100%`
- 候选版本：`myroot-api-016 / 0%`
- 后端版本：`0.5.2`
- 稳定域名当前 `/health` 未返回版本字段，证明尚未提前命中候选版本。

## 新增生产探针

- Interface：`POST /api/v1/admin/cloudbase-object-storage/probe`
- 权限：Admin `CONFIG_WRITE`
- 保护：必填 `X-Request-Id`，请求幂等
- 数据：仅上传不含用户信息的发布探针 JSON
- 动作：CloudBase 上传后立即按 `fileID` 删除
- 证据：返回上传与删除确认、对象键、运行版本，并写入审计日志
- 失败处置：明确返回是否可能残留对象，便于人工清理

## 本地 Gate

- `npm run verify`：`10/10 PASS`
- JavaScript 语法：187 个文件通过
- 后端测试：187 项通过
- 生产依赖审计：0 个已知漏洞
- Admin、小程序、Job Manifest、生产环境矩阵、HTTP Interface smoke：通过

## CloudBase Gate

- 创建时间：`2026-07-11 21:11:20`
- 版本状态：`normal`
- Pod：`myroot-api-016-d975b67dd-tbxjd`
- Pod 状态：`Running`
- 镜像构建：`succ`
- EKS 虚拟运行环境创建：`succ`
- 资源：1 CPU、2 GB 内存、最小 1 副本、最大 2 副本、端口 80
- 当前候选流量：0%
- 当前稳定流量：100%

## 0% 负向演练

- 命令：`node scripts/production-canary-verify.js --base-url <生产域名> --expected-version 0.5.2 --attempts 5 --interval-ms 50 --json`
- 结果：退出码 2，符合“候选版本未命中”的预期。
- 连续 5 次响应均归类为 `UNVERSIONED`，与稳定版 `012` 的旧健康响应一致。
- `ready` 为 `SKIPPED`，对象存储探针为 `NOT_REQUESTED`。
- 报告明确记录 `trafficChanged=false`，脚本本身不管理 CloudBase 流量。

## 待确认动作

1. 把流量临时设置为 `012 95% / 016 5%`。
2. 循环请求 `/health`，以 `version=0.5.2` 确认命中 `016`。
3. 对候选版本执行 `/ready` 和对象存储探针。
4. 成功后记录 `export_storage` 的生产切换证明；失败立即执行流量回滚。
5. 本轮灰度验证不等于全量发布，全量切换仍需再次确认。
