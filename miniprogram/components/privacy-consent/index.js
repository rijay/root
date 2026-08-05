const {
  getPrivacySetting,
  initializePrivacyAuthorization,
  openPrivacyContract,
  setPrivacyPresenter,
} = require("../../utils/privacy-authorization");

const PURPOSE_LABELS = {
  "button.getPhoneNumber": "手机号快捷验证",
  "button.chooseAvatar": "选择头像",
};

const PHONE_PRIVACY_COPY = "为完成会员身份验证，myRoot 将在你同意后\n申请获取并验证手机号。头像与昵称可稍后选择，\n拒绝不会影响公开内容浏览。";

function privacyCopyFor(eventInfo = {}) {
  if (eventInfo.referrer === "button.getPhoneNumber") return PHONE_PRIVACY_COPY;
  const purpose = PURPOSE_LABELS[eventInfo.referrer] || "相关功能";
  return `为完成${purpose}，myRoot 将在你同意后申请使用必要信息。头像与昵称可稍后选择，拒绝不会影响公开内容浏览。`;
}

Component({
  data: {
    visible: false,
    contractName: "ROOT 用户隐私保护指引",
    privacyCopy: privacyCopyFor(),
    showContractLink: true,
  },

  lifetimes: {
    attached() {
      this.pendingResolves = [];
      this.privacyPresenter = ({ resolve, eventInfo = {} }) => {
        this.pendingResolves.push(resolve);
        resolve({ event: "exposureAuthorization" });
        this.setData({
          visible: true,
          privacyCopy: privacyCopyFor(eventInfo),
          showContractLink: eventInfo.referrer !== "button.getPhoneNumber",
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
