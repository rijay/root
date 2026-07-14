# v0.5.12 生产切换证明预检

执行时间：2026-07-14 07:40 +08:00

状态：`T-012_EVIDENCE_READY_BUT_NOT_DURABLE / T-015_BLOCKED_BY_REMOTE_TRACEABILITY / NO_PRODUCTION_PROOF_WRITTEN`

## 1. 实际读取来源

1. 当前工作树、`ef9fab932a08cb2f48f63b04605e6ac9c94c8c19` 的 `backend` 树和本地/远端 Git 引用。
2. [027 候选证据](./production_gray_release_027_2026-07-13.md)、[正式上线 Gate](./formal_launch_gate_v0.5.12_2026-07-13.md)与生产切换证明 Module。
3. 027 原始候选 ZIP `/private/tmp/myroot-api-v0.5.12-ef9fab932a08.zip`，以及从同一提交重新生成的临时 ZIP。
4. `git archive`、`shasum -a 256`、`zipinfo`、解压后 `diff -rq`、`git branch -r --contains` 和 `git tag --contains` 的只读结果。

## 2. 缺失材料与工作假设

1. `ef9fab9` 当前不在任何远端分支或 tag 上；主分支比 `origin/main` 领先 10 个提交，因此尚无可供团队获取的版本库引用。
2. 027 原始 ZIP 已于 12:05 字节级复制到工作区忽略目录 `release-artifacts/v0.5.12/`，降低系统临时目录清理风险；该副本仍只在本机，不是团队长期工件仓库，不能替代正式 `evidenceRef`。
3. 027 的运行 Gate 已有完整本地证据，但对应文档也尚未 push；因此 T-012 只达到“证据内容就绪”，尚未达到“可写入正式证明”。
4. 本轮未刷新有赞审核状态；这不影响 T-012/T-015 预检，但继续阻塞外部 Adapter 验收。

## 3. 工件复核

| 项目 | 结果 |
| --- | --- |
| 原始 ZIP | 188 个条目、179 个文件、1,076,513 bytes |
| 原始 SHA-256 | `ff4491fafa36f8dc68b12593c46ac258397c24bce89c780228d6aa1242b586cc` |
| 工作区保全副本 | `release-artifacts/v0.5.12/myroot-api-v0.5.12-ef9fab932a08.zip`；字节比较一致 |
| 来源提交 | `ef9fab932a08cb2f48f63b04605e6ac9c94c8c19` |
| 后端树 | `9e1525824c58f0807b3079239381ab6e9b45b07b` |
| 重建 ZIP | 188 个条目、1,076,513 bytes |
| 重建 SHA-256 | `d046dfcd30319c9d2a3eec7f06ae987a6fde32cff3453488b1428d4ef9fbf583` |
| 展开内容比较 | `diff -rq` 零差异 |
| 远端分支包含 `ef9fab9` | 无 |
| tag 包含 `ef9fab9` | 无 |

原始包与重建包字节哈希不同，但解压后的文件集合和内容完全一致，包大小也一致。差异位于 ZIP 容器元数据，不代表 Implementation 内容漂移。正式追溯仍应同时保留原始 ZIP 哈希和展开内容清单，不能用重建 ZIP 的哈希覆盖 027 已记录的原始哈希。

## 4. T-012 判定

`cloudrun_candidate_runtime` 的运行材料已经满足：

1. 027 为 `normal / v0.5.12 / releaseId=v0.5.12+ef9fab932a08`。
2. 发布单为 `URL_PARAMS / 0%`，稳定版 012 继续承接默认流量。
3. 定向 `/health`、`/ready`、隐私和 Admin 通过。
4. VPC、49 个变量、实例规格、端口、MySQL 迁移 005 与 schema 最小权限通过回读。
5. 15 次无参数请求中 027 命中 0 次。

正式写入仍需先把证据文档发布到团队可访问、不可歧义的版本库引用。写入时由后端 Interface 自动绑定当前运行时 `version + releaseId`，客户端不提供或覆盖这两个字段。

预期请求形状如下；`evidenceRef` 必须在相关提交 push 后替换为永久链接：

```json
{
  "target": "production",
  "itemId": "cloudrun_candidate_runtime",
  "status": "VERIFIED",
  "evidenceRef": "https://github.com/rijay/root/blob/<pushed-commit>/docs/production_gray_release_027_2026-07-13.md",
  "note": "027 0% candidate runtime gates verified; stable traffic unchanged"
}
```

行动时还必须使用唯一、稳定的 `X-Request-Id`，并在写入后回读证明项、版本、releaseId、证据引用和审计记录。不得把鉴权信息写入文档或命令记录。

## 5. T-015 判定

`release_artifact_traceability` 当前保持 `BLOCKED`：

1. 原始 ZIP、SHA-256、BuildId `2601322251`、版本和本地提交已能对应。
2. 原始 ZIP 与提交重建内容逐文件一致。
3. 但 `ef9fab9` 没有已推送分支或 tag，当前未提交的小程序路由修复与证据文档也未进入任何提交。
4. 原始 ZIP 已增加本地工作区保全副本，但回滚源码和原始工件仍未形成团队可获取的长期引用。

因此本轮不准备 T-015 的 `VERIFIED` 写入。关闭 T-015 前必须先：

1. 将当前候选相关改动拆成可审查提交；
2. 创建明确的 v0.5.12 候选 tag 或等价不可歧义引用；
3. 经单独确认 push 提交/tag；
4. 将原始 ZIP 或其受控工件记录保存到团队可获取的位置；
5. 用永久链接重新核对 ZIP、SHA-256、BuildId、版本、commit/tag 和回滚来源。

## 6. 写入影响与纠错方式

生产切换证明 Interface 是追加式记录，没有删除操作。若证明写错，纠错方式不是删除历史，而是使用新的请求 ID 追加 `REJECTED` 或重新验收后的 `VERIFIED`，由最新记录生效并保留审计轨迹。因此每个正式写入都必须单独确认，写入后立即回读。

## 7. 对抗式审查

1. **把内容一致误当字节一致**：已分别保留原始 SHA 和重建 SHA，并明确两者不可互换。
2. **把本机路径当正式证据**：T-012 在永久链接形成前不写入，T-015继续阻塞。
3. **把本地提交当远端追溯**：已用远端分支和 tag 包含关系验证，结果均为空。
4. **让客户端伪造候选绑定**：请求体不携带版本绑定，后端 Interface 从当前 027 运行时自动写入。
5. **错误证明无法回滚**：已确认该 Module 采用追加式纠错，不执行删除。

## 8. 结论

027 的运行证据和工件内容可复核，原始 ZIP 也已完成本地工作区保全，但正式远端证据引用尚未持久化。T-012 为 `EVIDENCE_READY_BUT_NOT_DURABLE`，T-015 为 `BLOCKED_BY_REMOTE_TRACEABILITY`；本轮没有向生产 Store 写入任何证明。保全记录见 [v0.5.12 发布工件本地持久化清单](./release_artifact_manifest_v0.5.12_2026-07-14.md)。
