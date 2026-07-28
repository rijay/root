# myRoot v1.0.0 本地 MySQL 就绪台账

截至 2026-07-20 02:17 +08:00，本地 001～066 engine proof 仍为 OPEN。历史 `local_verification_summary_2026-07-19.json` 是多次执行前的 checkpoint，不再代表当前字节。

## 已消费执行

| Attempt | 结果 | 真实测试 | 清理 |
|---|---|---:|---|
| 1 | Harness 并行编排与 Docker bridge principal host 缺陷 | 7 PASS / 5 FAIL | 容器已删除 |
| 2 | `mysqladmin ping` 假就绪，真实 SQL 认证 1045 | 冻结命令未启动 | 容器已删除 |
| 3 | 宿主机认证型 readiness SQL 返回 `ER_PARSE_ERROR` | 冻结命令未启动 | 容器已删除 |
| 4 | Readiness 通过，冻结真实引擎检查退出 1；失败路径未回传子测试诊断 | 已启动，结果计数不可得 | 容器已删除 |
| 5 | Readiness 通过，冻结真实引擎检查发现 3 个真实失败 | 10 PASS / 3 FAIL / 0 SKIP | 容器已删除 |
| 6 | Readiness 通过，冻结真实引擎检查仍发现 3 个真实失败 | 10 PASS / 3 FAIL / 0 SKIP | 容器已删除 |
| 7 | Readiness 通过，冻结真实引擎检查仍发现 2 个真实失败 | 11 PASS / 2 FAIL / 0 SKIP | 容器已删除 |
| 8 | Readiness 通过；结构化诊断定位运行主体夹具 authority version 漂移 | 12 PASS / 1 FAIL / 0 SKIP | 容器已删除 |
| 9 | Readiness 通过；受控告警投递注册触发 `chk_v1_runtime_alert_delivery_slo` | 12 PASS / 1 FAIL / 0 SKIP | 容器已删除 |

九次结果都没有关闭本地、Candidate 或生产 Gate。Attempt 9 保持 12/13；后续只读审计确认根因为 `TEST_FIXTURE_SLO_PROFILE_DRIFT`：夹具使用 `BLOCKER / 60`，正式 profile 为 `BLOCKER_IMMEDIATE / 300`。源头夹具已修正，并新增 migration 066 强制持久化告警严重度与 SLO profile 一致；该修正尚未在真实 MySQL 执行。

## 当前本地基线

- Backend：1317 tests，1308 PASS、9 real-engine SKIP、0 FAIL。
- Foundation：PASS。
- R11 Runner/schema/packet 合同合计 44/44 PASS；完整执行输入与工具链闭包已冻结。
- R9 准备验证是执行前证据；R9 已于本轮单次授权执行并失败清理，不再代表当前可执行状态。
- 微信订阅 endpoint 安全聚焦测试：103/103 PASS；任意 HTTPS、loopback token 目标、受保护运行时 test 绕过和跨域 redirect 均 fail-close。本地证据不关闭真实送达 Gate。
- Final verification：17/18；450 个 JavaScript 文件、66 个 migration checksum、Backend、依赖、后台、小程序和 HTTP Interface 均通过。唯一失败是 committed `schema.sql` 仍绑定 001～057，而当前 migration-set 已到 066。

## 最近一次已消费包

- R9 SHA-256：`2dc3d74eb33af4e641eb09e935cddf9c6e2035ac1c7b7d84c23c1007c8e797db`
- 单次 nonce：`7f2aca54-87ea-4c48-bf8c-096dcbbcdd4a`
- 状态：`AUTHORIZED_ONCE_EXECUTED_FAILED_AND_CLEANED`
- 单次 nonce 已消费，不能复用；`backend/db/schema.sql` 未更新。
- 仅使用一次性、本机 `127.0.0.1` 随机端口；不连接 Candidate/生产。

## 下一次包

R10 未执行且 nonce 未消费，但因 post-success provenance 闭包不完整已被 R11 取代，不得再执行。当前唯一下一包为 R11：

- packet SHA-256：`d0369e06f7fb57a2085cd5a567bf775370fe0ae2a43178179465a435e7aa3016`
- 单次 nonce：`dd1a2ef2-8687-4509-a799-0960748cb6fd`
- migration-set：001～066；digest=`c385ef2952d272a961420a5c3df5886cab7a36325cdf7729a13484744d561cb4`
- 未授权防护已证明在 Docker 前拒绝，受管容器残留 0，nonce 未消费。

R11 只有在针对上述精确 SHA 与 nonce 再次取得单次明确授权后才可执行。即使未来完全通过，也只推进本地 engine/schema proof；远端 CI、Candidate/生产 MySQL 与容量等正式 Gate 仍保持 OPEN。
