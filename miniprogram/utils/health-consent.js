const { request } = require("./request");
const env = require("../config/env");

const LOCAL_DEVICE_PURPOSES = Object.freeze([
  "在当前设备完成 Root4U 健康起点评测与肠道规律自测",
  "在当前设备生成生活方式观察结果、复测历史与同版对比",
  "记录你对本说明的同意或撤回审计事实",
]);

function presentHealthPrivacyNotice(notice = {}) {
  if (env.healthAssessmentStorageMode !== "LOCAL_DEVICE") return notice;
  const retentionDays = Number(env.healthAssessmentRetentionDays) || 180;
  return {
    ...notice,
    storageMode: "LOCAL_DEVICE",
    purposes: LOCAL_DEVICE_PURPOSES.slice(),
    necessity: "问卷答案、评测结果和回测记录仅在当前设备处理，不上传至 myRoot 服务器；服务器仅保存同意或撤回的审计记录，以及保障接口安全所必需的最少技术记录，不包含问卷答案和评测结果。",
    modelProcessingText: "当前设备模式不调用模型服务，仅展示经审核的固定生活方式建议。",
    retentionDays,
    retentionText: `问卷答案、评测结果和回测记录自最后保存起最长保留 ${retentionDays} 天，到期自动从本机删除；你也可通过微信清理小程序数据提前删除。更换设备或清理数据后无法恢复。同意或撤回审计记录按法律与安全所需的最短期限保存。`,
  };
}

let navigating = false;

async function getHealthConsentStatus() {
  const status = await request({ url: "/api/v1/privacy/health-consent" });
  return { ...status, notice: presentHealthPrivacyNotice(status && status.notice) };
}

async function ensureHealthConsent(options = {}) {
  const shouldNavigate = options.navigate !== false;
  try {
    const status = await getHealthConsentStatus();
    if (!status.required || status.active) return true;
    if (!status.configured) {
      if (shouldNavigate) {
        wx.showModal({
          title: "暂时无法提交",
          content: "敏感信息处理说明尚未配置，请先使用商品浏览或人工协助。",
          showCancel: false,
        });
      }
      return false;
    }
    if (shouldNavigate && !navigating) {
      navigating = true;
      wx.navigateTo({
        url: "/pages/health-consent/index",
        complete: () => { navigating = false; },
      });
    }
    return false;
  } catch (error) {
    wx.showToast({ title: error.message || "隐私说明加载失败", icon: "none" });
    return false;
  }
}

module.exports = {
  ensureHealthConsent,
  getHealthConsentStatus,
  presentHealthPrivacyNotice,
};
