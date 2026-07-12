# myRoot 生产灰度版本 017 验证记录

日期：2026-07-11

## 发布标识

- CloudBase 环境：`myroot-prod-d5gl3gzg7115f149a`
- 云托管 Module：`myroot-api`
- 稳定版本：`myroot-api-012 / 100%`
- 候选版本：`myroot-api-017 / 0%`
- 后端版本：`0.5.3`
- 小程序待上传版本：`0.5.3`

## 本地 Gate

- `npm run verify`：`10/10 PASS`
- JavaScript 语法：188 个文件通过
- 后端测试：187 项通过
- 生产依赖审计：0 个已知漏洞
- Job token 新旧双收、未知 token 拒绝、Job token 无后台权限：通过
- Admin、小程序、Job Manifest、生产环境矩阵、HTTP Interface smoke：通过

## CloudBase Gate

- 创建时间：`2026-07-11 21:28:18`
- 版本状态：`normal`
- Pod：`myroot-api-017-d6bf77b5b-fws5l`
- Pod 状态：`Running`
- 镜像构建：`succ`
- EKS 虚拟运行环境创建：`succ`
- 资源：1 CPU、2 GB 内存、最小 1 副本、最大 2 副本、端口 80
- 当前候选流量：0%
- 当前稳定流量：100%

## 灰度验证顺序

1. 经明确确认后设置 `012 95% / 017 5%`。
2. 以 `version=0.5.3` 归因候选健康和 Store 就绪响应。
3. 显式执行对象存储上传/删除探针并确认无残留。
4. 任一 Gate 失败立即执行 CloudBase 流量回滚。
5. 验证通过只关闭候选技术 Gate；全量发布仍需真实外部 Adapter、真机和三方签字。
