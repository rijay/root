# R10 本地 MySQL 准备验证（未授权、未执行）

时间：2026-07-20 01:33 +08:00  
版本目标：v1.0.0；运行/包版本仍为 0.5.13。

## 结论

Attempt 9 的唯一失败已定位为 `TEST_FIXTURE_SLO_PROFILE_DRIFT`：夹具把告警严重度 `BLOCKER` 误作投递 SLO class，并传入 `60` 秒；正式映射应为 `BLOCKER -> BLOCKER_IMMEDIATE / 300`。源头夹具已改为引用唯一 Policy Module；001～065 未修改。新增 immutable migration 066，使两个受控注册 procedure 同时校验持久化告警严重度与 SLO profile，阻断合法 pair 的跨事实错配。

本地验证结果：受影响测试 64/64 PASS；R10 focused/安全合同 53/53 PASS；Backend 1296 tests（1287 PASS、9 real-engine SKIP、0 FAIL）；Foundation PASS。离线最终检查为 17/18，唯一失败是 committed `backend/db/schema.sql` 仍绑定 001～057，而当前 migration-set 已为 001～066。该快照不得手工更新；只有获授权的真实 MySQL 成功路径才允许 write 和独立 verify。

## R10 冻结包

- JSON：`docs/evidence/v1.0.0/mysql_001_066_local_authorization_packet_2026-07-20_r10.json`
- SHA-256：`406d69b069eded1af6f96968ded41679c4d53d2f0baed1d60259f4d1b84f96c4`
- nonce：`66d0134b-d70e-497b-a9a3-9bf78530ae0f`
- 状态：`PREPARED_NOT_AUTHORIZED_NOT_EXECUTED`
- migration-set：001～066，共 66 个；digest=`c385ef2952d272a961420a5c3df5886cab7a36325cdf7729a13484744d561cb4`

未设置授权环境运行时，Runner 在 Docker 前以 `MYSQL_LOCAL_RUNNER_NOT_AUTHORIZED` 拒绝；受管容器残留为 0，R10 nonce 未消费。

## Gate 效力

本文件和 R10 包都不构成执行授权。它们不关闭本地真实引擎、schema snapshot、Candidate/生产 MySQL、容量、真实送达或正式上线 Gate。若要执行，必须对当前精确 packet SHA 与 nonce 重新给予一次性明确授权；失败仍须立即停止并清理。
