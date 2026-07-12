const {
  getPrivacySetting,
  initializePrivacyAuthorization,
  openPrivacyContract,
  setPrivacyPresenter,
} = require("../../utils/privacy-authorization");

const PURPOSE_LABELS = {
  "button.getPhoneNumber": "手机号快捷验证",
  "button.chooseAvatar": "选择头像",
  chooseMedia: "选择打卡图片",
  chooseImage: "选择图片",
  saveImageToPhotosAlbum: "保存分享图到相册",
};

Component({
  data: {
    visible: false,
    contractName: "ROOT 用户隐私保护指引",
    purpose: "相关功能",
  },

  lifetimes: {
    attached() {
      this.pendingResolves = [];
      this.privacyPresenter = ({ resolve, eventInfo = {} }) => {
        this.pendingResolves.push(resolve);
        resolve({ event: "exposureAuthorization" });
        this.setData({
          visible: true,
          purpose: PURPOSE_LABELS[eventInfo.referrer] || "相关功能",
        });
      };
      initializePrivacyAuthorization();
      this.activatePrivacyPresenter();
      getPrivacySetting().then((result) => {
        if (result.privacyContractName) this.setData({ contractName: result.privacyContractName });
      });
    },
    detached() {
      this.deactivatePrivacyPresenter();
      this.resolvePendingPrivacy({ event: "disagree" });
    },
  },

  pageLifetimes: {
    show() {
      this.activatePrivacyPresenter();
    },
    hide() {
      this.deactivatePrivacyPresenter();
    },
  },

  methods: {
    activatePrivacyPresenter() {
      if (this.clearPrivacyPresenter) this.clearPrivacyPresenter();
      this.clearPrivacyPresenter = setPrivacyPresenter(this.privacyPresenter);
    },

    deactivatePrivacyPresenter() {
      if (this.clearPrivacyPresenter) this.clearPrivacyPresenter();
      this.clearPrivacyPresenter = null;
    },

    resolvePendingPrivacy(result) {
      const pending = this.pendingResolves || [];
      this.pendingResolves = [];
      pending.forEach((resolve) => resolve(result));
    },

    handleAgreePrivacyAuthorization() {
      this.setData({ visible: false });
      this.resolvePendingPrivacy({ buttonId: "root-privacy-agree", event: "agree" });
    },

    rejectPrivacyAuthorization() {
      this.setData({ visible: false });
      this.resolvePendingPrivacy({ event: "disagree" });
    },

    async openPrivacyContract() {
      const opened = await openPrivacyContract();
      if (!opened) wx.navigateTo({ url: "/pages/legal/index?type=privacy" });
    },

    preventTouchMove() {},
  },
});
