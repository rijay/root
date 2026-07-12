function openLegalPage(type) {
  const safeType = type === "privacy" ? "privacy" : "agreement";
  if (safeType === "privacy" && typeof wx.openPrivacyContract === "function") {
    wx.openPrivacyContract({
      fail: () => wx.navigateTo({ url: "/pages/legal/index?type=privacy" }),
    });
    return;
  }
  wx.navigateTo({
    url: `/pages/legal/index?type=${safeType}`,
  });
}

module.exports = {
  openLegalPage,
};
