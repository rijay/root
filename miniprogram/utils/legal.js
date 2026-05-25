function openLegalPage(type) {
  const safeType = type === "privacy" ? "privacy" : "agreement";
  wx.navigateTo({
    url: `/pages/legal/index?type=${safeType}`,
  });
}

module.exports = {
  openLegalPage,
};
