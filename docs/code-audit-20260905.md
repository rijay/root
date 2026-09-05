# Root 代码与开发流程审计 · 2026-09-05

本次已完成代码清理、两处性能优化和本地开发/验证流程修复，结果保存在独立工作树。全量本地验证 7/7 阶段通过，共 1,102 项通过、0 失败、5 项 MySQL 专项跳过。原有三个工作区的提交、状态和已跟踪差异哈希均保持一致。

## 1. 审计范围与基线

- 工作树：`/Users/rijay/Documents/Root/.codex-worktrees/root-code-audit-20260905`
- 分支：`codex/root-code-audit-20260905`
- 服务端与后台基线：`93f585e`（最新用户标签提交链）。
- 小程序基线：原 v0.8.1 命名工作树中的既有 0.8.6 修复，完整复制到新树并以 `cbc3100` 单独保存。本次改动以 `cbc3100` 为比较基线；这 10 个文件的既有变更不是本次开发成果。
- 盘点基线 1,153 个受 Git 跟踪路径；对源码、配置及测试进行引用扫描，深入核对小程序启动/路由/请求、服务端授权/测评/标签/渠道、Store 与验证入口。生成的后台 bundle、历史文档和证据单列，未逐行人工审阅全部文件。
- 静态 import 图的分类基数：后端 src 102、后端 tests 111、小程序 JS/配置/模板等 226、admin 38、根 scripts 23 个文件。静态图是候选筛选，不等于动态引用或业务用途证明；删除前又查了全仓符号和操作入口。

## 2. 垃圾代码审计与实际清理

| 实际修改 | 证据与结果 |
| --- | --- |
| 删除 `miniprogram/utils/entry-launch.js`（51 行） | 运行时已使用 `launching-entry.js`；旧模块只剩自身测试引用 |
| 删除 `miniprogram/scripts/entry-launch.test.js`（15 行） | 未接当前 check，只验证上述孤立旧实现 |
| 删除 `backend/src/cloudbaseStoreReadiness.js`（289 行） | 源码和操作脚本零引用；剩余引用是历史说明文档 |
| 小程序 check 改为自动发现 `scripts/*.test.js` | 补回原来漏跑的 `runtime-request-adapter.test.js`；全部小程序测试通过 |
| 重写过时 README，新增工作树说明 | 修正旧绝对路径、touristappid、`urlCheck:false`、历史功能与当前验证描述 |

以上删除合计 355 行。未按名称删除 `myrootApi`、隐私/身份/幂等、`v060_api.test.js` 或离线发布验证：前者有当前 Interface 职责，后者仍验证现有行为。历史 Day4/Day8 与 `v060Api.js` 已在当前代码中移除；本次通过运行时债务守卫核实，未重复宣称删除。

普通字符串/模板断言虽不能代替渲染验收，但其中品牌、隐私、路由和安全约束仍有实际用途。对这类测试保留职责，并补充跨层 QA，未单纯按测试风格批量删除。

## 3. 性能结果与待优化项

| 项目 | 修改或发现 | 验证 |
| --- | --- | --- |
| 用户标签查询 | 每次请求建立归因、映射、同意记录和题库索引，避免对每个用户重复扫描全表；精确用户筛选提前应用，并保持 userIds 授权交集 | 原有 19 个标签测试通过；独立审查 seed 910252 的 3,200 组旧新版结果一致，输入不变 |
| 渠道漏斗按短码筛选 | 短码解析移出逐事件 filter，查询内只解析一次 | 现有渠道模块/API 回归通过 |
| 主包媒体 | 当前 1,093,162 bytes，预算上限 307,200 bytes；主包估算 1,488,277 bytes（WARN） | 仍为已识别的性能缺口；未放宽预算 |
| 大媒体优先级 | `static/home/banner1.jpg` 511,110 bytes；`banner2.jpg` 274,601 bytes；合计约占主包媒体 72% | 后续先评估尺寸、编码和分包/加载方式，再做真机视觉与首屏回归 |
| MySQL 写入 | Store 写路径仍有整体快照序列化、共享 revision 行锁和集合级投影；增长后可能拉长请求 | 静态代码观察，非线上性能测量；须采样锁等待/快照体积，再按真实需求改持久化 Module，保留事务和幂等 Interface |

合成基准：同一 Node 22.23.2、5,000 用户、5,000 渠道/映射、每用户一条同意记录，返回 50 行，固定 `now`；预热一次后测 5 次。中位耗时 **232.48 ms → 14.06 ms**，约 **16.5 倍**；返回 JSON 逐字节一致。该数字只说明本地算法成本，不代表线上 P95、真实设备或真实业务规模。

复现：`node exports/root-code-audit-20260905/labels-benchmark.cjs <工作树绝对路径> 5000`（从 Root 外层目录执行）。原始样本见 `labels-before.json` / `labels-after.json`。

## 4. 代理开发体验与验证循环

| 能力 | 现在的入口 | 实际验证 |
| --- | --- | --- |
| 环境准备 | `.nvmrc`、`npm run setup`、`npm run doctor` | 独立树按锁安装：backend 107、admin 55 个依赖；Node/依赖/分支/版本检查通过 |
| 纯本地调试 | `npm run dev:local`；后台 `npm run dev:admin` | 本机 18877 实际启动成功；每棵树独立 SQLite；显式本地配置，无 Keychain/云凭据读取 |
| 定点检查 | `npm run verify -- --only=backend,miniprogram,admin` | 参数拒绝拼写错误；不会空跑显示全绿 |
| 卡住与错误定位 | 每阶段 RUN/PASS/FAIL、完整 `.log`、`summary.json`、180 秒默认超时 | 失败早期输出不再被末尾成功测试覆盖；超时/取消可清理进程组 |
| 防进程遗留 | 取消后停止后续阶段，保留 130/143 退出码 | 忽略 SIGTERM 的后代与 Ctrl-C 原始复现已回验，新增长期回归测试 |
| 跨层 QA | `npm run qa:local` | 真实小程序请求/测评 Module → 替换 wx 传输 → 回环 HTTP → SQLite；见下节 |
| 操作手册 | `AGENTS.md`、`docs/development.md` | 固定基线检查、工作树隔离、端口归属、调试器和设备 QA 表 |

DX 评估（人工评分，仅用于本仓库相对改善）：

| 维度 | 原状 → 当前 | 依据 |
| --- | --- | --- |
| 开始使用 | 3 → 8 | 旧入口过时 → 新树安装、doctor、启动已实际执行 |
| 命令与入口 | 4 → 8 | setup/doctor/qa/阶段筛选及 help 已读回 |
| 错误与恢复 | 3 → 8 | 日志截尾 → 完整记录、超时和取消回归 |
| 文档 | 2 → 8 | 当前 README 与工作树流程逐项对照代码 |
| 升级/迁移 | 5 → 5 | 现有迁移与锁文件保留；真实 MySQL 未在本次运行 |
| 开发环境 | 4 → 8 | 当前树 SQLite、随机 QA 端口、依赖隔离 |
| 协作交接 | 3 → 3 | 远端仍落后，代码尚在本地 |
| 测量 | 3 → 7 | 阶段耗时、测试跳过项、合成性能样本；缺线上/真机数据 |

## 5. PR / Issue / CI 审计

通过 GitHub Connector 和已登录 `gh` 双重只读核实：

| 仓库 | 开放 PR | 开放 Issue | 现状 |
| --- | ---: | ---: | --- |
| [rijay/root](https://github.com/rijay/root) | 0 | 0 | 远端 main=`8277dda`，2026-08-06；本地服务端基线比它多 90 个提交 |
| [rijay/root-checkin-backend](https://github.com/rijay/root-checkin-backend) | 0 | 0 | 仓库最近 push 为 2026-05-28 |

最近 [CI 成功记录](https://github.com/rijay/root/actions/runs/31070669439) 绑定的也是 `8277dda`；它不能证明本次代码或 0.8.6 的 CI 状态。本次没有待处理的开放 PR/Issue，主要风险是最新代码、发布来源与远端审查链尚未汇合。建议后续先整理这 90 个提交的发布来源和差异，再按确认范围推送并创建可审查 PR，回读对应 SHA 的 CI；不直接把巨大差异自动合并至 main。

## 6. 接续停滞工作

检查了最近 50 个任务和全部置顶任务中的 Root 状态，并读取「0830｜优化｜0.8.0废弃代码」与「设计myRoot用户打标方案」的最近记录。本次可见范围内，除当前任务外没有处于 active 的 Root 任务，因此未确认另一个正在循环的运行任务。

旧清理任务曾转入体验版界面修复。本次从最新实际代码重新接续清理盘点，完成删除/保留分类、验证链路修复和性能改进。当前代码已经包含 8 月 31 日的旧运行时移除，不能再以早期记录推断它仍未实现。

可复现的验证停滞风险已解决：原 runner 直到全部结束才输出，失败只展示最后 30 行，且没有阶段超时；新流程完整保留失败、允许定点运行、清理取消/超时进程。尚待外部授权或设备操作的事项保留其真实状态，不把它们当作代码循环反复重试。

## 7. 验证结果与边界

| 阶段 | 结果 | 耗时 |
| --- | --- | ---: |
| 路由范围 | PASS | 2 ms |
| 后端 | 709 PASS / 0 FAIL / 5 SKIP | 4,109 ms |
| 小程序 | 324 PASS / 0 FAIL | 5,707 ms |
| Admin 检查 | 41 PASS / 0 FAIL | 683 ms |
| Admin 构建/体积 | PASS | 1,966 ms |
| 工具与本地 QA | 28 PASS / 0 FAIL | 5,136 ms |
| 本地证据快照 | PASS | 161 ms |

本地 QA 完整经过登录、未授权拦截、同意、测评开始/草稿/完成、重复完成、关闭服务再启动后的历史回读、用户标签回读、撤回及健康信息隐藏。临时数据库在测试结束清理。

浏览器另用本地合成环境打开用户标签页，实际点击查询，检查了截图与可访问树；空状态、权限提示和禁用按钮正常，控制台 error/warn 为零。未在浏览器读取生产数据。

5 个 SKIP 分别为：MySQL Activity generation 回填、Activity P0 升级、固定引擎 readiness 查询、迁移 068 数据清理边界、用户标签持久化/同步中断恢复。它们需要专用隔离 MySQL，本次结果不替代这些验证。

**7/7 表示本地检查和快照一致性通过。小程序源码媒体预算仍为 BLOCK，真实 MySQL、远端最新 CI、微信编译体积、真机/弱网、线上运行均未在本次形成通过证据。**

## 8. 交付与恢复

- 本次修复为本地代码，待后续审阅与发布流程；原工作区不需要回滚。
- `cbc3100` 是本次改动的可比较基线；恢复实现时可从该提交提取对应文件，不能重置原有用户工作区。
- 后续开发入口：`npm run doctor` → 按范围 `verify -- --only=...` → `qa:local` → 必要全量检查。
- 完整证据目录：`/Users/rijay/Documents/Root/exports/root-code-audit-20260905`。包含 source-workspaces-before/after、reachability、基准样本、remote-audit、browser-qa、independent-review、verification-summary 与全量日志。

## 附录：无 HTTP/小程序入口候选的处置

静态图有 27 个候选；操作脚本入口、离线治理与动态引用需单独判断。表内行数为审计基线，不是运行包体或删除收益。

| 文件 | 行数 | 处置 | 依据 |
| --- | ---: | --- | --- |
| `backend/src/accountableOwnerRiskAcceptanceRegistry.js` | 381 | 保留 | 操作/本地校验脚本实际引用 |
| `backend/src/baselineSignoffContractRegistry.js` | 723 | 当前保留，后续确认 | 离线 Foundation/发布/兼容验证仍有测试或其他 Module 引用，未证明治理用途废弃 |
| `backend/src/baselineSignoffEvidenceVerifier.js` | 310 | 当前保留，后续确认 | 离线 Foundation/发布/兼容验证仍有测试或其他 Module 引用，未证明治理用途废弃 |
| `backend/src/baselineSignoffExecutionControlRegistry.js` | 249 | 当前保留，后续确认 | 离线 Foundation/发布/兼容验证仍有测试或其他 Module 引用，未证明治理用途废弃 |
| `backend/src/cloudbaseStoreReadiness.js` | 289 | 删除 | 无运行引用；全仓符号复核确认；旧说明文档作为历史记录保留 |
| `backend/src/contentUedAuthorizationRegistry.js` | 1082 | 当前保留，后续确认 | 离线 Foundation/发布/兼容验证仍有测试或其他 Module 引用，未证明治理用途废弃 |
| `backend/src/contentUedTrustedEvidenceResolver.js` | 651 | 当前保留，后续确认 | 离线 Foundation/发布/兼容验证仍有测试或其他 Module 引用，未证明治理用途废弃 |
| `backend/src/deploymentArtifactBindingRegistry.js` | 1157 | 当前保留，后续确认 | 离线 Foundation/发布/兼容验证仍有测试或其他 Module 引用，未证明治理用途废弃 |
| `backend/src/formalEvidenceByteResolver.js` | 107 | 当前保留，后续确认 | 离线 Foundation/发布/兼容验证仍有测试或其他 Module 引用，未证明治理用途废弃 |
| `backend/src/formalGateEvidenceResolver.js` | 154 | 当前保留，后续确认 | 离线 Foundation/发布/兼容验证仍有测试或其他 Module 引用，未证明治理用途废弃 |
| `backend/src/formalLaunchMysqlDispositionReport.js` | 218 | 保留 | 操作/本地校验脚本实际引用 |
| `backend/src/formalLaunchReadinessRegistry.js` | 219 | 保留 | 操作/本地校验脚本实际引用 |
| `backend/src/formalLaunchSnapshotCleanup.js` | 115 | 保留 | 操作/本地校验脚本实际引用 |
| `backend/src/healthAdviceModelAdapter.js` | 142 | 保留 | 操作/本地校验脚本实际引用 |
| `backend/src/identityRecipientDeploymentCompatibility.js` | 406 | 当前保留，后续确认 | 离线 Foundation/发布/兼容验证仍有测试或其他 Module 引用，未证明治理用途废弃 |
| `backend/src/keyInventorySchemaAttestation.js` | 127 | 保留 | 操作/本地校验脚本实际引用 |
| `backend/src/localHealthAdviceKeychain.js` | 30 | 保留 | 操作/本地校验脚本实际引用 |
| `backend/src/localYouzanKeychain.js` | 30 | 保留 | 操作/本地校验脚本实际引用 |
| `backend/src/mysqlLocalAuthorizedRunner.js` | 1001 | 保留 | 操作/本地校验脚本实际引用 |
| `backend/src/mysqlProductionPreflight.js` | 422 | 保留 | 操作/本地校验脚本实际引用 |
| `backend/src/mysqlSchemaSnapshot.js` | 383 | 保留 | 操作/本地校验脚本实际引用 |
| `backend/src/platformControlEvidenceRegistry.js` | 587 | 当前保留，后续确认 | 离线 Foundation/发布/兼容验证仍有测试或其他 Module 引用，未证明治理用途废弃 |
| `backend/src/productionCutoverReadiness.js` | 378 | 当前保留，后续确认 | 离线 Foundation/发布/兼容验证仍有测试或其他 Module 引用，未证明治理用途废弃 |
| `backend/src/productionEnvMatrix.js` | 742 | 保留 | 操作/本地校验脚本实际引用 |
| `backend/src/releaseEvidenceContractRegistry.js` | 904 | 当前保留，后续确认 | 离线 Foundation/发布/兼容验证仍有测试或其他 Module 引用，未证明治理用途废弃 |
| `backend/src/remoteCiEvidenceRegistry.js` | 649 | 当前保留，后续确认 | 离线 Foundation/发布/兼容验证仍有测试或其他 Module 引用，未证明治理用途废弃 |
| `miniprogram/utils/entry-launch.js` | 51 | 删除 | 无运行引用；全仓符号复核确认；旧说明文档作为历史记录保留 |
