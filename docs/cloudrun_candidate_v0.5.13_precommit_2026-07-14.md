# myRoot CloudRun v0.5.13 预提交候选工件

日期：2026-07-14

状态：`PRECOMMIT_ARTIFACT_PASS / LOCAL_ONLY / NOT_TRACEABLE / DO_NOT_DEPLOY`

## 1. 实际读取来源

1. 当前工作树的 `backend/` 下所有 Git 已跟踪文件与未忽略的新候选文件，共 181 个。
2. `scripts/prepare-cloudrun-candidate-source.js` 及其专向测试。
3. 当前 v0.5.13 全量验证结果、027 历史工件结构与 T-015 追溯要求。

本轮只写 `/tmp` 和 `/private/tmp` 下的预提交文件，没有上传工件、创建 CloudRun 版本、修改环境变量、写生产 Store、改流量或改 Git 历史。

## 2. 缺失与限制

1. 该工件构建时工作树尚未 commit，因此它没有不可歧义的来源提交、Git tree 或正式 `ROOT_RELEASE_ID`；随后创建 `c3d14f2` 不会追溯性地改变该工件属性。
2. 该 ZIP 只用于证明当前工作树可以形成合法候选结构，不得上传为 028，不得用于 T-012/T-015，也不得进入团队工件仓库。
3. 创建本地提交后必须从提交的 `backend` tree 重新生成新 ZIP；预提交 ZIP 的哈希不得沿用。
4. 本机仍未安装 `gitleaks` 或 `trufflehog`，凭据模式扫描不能视为绝对泄露保证。

## 3. 工件结果

| 字段 | 结果 |
| --- | --- |
| ZIP | `/private/tmp/myroot-api-v0.5.13-precommit-20260714-r2.zip` |
| 版本 | `0.5.13` |
| 文件/条目 | `181 / 181` |
| 未压缩总字节 | `4,039,762` |
| ZIP 字节 | `1,073,862` |
| ZIP SHA-256 | `fc4f6e7aedf53eac5567a401ac04ff305878ff8248e2167013fc871875d44b1f` |
| 源清单 SHA-256 | `7adc0262a5f61a728662c7010e759de73f7cfb49599f7cd71179a40ab8d51c71` |
| 解压目录 | `/tmp/myroot-cloudrun-candidate-v0.5.13-precommit-20260714-r2` |
| 清单 | `/tmp/myroot-cloudrun-candidate-v0.5.13-precommit-20260714-r2.manifest.json` |

## 4. 防护与验证

1. 文件列表无重复，所有 181 个文件可读；`Dockerfile`、`package.json` 与 `src/server.js` 存在。
2. ZIP 完整性检查通过，解压文件集合与 ZIP 条目精确一致。
3. 禁止路径、`.env`、密钥文件、日志、SQLite、`node_modules`、`.git`、数据目录和符号链接均为 0。
4. 包版本精确匹配 `0.5.13`；`src/wechatAccessToken.js` 与对应测试进入工件。
5. 高风险模式扫描未命中私钥、腾讯云 AKID、MySQL URI 或 JWT 字面量。
6. 唯一长 Bearer 形态位于 `tests/cloudbase_object_storage_adapter.test.js`，是合成的对象存储测试哨兵，不是运行凭据。
7. 候选源准备脚本专向测试 `4/4 PASS`；完整 `npm run verify` 仍为 `16/16 PASS`。
8. 首次使用 `/private/tmp/...` 作为解压目标时，工具因要求路径字面量为直接 `/tmp` 子目录而失败关闭，未创建目标；改用受控 `/tmp` 路径后通过。这证明输出位置约束实际生效。
9. 发布工具父目录逃逸修复后重新运行完整验收和打包。r2 与首包的源清单 SHA-256 同为 `7adc0262a5f61a728662c7010e759de73f7cfb49599f7cd71179a40ab8d51c71`，但 ZIP SHA-256 因容器时间元数据变化而不同；首包已被 r2 取代，二者都不可部署。

## 5. 提交后的正式工件顺序

1. 已完成：运行候选提交为 `c3d14f2`，部署与证据由随后文档提交收录。
2. 从该提交的 `backend` tree 生成全新 ZIP，不从脏工作树复制。
3. 使用提交短哈希形成唯一 `ROOT_RELEASE_ID=v0.5.13+<commit>`。
4. 重跑文件集合、版本、迁移、凭据模式、ZIP 完整性、解压清单与 SHA-256 检查。
5. 只有正式提交工件通过后，才可另行确认部署 `myroot-api-028 / 0%`。

## 6. 结论

该预提交工件证明 v0.5.13 工作树具备形成合法 CloudRun 候选包的能力，但工件本身没有来源提交，明确不可部署。创建本地提交不会改变其 `DO_NOT_DEPLOY` 状态；仍须从最终 HEAD 重建，且不关闭 028 运行、远端追溯、真机、提醒或正式发布 Gate。
