# MySQL 001-065 本机执行结果（Attempt 6）

- 时间：2026-07-19 22:11:22 +08:00
- 授权包：`mysql_001_065_local_authorization_packet_2026-07-19_r6.json`
- 授权包 SHA-256：`58f04a58a10c50acd7942bfe94a901416ccde49625079685b219b09e93cb0b83`
- 单次 nonce：`91a87317-7cf5-4eeb-ade7-47e684a8bb7b`（已消费，不得复用）
- 范围：仅本机 `127.0.0.1` 随机临时端口；未连接 Candidate/生产；未部署、提交或推送
- 结果：`FAIL_FROZEN_REAL_ENGINE_CHECK_CLEANED`

## 实际结果

固定的 MySQL 8.0.43 镜像通过宿主机认证型 readiness。冻结命令 `npm run v1:mysql-001-065-authorized:check` 随后执行，结果为 13 项中 10 PASS、3 FAIL、0 SKIP，退出码 1，总耗时 20723.063625 ms。

本次有界、脱敏诊断确认：

1. provider-call fence 真实引擎测试在 `prepareCoreAttempt` 调用 `recordDecision` 时失败；4096-byte tail 从调用栈中段开始，未保留异常消息与首个 failing subtest 标签，因此不能据此断言具体根因。
2. runtime principal 测试读取 `SHOW CREATE PROCEDURE` 结果的 `Definer` 字段得到 `undefined`；真实 MySQL 将 definer 放在 `Create Procedure` DDL 内，当前测试断言读取了不存在的字段。
3. runtime alert delivery 的并发 claim race 返回 0 个 truthy claim，预期为 1；当前诊断只证明第 442 行的 `0 !== 1`，尚不能单凭该 tail 区分返回形状、事务可见性或存储过程行为。

完整脱敏 stdout 的 SHA-256 为 `a6634680438566a2f2f969816944aeee136c28f4f5dcf6d3f4a802dc0a447c2a`；runner 仅保留限长 tail，没有记录密码或随机端口。

## 停止与清理

- 冻结检查首次返回非零后立即停止，没有自动重试。
- `db:schema-snapshot:write`、独立 snapshot verify 和最终 repository verify 均未运行。
- runner 报告 `containerRemoved=true`；按 ownership label 复核，残留容器数为 0。
- 本机原有 3 个无关运行中容器未被修改。
- `backend/db/schema.sql` 保持 SHA-256 `e84fe654b674981917c472cc73593657dd6a9189dd32b736ff1bae895be7a7c3`，修改时间仍为 2026-07-18 19:30:22 +08:00。

## Gate 结论

本次失败不关闭本地 MySQL 实证、schema snapshot provenance、Candidate/生产 MySQL、容量或真实送达 Gate。后续必须先完成根因修复、重新冻结新包并取得新的单次明确授权；R6 nonce 不得复用。
