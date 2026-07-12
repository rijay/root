# myRoot 生产灰度版本 014 验证记录

日期：2026-07-11

后续状态：`014` 已被带运行版本标识的 `015` 取代为最新候选版；本记录仅保留部署审计历史。

## 范围

- CloudBase 环境：`myroot-prod-d5gl3gzg7115f149a`
- 云托管 Module：`myroot-api`
- 稳定版本：`myroot-api-012`
- 待灰度版本：`myroot-api-014`
- 本轮不切换正式流量，不执行真实外部 Adapter，不修改生产数据凭据。

## 数据库权限核验

- `myroot_app` 当前权限为 `SELECT / INSERT / UPDATE / DELETE / CREATE / ALTER`。
- 六项权限均不可转授权。
- 未开放 `DROP`、账号管理或授权管理权限。
- `DELETE` 已存在，因此本轮没有重复执行 `GRANT`。
- 当前授权作用域仍为 `*.*`。收敛为 `myroot-prod-d5gl3gzg7115f149a.*` 需要单独执行 `REVOKE + GRANT`，未包含在本轮确认范围内。

## 代码与依赖验收

`npm run verify` 结果为 `10/10 PASS`：

- 181 个 JavaScript 文件语法检查通过。
- 183 项后端测试通过。
- 生产依赖审计通过，0 个已知漏洞。
- CloudBase Job Manifest 与生产环境矩阵通过。
- Element Plus Admin 校验、构建和后端静态包一致性通过。
- 小程序校验通过。
- HTTP Interface smoke 通过。

## CloudBase 部署证据

- `myroot-api-014` 创建时间：`2026-07-11 20:58:16`。
- 版本状态：`normal`。
- Pod：`myroot-api-014-576fb57ddd-rc6cq`。
- Pod 状态：`Running`。
- 镜像构建：`succ`。
- EKS 虚拟运行环境创建：`succ`。
- 资源：1 CPU、2 GB 内存、最小 1 副本、最大 2 副本、端口 80。
- `014` 当前流量：0%。
- `012` 当前流量：100%。

## 稳定版本回读

- 服务状态：`normal`。
- `/health`：HTTP 200。
- `/ready`：HTTP 200。
- Store Adapter：MySQL，`connected=true`。
- 数据库迁移版本：`002_core_relational.sql`。

## 尚未关闭的 Gate

1. `014` 尚未接收真实灰度请求，不能据此判定可全量发布。
2. CloudBase 对象存储 Adapter 尚需通过 `014` 实际执行上传、持久化外部引用和删除清理。
3. 灰度流量切换、观察和回滚必须在明确确认后执行。
4. 当前数据库权限仍需收敛至单库作用域。
5. 生产凭据需要按原子切换方案轮换。
6. 有赞、企微、履约与奖励 Adapter 仍需真实小批量校准。
7. 产品、运营、研发签字及真机验收仍未完成。
