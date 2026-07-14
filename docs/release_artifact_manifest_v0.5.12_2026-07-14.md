# v0.5.12 发布工件本地持久化清单

执行时间：2026-07-14 12:05 +08:00

状态：`LOCAL_PERSISTED / BYTE_IDENTICAL / REMOTE_NOT_AVAILABLE / T-015_BLOCKED`

## 1. 实际读取来源

1. 027 原始部署工件 `/private/tmp/myroot-api-v0.5.12-ef9fab932a08.zip`。
2. 本地提交 `ef9fab932a08cb2f48f63b04605e6ac9c94c8c19` 的 `backend` 树。
3. [027 候选证据](./production_gray_release_027_2026-07-13.md)与[生产切换证明预检](./production_cutover_proof_preflight_v0.5.12_2026-07-14.md)。
4. 当前 Git 远端分支和 tag 包含关系。

没有读取或写入运行凭据、路由值、用户数据、数据库配置或外部平台 token。

## 2. 工件记录

| 字段 | 值 |
| --- | --- |
| 版本 | `0.5.12` |
| CloudRun 候选 | `myroot-api-027` |
| releaseId | `v0.5.12+ef9fab932a08` |
| BuildId | `2601322251` |
| 来源提交 | `ef9fab932a08cb2f48f63b04605e6ac9c94c8c19` |
| `backend` 树 | `9e1525824c58f0807b3079239381ab6e9b45b07b` |
| 文件名 | `myroot-api-v0.5.12-ef9fab932a08.zip` |
| 大小 | `1,076,513 bytes` |
| SHA-256 | `ff4491fafa36f8dc68b12593c46ac258397c24bce89c780228d6aa1242b586cc` |
| 本地持久化位置 | `release-artifacts/v0.5.12/myroot-api-v0.5.12-ef9fab932a08.zip` |

原始临时文件与工作区副本通过字节比较，结果为 `IDENTICAL`；复制前后 SHA-256 完全一致。

## 3. 持久化策略

1. `release-artifacts/` 已加入根仓库 `.gitignore`，避免部署 ZIP 被误提交到普通源码历史。
2. Markdown 清单进入可审查工作树；二进制只作为正式远端发布前的本地保全副本。
3. 当前副本没有上传到 GitHub Release、对象存储或其他团队工件仓库，不构成永久 `evidenceRef`。
4. `ef9fab9` 仍不在远端分支或 tag 中，因此 T-015 继续保持 `BLOCKED`。

## 4. 关闭 T-015 的后续步骤

1. 将候选相关源码、证据文档和小程序路由修复拆成可审查提交。
2. 经单独确认 push 提交，并创建不可歧义的 v0.5.12 候选 tag。
3. 经单独确认把本地保全 ZIP 上传到团队可访问、权限受控的工件位置。
4. 从远端重新下载工件并核对 SHA-256、大小、BuildId、releaseId、commit、tag 和回滚源码。
5. 形成永久链接后，再单独确认写入 T-012/T-015 Evidence Intake。

## 5. 回退

本地保全没有改变生产环境。需要撤销时，删除 `release-artifacts/v0.5.12/` 副本，并撤销 `.gitignore` 条目和本清单；不涉及 CloudRun、数据库、Cloud Function 或小程序版本。

## 6. 对抗式审查

1. **本地工作区不是团队工件仓库**：本轮只降低临时文件丢失风险，不关闭 T-015。
2. **忽略二进制不等于没有证据**：清单保留来源、大小和哈希，但正式证明仍必须指向可获取的远端工件。
3. **SHA 一致不等于来源已发布**：提交和 tag 未 push，远端追溯继续阻塞。
4. **复制工件不等于重新构建**：保全的是 027 实际上传的原始 ZIP，而不是用重建 ZIP 替代原始哈希。
5. **可下载不等于可发布**：未来远端上传后仍需独立下载复核和凭据扫描，不能只相信上传成功提示。

## 7. 结论

027 原始 ZIP 已从易清理的系统临时目录复制到工作区保全位置，字节与哈希均未变化。该动作只完成本地耐久性改进；远端提交、tag、团队工件链接和 Evidence Intake 仍缺失，T-015 保持阻塞。
