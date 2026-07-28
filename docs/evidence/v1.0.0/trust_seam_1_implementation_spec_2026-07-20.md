# TRUST-SEAM-1 实施规格

状态：`DESIGN_FROZEN / IMPLEMENTATION_DEFERRED_UNTIL_R11_RESOLVED`  
版本目标：myRoot v1.0.0；当前运行版本仍为 0.5.13。

## 要解决的根问题

现有多个 Registry 能验证字段、摘要形状和内部自洽性，但不能证明外部审批、签名、GitHub run、内容许可、UED 节点或摄影权利真实存在。正式上线判断需要一个受信证据链：

```text
外部只读原始事实
  → 受控 Readback Adapter
  → 绑定原始字节的 trusted receipt
  → 证据类型专用 Validator
  → Formal Gate Evidence Resolver
  → READY_FOR_SEPARATE_FORMAL_LAUNCH_DECISION
  → 独立人工正式发布决定
```

任何一步都不得直接产生部署、真实发送或正式上线授权。

## 六个 Module

1. `Evidence Byte Resolver`：只允许读取 `docs/evidence/v1.0.0/*.json`，逐级拒绝符号链接和路径逃逸，从同一文件描述符完成限长读取、摘要和解析。
2. `Baseline Signoff Execution Control`：机器校验审批系统、workflow、owner、证据保管人、dueAt、升级及撤销源；取消、过期或不可读时停止收件。
3. `Baseline Signoff Evidence Verifier`：通过受控审批 readback 或真实 detached-signature Adapter 验证签名、角色权限、条件和当前撤销状态。没有真实验签 Adapter 时，从允许列表移除对应方法。
4. `Remote CI Evidence Registry`：区分 PR head、tested merge、base、post-merge main SHA；绑定 repository、workflow blob/path、run/attempt/event、job/check/App、artifact bytes 和 protection/ruleset readback。
5. `Content/UED Trusted Evidence Resolver`：逐量表、逐隐私演练、逐活动版本、逐屏、逐摄影资产解析受控证据，数量与状态必须派生，不能自报。
6. `Formal Gate Evidence Resolver`：只接受上述专用 Module 产生的 trusted receipt；原始路径、opaque ref、结构通过或合成 fixture 均不能关闭 Gate。

## 必须保持的 Interface 语义

- `structureValid` 永远只表示结构合法。
- `verificationStatus=VERIFIED` 必须同时绑定证据字节摘要、release、environment、subject、Adapter Implementation/Policy digest、观察时间、有效期和撤销序列。
- 验证时钟来自受信调用上下文，不接受业务 document 自报的 `evaluatedAt`。
- `ACTIVE`、`CLOSED`、`publishedActivityCount`、`screenCount`、`NOT_APPLICABLE` 等事实必须从 readback 派生。
- 14 Gate 全部验证后也只输出 `READY_FOR_SEPARATE_FORMAL_LAUNCH_DECISION`；`formalLaunchAuthorized` 固定为 `false`。

## 验证规模

实施完成至少需要五组 84 个负向/正向测试：路径与字节 12、Baseline 信任 18、远端 CI 18、内容/UED 20、正式 closure 16。详细 case 及 exact fields 见同名 JSON。

## 冻结顺序

本规格涉及 `backend/contracts/scripts/workflow`，全部位于待授权 R11 的 688-file execution manifest 内。因此：

1. R11 按精确 SHA/nonce 成功执行并冻结结果；或
2. 明确取消 R11，由新包取代。

满足任一条件后才开始实现。否则代码变更会让授权对象失效。

本规格没有联网、外部写、Docker、commit、push、部署、真实发送或 Gate closure 权限。
