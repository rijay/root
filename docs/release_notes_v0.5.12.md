# myRoot v0.5.12 发布说明

状态：`DEPLOYED_ZERO_PERCENT / RUNTIME_GATES_PASS / FORMAL_LAUNCH_BLOCKED`

## 1. 本版目标

本版设计启动时，生产中的 `myroot-api-026 / v0.5.11 / URL_PARAMS / 0%` 已通过候选运行检查，但旧正式切换 Gate 只有 10 个证明项。即使这 10 项全部就绪，以下 5 个正式发布前置条件仍可能没有证据而被错误判定为可发布；当前运行候选已经是第 4 节记录的 027：

1. CloudRun 候选运行与默认流量保护。
2. 与后端同版本的体验版真机核心流程。
3. 次日打卡订阅提醒真实送达。
4. 5% 灰度观察与明确回滚阈值。
5. 候选工件与版本库追溯。

v0.5.12 修复发布 Gate 的完整性，并补齐体验版候选归因与小程序码发布工具；不改变正式版用户打卡、结算、授权额度、外部 Adapter 或数据库结构。

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
12. `cloud-route` Module 新增 `App.onShow` 会话刷新 Interface，解决后台扫码回前台时候选参数未更新；正式版继续强制忽略候选参数。
13. 新增 trial 小程序码发布 CLI Adapter：默认 dry-run，只接受受控的 027 路由和微信凭据文件，使用 `stable_token(force_refresh=false)` 与 `getQRCode(env_version=trial)`，不在参数、输出或 Git 中保存敏感值。

## 3. 验证

1. 回滚演练与有赞专向测试：`29/29 PASS`。
2. 初始完整 `npm run verify`：`15/15 PASS`；补齐 trial 小程序码工具后复跑为 `16/16 PASS`。
3. JavaScript 语法：230 个文件通过。
4. 迁移校验：5/5，通过且本版没有新增迁移。
5. CloudBase Job：两函数 11 个 Job 拓扑通过。
6. Admin 检查、构建和 backend-only dist：通过。
7. 小程序：157 个发布源文件通过，开发源排除与 sourcemap 关闭通过。
8. 根项目、后端、Admin、小程序和 Job Dispatcher 版本统一为 `0.5.12`。
9. Release Admin 会在 VERIFIED 缺少证据引用时禁用提交，后端仍执行同一强制校验。
10. 本地完整业务回滚演练：`9/9 PASS`，6 条带操作人的回滚审计；生产候选联合回滚仍保持阻塞。

## 4. 当前生产影响

1. v0.5.12 已从本地提交生成候选 ZIP，并部署为 `myroot-api-027 / URL_PARAMS / 0%`；本地已有提交，本轮未 push、未上传小程序。
2. 稳定版 012 继续承接默认流量；15 次无参数健康请求中 027 命中 0 次。
3. 两个 Cloud Function 继续使用现有代码包，条件路由与 027 匹配，且 `ROOT_JOB_DRY_RUN=true`。
4. 没有发送提醒，没有执行外部 Adapter，没有修改生产数据库或流量。
5. 线上现有 4 条 VERIFIED 记录已只读确认均带 `evidenceRef`，且都属于运行环境证明；新增 5 条发布级证明仍必须绑定 027 的运行版本与 releaseId。
6. 027 已显式配置唯一 `ROOT_RELEASE_ID=v0.5.12+ef9fab932a08`，`/health`、`/ready` 与隐私说明均回读一致；T-012/T-015 尚未写入正式 Evidence Intake。

## 5. 后续约束

1. 候选 ZIP、SHA256 和本地提交映射已生成；正式 T-015 仍需确保证据引用和可获取的 commit/tag 后再写入。
2. 027 保持 0% 条件候选；不得把运行 `PASS` 当作正式发布批准。
3. 唯一 `ROOT_RELEASE_ID` 已在 `/health`、`/ready`、隐私说明和候选工件中核对一致；正式证明记录尚待写入。
4. 次日提醒真实发送、体验版上传、Cloud Function 更新、5% 灰度和正式切流必须分别取得行动时确认。
5. 任一真实提醒结果为 `UNKNOWN` 时停止，不重试、不复用额度。
6. 有赞、企微和物流的变量、样本、PREVIEW、IMPORT、真实动作及回滚批次见 [外部 Adapter 正式接入执行包](./external_adapter_activation_v0.5.12_2026-07-13.md)。
