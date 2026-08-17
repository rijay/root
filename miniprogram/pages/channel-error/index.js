const {
  channelErrorUrl,
  confirmPendingAttribution,
  parseScannedAttribution,
  storeScannedAttribution,
} = require("../../utils/channel-attribution");
const { openEntryTarget } = require("../../utils/entry-launch");

const REASON_COPY = Object.freeze({
  PAYLOAD_INVALID: "二维码信息不完整，请从官方渠道重新获取。",
  QR_EXPIRED: "二维码已过期，请使用最新二维码进入。",
  SIGNATURE_INVALID: "二维码未通过校验，请确认来源后重试。",
  SIGNATURE_KEY_MISMATCH: "二维码版本已更新，请使用最新二维码。",
  SIGNATURE_KEY_UNAVAILABLE: "渠道校验暂不可用，请稍后重试。",
  CHANNEL_INACTIVE: "该渠道入口当前已停止使用。",
  CAMPAIGN_UNAVAILABLE: "对应活动当前不可用。",
  TARGET_NOT_ALLOWED: "该二维码不能打开指定页面。",
});

Page({
  data: {
    reason: "PAYLOAD_INVALID",
    message: REASON_COPY.PAYLOAD_INVALID,
    scanning: false,
  },

  onLoad(options = {}) {
    const reason = /^[A-Z0-9_]{1,64}$/.test(String(options.reason || ""))
      ? String(options.reason)
      : "PAYLOAD_INVALID";
    this.setData({ reason, message: REASON_COPY[reason] || REASON_COPY.PAYLOAD_INVALID });
  },

  goHome() {
    wx.switchTab({ url: "/pages/home/index" });
  },

  rescan() {
    if (this.data.scanning) return;
    this.setData({ scanning: true });
    wx.scanCode({
      onlyFromCamera: true,
      scanType: ["qrCode"],
      success: async (result) => {
        const parsed = parseScannedAttribution(result);
        if (!parsed.payload) {
          wx.redirectTo({ url: channelErrorUrl(parsed.reason || "PAYLOAD_INVALID") });
          return;
        }
        storeScannedAttribution(parsed.payload);
        const confirmed = await confirmPendingAttribution();
        if (confirmed.state === "REJECTED") {
          wx.redirectTo({ url: channelErrorUrl(confirmed.reason) });
          return;
        }
        openEntryTarget(parsed.payload.targetPage || "/pages/home/index");
      },
      fail: () => null,
      complete: () => this.setData({ scanning: false }),
    });
  },
});
