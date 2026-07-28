# myRoot v1.0.0 外部 Gate 取证前信任 Seam 审计

日期：2026-07-20  
状态：`P0_TRUST_SEAMS_OPEN / NOT_READY_FOR_EXTERNAL_ACCEPTANCE_COLLECTION`

## 结论

当前不是“只差签名或外部截图”。具名签署、远端 CI、正式 Gate closure 和五类内容/UED 验收仍缺少把**受控外部事实**转成可验证证据的深 Module。现有 Registry 多数只验证结构，自身也明确不授权发布；如果把结构通过误当作真实验收，会产生可伪造的 `CLOSED`。

本审计只读取本地文件，没有联网、没有访问 Candidate/生产、没有修改 GitHub/CloudBase/微信、没有发送消息，也没有启动 Docker。

## P0 风险

1. Baseline Signoff 的 `signatureDigest` 只检查 64 位摘要形状；调用方自报 `VALIDATED`、`ACTIVE` 与条件 `CLOSED` 即可让合成记录派生 `BASELINE_CLOSED`。必须增加受信审批 readback 与真实验签 Adapter。
2. 审批系统、workflow owner、证据保管人、截止时间、升级和撤销源只存在于签署包文字，未进入机器可验 Interface。必须增加 Baseline Signoff Execution Control Module，并把其 digest 绑定到签署 payload 和 Acceptance Envelope。
3. Formal Launch Readiness Module 不读取证据文件、不重算摘要、不调用证据类型 Validator；不存在路径加伪造摘要可被结构性接受。必须增加受限 Evidence Resolver seam，逐类读取真实字节并验证 release/environment 绑定。
4. Required Check Contract 没有真实 readback Module；当前不能防止同名 check、错误 GitHub App、错误 workflow、旧 run 或错误 SHA lineage。必须区分 PR head、tested merge、base 与 post-merge main SHA。
5. Content/UED Registry 正确标注 `STRUCTURE_ONLY_UNTRUSTED_INPUT`，但测试中的完整通过包完全由本地 seed、伪造引用和伪造 signature digest 生成。正式发布决策禁止用 `structureValid`、`allEvidenceStructureValid`、`allEnvironmentStructuresValid` 或 `verify() === true` 作为外部验收证明。

## 下一冻结切片

`TRUST-SEAM-1` 顺序如下：

1. `Formal Evidence Resolver`：受限真实文件解析、realpath/symlink 防护、字节摘要复算、证据类型分发、release/environment 绑定。
2. `Baseline Evidence Verifier`：受控审批 readback、签名验证、角色授权、条件关闭、当前撤销状态和执行控制面。
3. `Remote CI Evidence Registry`：workflow/run/attempt/job/check/App/artifact/ruleset 及四类 SHA lineage。
4. `Content/UED Trusted Resolution`：逐内容、逐活动、逐屏、逐资产读取受控事实；数量和状态从证据派生，不能由调用方自报。

这些本地 Module 只能提升真实性和可追溯性，不能替代具名审批、Candidate/生产 readback、真实活动内容、健康授权、隐私演练、UED 逐屏验收或摄影权利文件。

## R11 冻结隔离

当前唯一待授权 MySQL 包仍为：

- packet SHA-256：`d0369e06f7fb57a2085cd5a567bf775370fe0ae2a43178179465a435e7aa3016`
- nonce：`dd1a2ef2-8687-4509-a799-0960748cb6fd`
- execution input：688 files，aggregate SHA-256=`36dd29f585c0192c889ea193de1ce7a4d3e6a554cbae61fee779271e12d0a4ec`

上述 `TRUST-SEAM-1` 会修改 R11 已绑定的 `backend/contracts/scripts/workflow` 字节，因此在 R11 获精确授权执行，或被明确取消并由新包取代前，不启动代码修改，避免再次形成授权对象漂移。

机器可读详情见 `pre_external_gate_trust_seam_audit_2026-07-20.json`。该审计不关闭任何 Gate，也不构成 Docker、commit、push、部署、外部取证或正式上线授权。
