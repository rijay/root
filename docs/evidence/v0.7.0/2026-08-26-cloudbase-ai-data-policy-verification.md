# CloudBase AI 账户级数据策略核验记录

- 核验日期：2026-08-26
- 环境：`myroot-prod-d5gl3gzg7115f149a`（控制台显示名称 `myroot-prod`）
- 核验范围：大模型调用日志字段、日志保存时长、Chat Completions 缓存控制能力
- 核验方式：已登录 CloudBase 控制台只读检查；未修改环境配置，未调用模型，未读取或导出请求/响应正文

## 直接观察

1. CloudBase 的“日志监控 → 大模型”列表包含 `input`（请求内容）和 `output`（响应内容）字段，说明平台日志能力可以保存模型请求与响应正文。
2. 大模型日志当前保存时长显示为 **7 天**。
3. 保存时长输入框明确标注“支持保存 1-3600 天内的日志记录”，控制台没有关闭或 0 天选项。
4. 最近 1 小时查询结果为“暂无数据”；这只说明该时间窗没有可见的大模型日志，不能证明更早时间窗无数据，也不能证明日志采集已关闭。
5. 项目负责人随后决定保留当前 7 天设置；因此无需修改该环境，也不会触发历史日志提前清除。

控制台证据：[`2026-08-26-cloudbase-ai-log-retention-min-1d.jpg`](./2026-08-26-cloudbase-ai-log-retention-min-1d.jpg)

## 官方材料核验

- [CloudBase 上下文缓存](https://docs.cloudbase.net/ai/model/cache)：Chat Completions API 不支持客户端缓存控制；服务端可能做内部缓存优化；缓存 TTL 通常约 5 分钟。
- [CloudBase `SearchClsLog` API](https://cloud.tencent.com/document/product/876/128127)：官方查询示例将大模型日志标识为 `module:llm AND logType:llm-tracelog`，与控制台“大模型”日志入口一致。

当前健康建议 Adapter 使用 `/chat/completions`，因此不能通过请求参数证明服务端缓存为 0。官方文档中的“通常 5 分钟”也不是对本账户最长保存期限的合同承诺。

## 结论

- 项目已把模型请求/响应日志上限调整为 7 天，当前账户日志设置满足该项要求。
- Chat Completions 服务端缓存仍不能证明已关闭或保留 0 天，因此 `ROOT_HEALTH_ADVICE_MODEL_DATA_POLICY_VERIFIED` 仍不得设为 `true`，正式模型调用继续 fail-close，固定建议降级路径不受影响。
- 后续需取得缓存关闭或 0 天的账户/合同级证据，并同步完成更新后的单独同意与发布验收；不得用“通常 5 分钟”替代最长时限或关闭证据。
