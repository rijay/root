# 微信订阅发送 endpoint 安全验证

时间：2026-07-20 02:17 +08:00  
目标：myRoot v1.0.0；运行/包版本仍为 0.5.13。

## 结论

旧发送链允许 `ROOT_WECHAT_SUBSCRIBE_SEND_URL` 指向任意 HTTPS 地址，并在解析该地址前先获取微信 access token。当前本地 Implementation 已将该风险改为多层 fail-close：

1. 微信 OpenAPI 通用目标只允许官方 HTTPS origin；仅非受保护测试运行时可为不携带订阅 token 的 OpenAPI 测试使用 loopback。
2. 订阅发送目标永远只允许 `https://api.weixin.qq.com/cgi-bin/message/subscribe/send`，测试模式也不放行 loopback。
3. 发送 Adapter 在获取 token 前验证目标，并在组装 credential-bearing URL 后、网络调用前再次验证。
4. `ROOT_CHECKIN_REMINDER_SEND_ENABLED=true` 时，服务器启动前执行相同 endpoint guard。
5. 生产环境矩阵要求 real-send flag 精确为 `true`，两个 endpoint 配置可缺省，但出现时必须为微信官方精确值。
6. HTTP Implementation 不跟随 302/307，因此 token 和 payload 不会被重定向到第二主机。
7. 静态合同禁止 Domain 重新拼装可配置 token URL，并固定验证顺序。

## 验证

- 聚焦安全测试：103/103 PASS。
- Backend：1310 tests，1301 PASS / 9 real-engine SKIP / 0 FAIL。
- Foundation：PASS。
- 最终离线检查：17/18；450 个 JavaScript 文件、66 个 migration checksum 和 1310 个 Backend tests 均通过。唯一失败仍是旧 `schema.sql` provenance，不属于本切片回归。

覆盖的负向包括恶意共享 base、恶意独立 send URL、HTTP、lookalike/非官方 origin、userinfo、query、fragment、尾斜杠、重复 token、空 token、test+K_SERVICE、test+CloudBase 标识、loopback token 目标和跨域 307。

## Gate 效力

本证据只关闭本地 endpoint token 外送风险，不关闭真实微信身份或订阅送达 Gate。仍缺 Candidate/生产 artifact digest 绑定、环境变量只读回读、网络出口只允许 `api.weixin.qq.com:443` 的平台证据、体验版真机身份、模板/额度与获授权真实送达回执。本轮没有读取凭据、连接 Candidate/生产、发送消息、部署、提交或推送。
