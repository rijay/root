function cleanNickname(value) {
  const text = String(value || "").trim();
  if (!text || text === "微信用户") return "";
  return text.slice(0, 24);
}

function cleanAvatarUrl(value) {
  const text = String(value || "").trim();
  if (!/^https?:\/\//i.test(text)) return "";
  return text;
}

function getWechatDisplayProfile() {
  return new Promise((resolve) => {
    if (!wx.getUserProfile) {
      resolve({});
      return;
    }
    wx.getUserProfile({
      desc: "用于完善 ROOT 体验官资料展示",
      success(result) {
        const userInfo = result.userInfo || {};
        resolve({
          nickname: cleanNickname(userInfo.nickName),
          avatarUrl: cleanAvatarUrl(userInfo.avatarUrl),
        });
      },
      fail() {
        resolve({});
      },
    });
  });
}

module.exports = {
  getWechatDisplayProfile,
};
