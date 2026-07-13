# myRoot v0.5.12 发布说明

状态：`LOCAL_CANDIDATE / NOT_DEPLOYED / FORMAL_LAUNCH_GATE_HARDENING`

## 1. 本版目标

生产中的 `myroot-api-026 / v0.5.11 / URL_PARAMS / 0%` 已通过候选运行检查，但旧正式切换 Gate 只有 10 个证明项。即使这 10 项全部就绪，以下 5 个正式发布前置条件仍可能没有证据而被错误判定为可发布：

1. CloudRun 候选运行与默认流量保护。
2. 与后端同版本的体验版真机核心流程。
3. 次日打卡订阅提醒真实送达。
4. 5% 灰度观察与明确回滚阈值。
5. 候选工件与版本库追溯。

v0.5.12 只修复发布 Gate 的完整性，不改变用户打卡、结算、授权额度、外部 Adapter 或数据库结构。

## 2. Module 与 Interface 变化

1. `productionCutoverReadiness` Module 的 Interface 从 10 个扩展到 15 个生产证明项；正式目标缺少任一新增证明时均为 `BLOCKED`。
2. `productionEvidenceIntake` Module 同步新增 `T-011` 至 `T-015`，确保 Gate 项、负责人、下一步动作和证据收口清单一一对应。
3. `releaseRecord` 的最终检查增加候选运行、同版本体验版、真实提醒、5% 灰度和工件追溯的联合确认。
4. 新增证明仍复用既有 `productionCutoverProof` Interface，不引入第二套写入路径；调用方和测试继续跨同一 Seam。
5. `VERIFIED` 现在必须带脱敏后的 `evidenceRef`；`REJECTED` 至少需要证据引用或备注。
6. 正式目标只认可带证据引用的后台 VERIFIED 记录。环境布尔值只能作为灰度准备信号，不能单独关闭正式 Gate。
7. 正式目标即使已有证明，只要支持变量缺失仍保持 `BLOCKED`，不再降级为提醒项。
8. 生产证明分为运行环境与发布候选两类。候选运行、同版本体验版、真实提醒送达、5% 灰度和工件追溯必须由后端绑定当前 `version + releaseId`；旧候选证明不能用于新候选。
9. 版本绑定值由运行中的后端写入，忽略客户端提交的同名字段，避免通过伪造版本关闭 Gate。
10. 正式候选必须显式配置唯一 `ROOT_RELEASE_ID`；仅由包版本生成的 fallback releaseId 不具备区分同版本重复部署的能力，不能生成或通过发布级证明。
11. 新增 `Production Rollback Drill Module` 和 `rollback:drill` CLI Adapter，以同一 Interface 验证订单、物流、有赞客户、企微线索、增量游标、重复回滚、审计和 `MANUAL_SAMPLE` 回退；结果只标记为 `LOCAL_SIMULATION`。

## 3. 验证

1. 回滚演练与有赞专向测试：`29/29 PASS`。
2. 完整 `npm run verify`：`15/15 PASS`。
3. JavaScript 语法：228 个文件通过。
4. 迁移校验：5/5，通过且本版没有新增迁移。
5. CloudBase Job：两函数 11 个 Job 拓扑通过。
6. Admin 检查、构建和 backend-only dist：通过。
7. 小程序：157 个发布源文件通过，开发源排除与 sourcemap 关闭通过。
8. 根项目、后端、Admin、小程序和 Job Dispatcher 版本统一为 `0.5.12`。
9. Release Admin 会在 VERIFIED 缺少证据引用时禁用提交，后端仍执行同一强制校验。
10. 本地完整业务回滚演练：`9/9 PASS`，6 条带操作人的回滚审计；生产候选联合回滚仍保持阻塞。

## 4. 当前生产影响

1. 无。v0.5.12 尚未打包、部署、上传、commit 或 push。
2. 生产候选仍是 `myroot-api-026 / v0.5.11 / 0%`，稳定版 012 继续承接默认流量。
3. 两个 Cloud Function 继续使用现有代码包、026 条件路由和 `ROOT_JOB_DRY_RUN=true`。
4. 没有发送提醒，没有执行外部 Adapter，没有修改生产数据库或流量。
5. 线上现有 4 条 VERIFIED 记录已只读确认均带 `evidenceRef`，且都属于运行环境证明；部署新 Gate 后可直接保留为 4/15，无需重复录入。新增 5 条发布级证明必须绑定 v0.5.12 对应的运行版本与 releaseId。
6. 生产 026 当前没有显式 `ROOT_RELEASE_ID`，继续使用包版本 fallback；这不影响其现有 0% 内测状态，但不能作为 v0.5.12 的正式发布级证明，下一候选部署时必须补齐。

## 5. 后续约束

1. 部署 v0.5.12 前必须重新生成候选 ZIP、SHA256 和源码清单，并将它们映射到可获取的 commit/tag。
2. 部署仍从 0% 条件候选开始；不得把本地 `15/15 PASS` 当作生产证明。
3. 新候选必须设置唯一 `ROOT_RELEASE_ID`，并在 `/health`、`/ready`、证明记录和候选工件中核对一致。
4. 次日提醒真实发送、体验版上传、Cloud Function 更新、5% 灰度和正式切流必须分别取得行动时确认。
5. 任一真实提醒结果为 `UNKNOWN` 时停止，不重试、不复用额度。
6. 有赞、企微和物流的变量、样本、PREVIEW、IMPORT、真实动作及回滚批次见 [外部 Adapter 正式接入执行包](./external_adapter_activation_v0.5.12_2026-07-13.md)。
