# myRoot Cloud Function v0.5.12 对齐预检

日期：2026-07-14

状态：`PREFLIGHT_PASS / PRODUCTION_UNCHANGED / ACTION_CONFIRMATION_REQUIRED`

## 1. 实际读取来源

1. 当前工作树 `cloudfunctions/myroot-job-dispatcher/index.js`、`package.json`、`cloudbaserc.json`、专向测试和 11 Job Manifest。
2. CloudBase 生产环境 `myroot-prod-d5gl3gzg7115f149a` 中 `myroot-job-dispatcher`、`myroot-health-retention` 的 Function 详情与下载代码包。
3. CloudRun 发布单 `012 -> 027 / URL_PARAMS / flowRatio=0` 的行动时只读回读。
4. 027 定向后台的发布记录、上线 Gate、Production Env Matrix、读取/动作 Adapter、证据 Intake 和严格证据包只读回读。
5. 本预检完成后的 2026-07-14 10:08 已确认有赞应用 E-01 审核通过；该结果记录在独立 E-01 证据中，不是 Function 对齐的执行前置。
6. 2026-07-14 07:43 再次通过 CloudBase CLI 只读回读两个 Function 详情；随后尝试下载最新代码包时，CLI 的代码下载身份授权失败，未产生云端写入。
7. 使用 Function 中的受控候选路由只读请求 `/health`，确认命中 `027 / v0.5.12 / releaseId=v0.5.12+ef9fab932a08`；同一 Function Job token 请求 8 个 Admin GET 均返回 `40101`。
8. 2026-07-14 12:01 再次执行 `tcb env list`，CloudBase CLI 3.5.7 返回“无有效身份信息”；没有启动登录、读取环境或写入云端。同期重新校验本地候选与回滚 ZIP，文件仍存在且 SHA-256 与本证据一致。
9. 2026-07-14 再次读取本机 CloudBase CLI 3.5.7 的 `fn code update`、`fn code download`、`fn detail` 与 `fn invoke` 帮助；确认代码更新必须提供 Function 位置参数和代码目录，下载支持独立目标目录，调用支持 `-d` JSON 事件。只读取帮助，没有登录或访问云端。

环境变量值、候选路由值、Job token、Admin token、有赞凭据和客户标识均未输出或写入仓库。

## 2. 缺失与工作假设

1. 有赞应用 E-01 已在后续独立证据中关闭；ROOT 店铺授权、能力、套餐和隐私加密状态仍阻塞外部 Adapter，但不阻塞 Function 代码版本对齐与 11 Job dry-run。
2. 本轮没有获得两个 Function 代码更新和 11 Job 生产 dry-run 的行动时确认，因此只下载、比对和打包，没有上传或调用 Job。
3. `/tmp` 回滚包是本机临时材料；正式对齐前必须再次校验文件存在、SHA256 和云端当前版本没有漂移。
4. 当前本地提交尚未 push，T-015 仍缺可远端获取的 commit/tag 与正式 Evidence Intake 记录。
5. 最新代码包下载因 CLI 身份失效未完成；两个 Function 的 `CodeSize` 与 `ModTime` 均未变化，因此没有发现代码更新迹象，但行动时仍必须先恢复 CLI 代码权限并重新下载比对，不能把详情未漂移替代为包级证明。
6. Admin GET 的 `40101` 符合 Job token 仅允许 `/api/v1/jobs/*` 的权限设计，但无效或漂移的 token 也会产生相同结果；因此该结果不能证明 Function token 与 027 匹配，仍需 11/11 Job dry-run 进行端到端验证。
7. 2026-07-14 12:01 CloudBase CLI 仍未登录；在恢复身份并重新下载线上包前，不得执行 Function 代码更新。

## 3. 当前线上状态

| 项目 | 结果 |
| --- | --- |
| CloudRun | `myroot-api-012 -> myroot-api-027 / URL_PARAMS / 0% / gray success` |
| 主调度 Function | `Active / Available / Nodejs18.15 / index.main / 30s / 256MB` |
| 健康保留 Function | `Active / Available / Nodejs18.15 / index.main / 30s / 256MB` |
| 环境变量 | 两个 Function 各 6 个；`ROOT_JOB_DRY_RUN=true` |
| 定向路由 | 两个 Function 均与 027 发布单精确匹配 |
| 触发器 | `10 + 1`，全部启用 |
| 云端代码版本 | 两个 Function 均为 `0.5.10` |
| 本地候选版本 | `0.5.12` |
| CloudBase CLI 身份 | `NO_VALID_IDENTITY`；未启动登录 |

2026-07-14 07:43 详情复核：两个 Function 仍为 `Active / Available / Nodejs18.15 / index.main / 30s / 256MB / CodeSize=3398 / 6 vars / ROOT_JOB_DRY_RUN=true`；主调度为 10/10 启用触发器，健康保留为 1/1。修改时间分别保持 `2026-07-13 17:16:38` 和 `17:17:22`，没有新部署迹象。

## 4. 代码差异与工件

1. 两个线上下载包的 `index.js` 与 `package.json` 内容清单完全一致。
2. 本地 `0.5.12` 与线上 `0.5.10` 的 `index.js` SHA256 均为 `506e23926bc927fda3b9b22673e1f99746334e8c29c8f5b8ba498d23a06df927`。
3. 唯一代码包差异是 `package.json` 版本：本地哈希 `f77be955082db8d8dbfbcfb0cb6d520bf9fe8d03db5f54aba309c09d2924e3c7`，线上哈希 `0520b045c61117f524cc54e0c7085c16b33d32bef86dbb11db6ee1ed635d82d2`。
4. 确定性候选包：`/tmp/myroot-function-v0512-probe.DNzOOO/candidate-v0.5.12-deterministic.zip`，3,130 bytes，SHA256 `8b4870f1b280040c18e984d349d73e0c6b31b6dc670e65d5fe95edaab0aa9ef7`。
5. 确定性回滚包：`/tmp/myroot-function-v0512-probe.DNzOOO/rollback-v0.5.10-deterministic.zip`，3,130 bytes，SHA256 `00be904f5eb2914a28e4e692a34003e0e7fe2793f1eeefe16a8256806b6fdbe6`。
6. 两个 ZIP 均通过完整性检查；候选、下载包和回滚包的凭据模式扫描为 0 项。

## 5. 本地验证

1. `node --check cloudfunctions/myroot-job-dispatcher/index.js`：通过。
2. `backend/tests/cloudbase_job_dispatcher.test.js`：`7/7 PASS`。
3. 严格 11 Job Manifest：`PASS`，11 个 Job 唯一且 Function 拆分符合平台 10 个触发器上限。
4. 线上配置预检：两个 Function 状态、运行时、handler、超时、内存、6 个变量、全局 dry-run、027 路由和 10+1 个启用触发器全部符合预期。

## 6. 获确认后的执行范围

行动时确认必须同时明确以下范围：

1. 只使用以下两个代码更新命令，不执行 `tcb fn deploy` 或任何配置命令：

```bash
tcb fn code update myroot-job-dispatcher --dir cloudfunctions/myroot-job-dispatcher --json
tcb fn code update myroot-health-retention --dir cloudfunctions/myroot-job-dispatcher --json
```

`cloudbaserc.json` 的目标环境必须只读确认为 `myroot-prod-d5gl3gzg7115f149a`。两个命令都只提交代码目录，不提交 Function 配置、变量或触发器。

2. 每更新一个 Function 后立即回读 `Active / Available`、6 个变量、`ROOT_JOB_DRY_RUN=true`、027 路由和原触发器数量；任一漂移立即停止。
3. 两个 Function 都回读为 `0.5.12` 后，定向调用 11 个 Job，要求每个均为 HTTP 200、业务码 0、`releaseVersion=0.5.12`、`dryRun=true`。
4. 不开启 execute，不发送提醒，不清理健康数据，不发券，不写企微，不执行导出交付，不改 CloudRun 流量。

行动时的 11 个调用固定归属如下；每条单独执行并检查结果，不使用循环掩盖首个失败：

| Function | `jobId` |
| --- | --- |
| `myroot-job-dispatcher` | `adapter_retry_due` |
| `myroot-job-dispatcher` | `operational_alerts` |
| `myroot-job-dispatcher` | `checkin_reminders` |
| `myroot-job-dispatcher` | `wework_touch_due` |
| `myroot-job-dispatcher` | `lifecycle_settlement_due` |
| `myroot-job-dispatcher` | `lifecycle_settlement_cleanup` |
| `myroot-job-dispatcher` | `lifecycle_users_export` |
| `myroot-job-dispatcher` | `lifecycle_user_exports_delivery_retry` |
| `myroot-job-dispatcher` | `lifecycle_user_exports_cleanup` |
| `myroot-job-dispatcher` | `youzan_identity_reconcile` |
| `myroot-health-retention` | `health_data_retention_cleanup` |

单条调用形式为：

```bash
tcb fn invoke <Function> -d '{"jobId":"<jobId>"}' --json
```

调用前后都使用 `tcb fn detail <Function> --json` 回读配置；详情响应必须继续证明两组触发器为 `10 + 1`、变量为 `6 + 6`、全局 dry-run 未关闭且候选路由未漂移。

## 7. 回滚

1. 更新失败或配置漂移时，先把已校验的 `0.5.10` 回滚 ZIP 解压到新的临时目录，再使用 `tcb fn code update <受影响 Function> --dir <回滚解压目录> --json` 恢复代码；CLI 的 `code update` 接受目录，不直接接受 ZIP。不得复用含其他文件的目录，也不修改环境变量或触发器。
2. 回滚后重新下载代码并核对 `package.json=0.5.10`、`index.js` 哈希、状态、dry-run、路由和触发器数量。
3. 任一 Job 返回非 dry-run、版本不一致或结果不明确时停止，不继续下一个生产动作。

## 8. 对抗式审查

1. **“Implementation 一样，所以不用部署”**：不成立。Job 响应版本来自包清单，正式证据要求 Function 与候选版本一致。
2. **“只更新代码一定不影响配置”**：不能靠命令名称推断，必须在每次更新后回读 6 个变量、路由、dry-run 和触发器。
3. **“Manifest 通过等于 11 Job 已验证”**：不成立。Manifest 只证明本地拓扑；生产 dry-run 必须在更新后单独执行。
4. **“有回滚 ZIP 就一定能回滚”**：不成立。行动前仍需校验 ZIP 存在、哈希正确，并在回滚后重新下载比对。
5. **“Function 对齐后即可正式上线”**：不成立。当前发布记录仍有 45 个 must-fix，外部 Adapter、T-011 至 T-015、外部通道、联合回滚和三方签字仍未关闭。
6. **“详情未变等于下载包已复核”**：不成立。当前只能证明平台详情没有更新迹象；代码下载权限恢复后仍需重新下载并比较包内容。
7. **“Admin 返回 401 等于最小权限已验证”**：不成立。401 同时兼容 token 漂移；只有 Job Interface 成功且 Admin Interface 继续拒绝，才能形成完整权限证据。
8. **“工件还在就可以直接更新”**：不成立。ZIP 与哈希只证明本地工件未漂移；仍需恢复 CLI 身份、重新下载线上包并确认云端代码没有变化。

## 9. 结论

两个 Cloud Function 的 v0.5.12 只更新代码预检已通过，候选包和 0.5.10 回滚包均已准备且 12:01 哈希复核一致；线上仍保持上一轮回读的 0.5.10、全局 dry-run 和 027 定向路由。本轮没有生产写入。下一步先恢复 CloudBase CLI 身份并重新下载核对线上包，再对“按明确 Function 名称更新两个代码包并逐条执行 11/11 生产 dry-run”取得单独行动时确认；任一条失败立即停止并按目录回滚步骤恢复受影响 Function。
