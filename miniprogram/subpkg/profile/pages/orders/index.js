const { request } = require("../../../../utils/request");
const router = require("../../../../utils/router");

function statusView(order) {
  const deliveryStatus = order.deliveryStatus || "";
  if (deliveryStatus === "EXCEPTION") {
    return {
      label: "需核对",
      className: "danger",
      title: "物流异常",
      copy: "物流或订单状态需要运营协助确认。",
    };
  }
  if (deliveryStatus === "DELIVERED") {
    return {
      label: "已送达",
      className: "done",
      title: "订单已送达",
      copy: "已同步到 myRoot，可按活动规则继续参与任务和结算。",
    };
  }
  if (deliveryStatus === "SHIPPED") {
    return {
      label: "配送中",
      className: "pending",
      title: "配送中",
      copy: "订单已同步，物流还在更新中。",
    };
  }
  if (deliveryStatus === "CANCELLED") {
    return {
      label: "已取消",
      className: "muted",
      title: "订单已取消",
      copy: "如状态不一致，请联系顾问协助核对。",
    };
  }
  return {
    label: order.youzanOrderNo ? "待发货" : "待同步",
    className: "pending",
    title: order.youzanOrderNo ? "订单待发货" : "订单待同步",
    copy: order.youzanOrderNo ? "订单已同步，等待 Root 会员中心发货。" : "购买后订单会自动同步到 myRoot。",
  };
}

function matchSourceLabel(value) {
  return {
    AUTO_PHONE: "手机号自动匹配",
    AUTO_WECHAT_PHONE: "微信手机号自动匹配",
    AUTO_YOUZAN_CUSTOMER: "有赞客户自动补链",
    ADMIN_MANUAL_MATCH: "运营手动确认",
    MANUAL: "运营手动同步",
    MANUAL_REVIEW: "人工复核确认",
  }[value] || (value ? "已匹配" : "待匹配");
}

function formatTime(value) {
  const text = String(value || "");
  if (!text) return "";
  return text.replace("T", " ").slice(0, 16);
}

function buildOrder(order) {
  const status = statusView(order);
  const fulfillment = order.fulfillment || {};
  return {
    ...order,
    statusLabel: status.label,
    statusTitle: status.title,
    statusCopy: status.copy,
    statusClass: status.className,
    matchSourceLabel: matchSourceLabel(order.matchSource),
    matchedAtText: formatTime(order.matchedAt),
    shippedAtText: formatTime(fulfillment.shippedAt),
    deliveredAtText: formatTime(fulfillment.deliveredAt),
    hasLogistics: Boolean(fulfillment.carrier || fulfillment.trackingNo || fulfillment.lastEventText),
  };
}

function buildSummary(orders) {
  if (!orders.length) {
    return {
      heroClass: "idle",
      heroTitle: "订单待同步",
      heroCopy: "myRoot 不强制绑定订单。你可以先完成打卡、问卷和咨询；如活动规则需要购买条件，订单同步后会自动参与判断。",
      primaryAction: "查看商品",
      secondaryAction: "联系顾问",
    };
  }
  if (orders.some((order) => order.deliveryStatus === "EXCEPTION")) {
    return {
      heroClass: "danger",
      heroTitle: "订单需人工核对",
      heroCopy: "发现物流或订单异常。请联系顾问协助确认，不会影响你继续查看任务和奖励状态。",
      primaryAction: "联系顾问",
      secondaryAction: "刷新状态",
    };
  }
  if (orders.some((order) => ["SHIPPED", "NOT_SHIPPED", ""].includes(order.deliveryStatus || ""))) {
    return {
      heroClass: "pending",
      heroTitle: "订单同步中",
      heroCopy: "已找到 Root 会员中心订单，物流或发货状态会继续同步。可稍后刷新查看。",
      primaryAction: "刷新状态",
      secondaryAction: "联系顾问",
    };
  }
  return {
    heroClass: "done",
    heroTitle: "订单已同步",
    heroCopy: "Root 会员中心订单已同步到 myRoot，可用于活动规则、物流展示和后续结算判断。",
    primaryAction: "刷新状态",
    secondaryAction: "联系顾问",
  };
}

function buildView(data = {}) {
  const orders = (data.orders || []).map(buildOrder);
  return {
    orders,
    ...buildSummary(orders),
  };
}

Page({
  data: {
    loading: true,
    errorText: "",
    orders: [],
    heroClass: "idle",
    heroTitle: "订单待同步",
    heroCopy: "myRoot 不强制绑定订单。你可以先完成打卡、问卷和咨询；如活动规则需要购买条件，订单同步后会自动参与判断。",
    primaryAction: "查看商品",
    secondaryAction: "联系顾问",
  },

  async onShow() {
    const allowed = await router.routeGuard("/subpkg/profile/pages/orders/index");
    if (allowed) this.load();
  },

  async load() {
    this.setData({ loading: true, errorText: "" });
    try {
      const data = await request({ url: "/api/v1/user/orders" });
      this.setData(buildView(data));
    } catch (error) {
      this.setData({ errorText: error.message || "订单状态加载失败" });
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  handlePrimaryAction() {
    if (this.data.primaryAction === "查看商品") {
      wx.switchTab({ url: "/pages/products/index" });
      return;
    }
    if (this.data.primaryAction === "联系顾问") {
      this.openSupport();
      return;
    }
    this.load();
  },

  handleSecondaryAction() {
    if (this.data.secondaryAction === "刷新状态") {
      this.load();
      return;
    }
    this.openSupport();
  },

  openSupport() {
    router.go("/subpkg/profile/pages/support/index");
  },
});
