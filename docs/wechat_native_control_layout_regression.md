# 微信原生控件样式回归记录

## 问题

`v0.3.2` 线上“我的”页出现两类错位：

- `open-type="contact"` 的“人工协助”菜单行被渲染成居中按钮。
- `open-type="chooseAvatar"` 的头像选择区出现默认按钮边框和局部白底溢出。

这类问题在开发者工具里不一定稳定复现，但真机会保留部分微信原生控件的默认盒模型、边框和按钮态。

## 规则

- 不把 `button open-type` 直接作为菜单行、卡片、网格或复杂布局容器。
- 可见布局使用普通 `view`、`image`、`text`、`input` 承载。
- `button open-type` 只作为透明点击热区覆盖在可见布局上，使用 `position:absolute`、`opacity:0`、`::after { border:0 }`。
- `form` 不直接承担 `root-card` 等视觉卡片样式，外层用普通 `view.root-card`，内层只负责提交语义。
- 允许纯 CTA 按钮继续使用 `root-button` / `btn-*`，但每次新增 `open-type` 后都要真机看一眼。

## 提交前检查

- “我的”页资料完善卡片无左侧白块、无黑色按钮边框。
- “人工协助”整行左对齐，箭头右对齐，整行可点击。
- `chooseAvatar` 可拉起头像选择；`type="nickname"` 可显示微信昵称建议。
- iPhone 窄屏和大字体下，菜单行、卡片、底部 tab 不重叠。
- `npm run check --prefix miniprogram` 必须通过，脚本会拦截高风险的 `open-type` 布局类用法。
