const { request } = require("../../utils/request");
const router = require("../../utils/router");

Page({
  data: {
    phone: "",
    loading: false,
  },

  onShow() {
    router.routeGuard("/pages/order/match");
  },

  onPhoneInput(event) {
    this.setData({ phone: event.detail.value });
  },

  async submit() {
    if (!this.data.phone) {
      wx.showToast({ title: "请输入下单手机号", icon: "none" });
      return;
    }
    this.setData({ loading: true });
    try {
      const data = await request({
        url: "/api/v1/order/match",
        method: "POST",
        data: { phone: this.data.phone },
      });
      wx.showToast({
        title: data.canStartCheckin ? "订单已送达" : "订单已匹配",
        icon: "success",
      });
      router.go("/pages/home/index");
    } catch (error) {
      wx.showModal({
        title: "未匹配到订单",
        content: error.message || "请确认收货手机号，或联系企业微信人工确认。",
        confirmText: "返回活动",
        success: (res) => {
          if (res.confirm) wx.navigateBack();
        },
      });
    } finally {
      this.setData({ loading: false });
    }
  },
});
