// 运营配置缺失时必须保持关闭。活动 ID、展示周期、文案和渠道签名
// 由运营确认后再录入，禁止用示例值触发真实用户流程。
module.exports = Object.freeze({
  campaignPopup: Object.freeze({
    enabled: false,
    campaignId: "",
    title: "",
    content: "",
    confirmText: "去看看",
    cancelText: "稍后再说",
    action: Object.freeze({ type: "PRODUCT", productId: "" }),
    startsAt: "",
    endsAt: "",
  }),
  channels: Object.freeze([]),
});
