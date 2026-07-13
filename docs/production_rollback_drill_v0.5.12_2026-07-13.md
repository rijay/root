# myRoot v0.5.12 本地完整回滚演练

日期：2026-07-13

状态：`PASS / LOCAL_SIMULATION / DOES_NOT_CLOSE_PRODUCTION_GATE`

## 1. 实际读取来源

1. `externalPlatformAdapters`、`externalAdapterSamples`、`domain`、`auditLog` 和发布回滚 Gate Module。
2. 现有订单、物流、有赞客户、企微线索、增量游标、幂等和 HTTP Interface 回滚测试。
3. `release_readiness.md`、`formal_launch_gate_v0.5.12_2026-07-13.md` 与外部 Adapter 正式接入执行包。

## 2. 缺失材料与工作假设

1. 本轮没有连接生产 MySQL、CloudBase 流量、Cloud Function 或真实外部平台，只使用内存 Store 和合成数据。
2. 已发优惠券、已写企微标签等不可自动逆转的外部动作未执行；它们仍需运营人工核对、作废或补偿路径。
3. 数据库快照恢复、候选流量回滚、Cloud Function 代码包回退和 5% 灰度阈值不属于本地业务数据演练，仍需在正式候选阶段验证。
4. 因此本证据只关闭“回滚 Implementation 可重复执行”的本地缺口，不能写入 `rollback_drill_completed` 正式生产证明。

## 3. 工具与修改范围

执行命令：

```bash
npm run rollback:drill --prefix backend
node --test backend/tests/production_rollback_drill.test.js
```

新增 `Production Rollback Drill Module`、CLI Adapter 和专向测试；不保存凭据，不调用外部 Interface，不修改生产 Store、流量或任务状态。

## 4. 演练结果

最终结果：`9/9 PASS`，共生成 6 条带操作人的回滚审计。

| 检查项 | 结果 | 证明内容 |
| --- | --- | --- |
| `order_snapshot_restore` | PASS | 错误订单导入后恢复收货、金额、状态和地址字段快照 |
| `fulfillment_snapshot_restore` | PASS | 恢复物流与订单配送状态，清除错误承运商和运单号 |
| `customer_snapshot_restore` | PASS | 恢复有赞客户 unionid、手机号和昵称快照 |
| `lead_snapshot_restore` | PASS | 恢复企微线索备注、来源、活动、添加状态和运营备注 |
| `created_records_removed` | PASS | 删除本次新建订单及其履约记录 |
| `cursor_restore` | PASS | 恢复真实 Adapter 模拟导入前的空游标和成功运行引用 |
| `repeat_rollback_rejected` | PASS | 同一运行重复回滚返回 `409`，未重复修改数据 |
| `manual_sample_fallback` | PASS | 真实 Adapter 配置失败后进入人工复核，`MANUAL_SAMPLE / PREVIEW` 可继续且不写业务数据 |
| `rollback_audit_complete` | PASS | 6 次回滚均记录统一操作人审计 |

## 5. 对抗式审查

1. **最可能误判：把合成数据 PASS 当成生产 PASS。** 已用 `LOCAL_SIMULATION` 和 `DOES_NOT_CLOSE_PRODUCTION_GATE` 双重标记，并禁止自动生成正式证明。
2. **最可能漏项：只恢复新记录，不恢复既有字段。** 演练同时覆盖订单、物流、客户和企微线索的 before-snapshot 恢复。
3. **最可能重复破坏：同一 runId 被再次回滚。** 第二次请求必须返回 `409`，且不新增回滚审计。
4. **最可能形成双写：真实 Adapter 失败后直接改用人工 IMPORT。** 演练只开放 `MANUAL_SAMPLE / PREVIEW`，确认不写业务数据；正式 IMPORT 仍需独立授权。
5. **最可能掩盖不可逆动作：把发券或外部标签视为可自动撤销。** 报告明确保留运营人工核对与补偿，不提供自动重放或伪回滚。

## 6. 正式候选仍需验证

1. 迁移后 MySQL 快照可恢复，并回读 `/ready`、迁移 `005` 和核心关系表。
2. `v0.5.12` 0% 候选可回退到当前稳定版本，默认流量不误命中候选。
3. 两个 Cloud Function 代码包可回退，11 个 Job 保持 dry-run 且不重复执行。
4. 5% 灰度超过错误率、延迟或业务异常阈值时，流量回滚命令和负责人路由可用。
5. 运营按手工 SOP 完成一条订单/客户/物流/企微线索纠错，并留存脱敏引用。
