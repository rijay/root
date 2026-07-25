# R11 本机 MySQL 授权前验证

状态：`PASS_PREPARED_NOT_AUTHORIZED_NOT_EXECUTED`。

R11 JSON SHA-256=`d0369e06f7fb57a2085cd5a567bf775370fe0ae2a43178179465a435e7aa3016`，单次 nonce=`dd1a2ef2-8687-4509-a799-0960748cb6fd`，均未被授权或消费。未授权调用在 Docker 前以 `MYSQL_LOCAL_RUNNER_NOT_AUTHORIZED` 拒绝，退出码 1；nonce marker=0，受管容器残留=0。

R11 取代未执行的 R10，并新增完整执行闭包：688 个执行输入 aggregate SHA-256=`36dd29f585c0192c889ea193de1ce7a4d3e6a554cbae61fee779271e12d0a4ec`，绑定 Node/npm 工具链、四阶段精确 argv、阶段前后重验、三处 mutable output allowlist、失败回滚、原子 schema 替换以及 schema/final verify 结构化结果。

无 Docker 验证结果：

- R11 packet contract：3/3 PASS。
- Runner + schema focused：41/41 PASS。
- Backend：1317 tests，1308 PASS、9 个真实 MySQL 分支按预期 SKIP、0 FAIL。
- Foundation：PASS。
- Final offline verification：17/18；唯一失败仍是 committed `schema.sql` 只证明 001～057，而当前迁移集为 001～066。这是 R11 获精确授权并成功执行后才允许更新的真实引擎证据，禁止手工绕过。

本文件与 R11 包都不构成执行授权。即使未来 R11 完全通过，也不关闭远端 CI、Candidate/生产 MySQL、容量、真实身份/送达、IAM、告警、密钥、内容/UED/摄影或正式上线 Gate。
