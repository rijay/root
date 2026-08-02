# 材料与资产清单

## 1. 为什么不复制二进制文件

品牌 PDF、PANE 截图和候选 PNG 合计体积较大，且多数没有线上使用授权。为控制仓库体积，本交接包只登记路径、摘要、用途和权利状态。新任务应先检查文件存在和 SHA-256，再读取需要的材料。

## 2. ROOT 品牌与摄影材料

| assetId | 本机路径 | 字节数 | SHA-256 | 用途 | 发布状态 |
| --- | --- | ---: | --- | --- | --- |
| ROOT-BRAND-PDF | `/Users/rijay/Desktop/整理归档_2026-05-30/10_项目文件夹/Root项目/我们是ROOT.pdf` | 13,501,155 | `66d9dbaf47e3931603c27a81556c5be4bd59735e5ba614d50b15a8b94d716b7f` | 品牌系统、摄影选择 | 仅设计输入 |
| PHOTO-U-0790 | `/Users/rijay/Downloads/IMG_0790.PNG` | 727,284 | `c89e8a97d5cabdec6a7d39b7077336ee648f0ea4f293c0f9fae10c53d7c5716e` | 品牌封面候选 | 已选择；权利/clean master 待补 |
| PHOTO-U-0791 | `/Users/rijay/Downloads/IMG_0791.PNG` | 791,345 | `2cb8b94d94d8d5ec1a11d7f327284894428f5f358defbc1be1853ca46e3ec413` | 内部参考 | 禁用 |
| PHOTO-U-0792 | `/Users/rijay/Downloads/IMG_0792.PNG` | 492,119 | `118b811574a4644b41be1f46e3bb03d1a3706b877dac5efe66328f1d718d0f4f` | 内容候选 | 内容/权利待审 |
| PHOTO-U-0793 | `/Users/rijay/Downloads/IMG_0793.PNG` | 892,273 | `990e0cc5dd47b1791a43867f4573e047992dd79f9d896cbd88c54072e785d5b6` | 内部参考 | 禁用 |
| PHOTO-U-0794 | `/Users/rijay/Downloads/IMG_0794.PNG` | 684,428 | `5bb88792e2d4f88442259c6a21fed24f5102572c644484516e5c94500bbd2703` | 品牌封面候选 | 已选择；权利/clean master 待补 |

PDF 选择建议：P6 商品橱窗/PDP、P9 品牌故事、P10 健康概念视觉、P15 质量故事、P17 过渡/空状态、P18 摄影候选。P11 仅可作为证据图表，需核验来源。

所有 PDF 页面和带字 PNG 都不是可直接发布的 clean master。

## 3. PANE 参考材料

目录：`/Users/rijay/Downloads/pane小程序/`

包含：

- `首页引导1.PNG`、`首页引导2.PNG`
- `商品首页1.PNG`、`商品首页2.PNG`、`商品首页3.PNG`
- `商品内页1.PNG` 至 `商品内页4.PNG`
- `新用户注册1.PNG`、`新用户注册2.PNG`
- `首页点击订阅后.PNG`
- `企业微信-用户小程序推荐.PNG`
- `我的页面.PNG`、`我的页面2.PNG`

用途：信息架构、全屏品牌影像、商品详情层级、注册和会员页结构研究。权利状态：`REFERENCE_ONLY / DO_NOT_SHIP`。

## 4. Ardot 材料

| 材料 | 路径/标识 | 状态 |
| --- | --- | --- |
| CURRENT 顶层只读索引 | `docs/evidence/v1.0.0/ardot_current_screen_index_readonly_2026-07-18.json` | 仓库内，可复用 |
| 旧 12 屏总览图 | `/Users/rijay/Documents/Root/tmp/ardot_screenshots_reviewed/myroot_all_pages_reviewed_ordered_v1.png` | 历史四 Tab 参考，不是 CURRENT |
| Ardot 受控文件 | `myRoot` | 外部，需要重新连接 Ardot MCP |
| CURRENT UED 接受状态 | `OPEN / REVIEW_REQUIRED` | 未完成研发交付 |

重新连接 Ardot 时只读取 CURRENT 页面；排除 `ARCHIVE`、旧 AUTH 和 pre-R1 页面。任何可操作 fileId、编辑 URL 或写权限不应提交到公开仓库。

## 5. 仓库内可用资产

| 资产 | 路径 | 说明 |
| --- | --- | --- |
| ROOT 方形 logo | `miniprogram/static/brand/logo.png` | 加载与头像 |
| 横版 logo | `miniprogram/static/brand/root-logo-horizontal.png` | 浅底 |
| 反白横版 logo | `miniprogram/static/brand/root-logo-horizontal-light.png` | 深色 Hero |
| 旧活动 banner | `miniprogram/static/banner/activity.png` | 临时占位，需替换 |
| 完成徽章 | `miniprogram/static/badge/complete.png` | 旧任务完成态 |
| 便型图 | `miniprogram/static/stool/type1.png` 至 `type7.png` | 旧任务辅助，不是通用健康等级 |
| 原型图 | `docs/miniprogram_prototype.svg(.png)` | 历史结构参考 |

## 6. 待取得资产

- 五 Tab 成套图标与选中态；
- 6–10 张有完整商业授权的商品/生活方式 clean master；
- Hero/卡片/缩略图三档裁切；
- OPLUS SANS 字体文件及小程序渠道授权；
- 摄影师、权利人、人物/场地授权和允许渠道台账；
- 产品包装、实验室、认证和功效表述的内容审核证明。

## 7. 新任务读取命令

```bash
shasum -a 256 \
  '/Users/rijay/Desktop/整理归档_2026-05-30/10_项目文件夹/Root项目/我们是ROOT.pdf' \
  /Users/rijay/Downloads/IMG_079{0,1,2,3,4}.PNG

find '/Users/rijay/Downloads/pane小程序' -maxdepth 1 -type f -name '*.PNG' -print
```

摘要不一致时停止使用该文件，并更新清单；不要默认为同名文件仍是原资产。

