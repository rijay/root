const {
  claimCampaignPopup,
  recordCampaignPopupAction,
} = require("../../utils/campaign-popup");
const { setPendingProductFocus } = require("../../utils/product-navigation");
const router = require("../../utils/router");

Component({
  data: {
    visible: false,
    popup: null,
    actionLoading: false,
  },

  lifetimes: {
    attached() {
      this.claimTimer = null;
      this.claiming = false;
      this.viewRecorded = false;
    },
    detached() {
      this.cancelClaim();
    },
  },

  pageLifetimes: {
    show() {
      this.scheduleClaim();
    },
    hide() {
      this.cancelClaim();
    },
  },

  methods: {
    scheduleClaim() {
      this.cancelClaim();
      if (this.data.visible || this.claiming) return;
      this.claimTimer = setTimeout(() => this.loadPopup(), 1500);
    },

    cancelClaim() {
      if (this.claimTimer) clearTimeout(this.claimTimer);
      this.claimTimer = null;
    },

    async loadPopup() {
      if (this.claiming || this.data.visible) return;
      this.claiming = true;
      try {
        const result = await claimCampaignPopup();
        if (!result || !result.popup) return;
        this.viewRecorded = false;
        this.setData({ visible: true, popup: result.popup });
        this.recordView();
      } catch (error) {
        // Popup failures never block the target page.
      } finally {
        this.claiming = false;
      }
    },

    recordView() {
      const popup = this.data.popup;
      if (!popup || this.viewRecorded) return;
      this.viewRecorded = true;
      recordCampaignPopupAction(popup.popupId, "VIEW").catch(() => null);
    },

    dismiss() {
      const popup = this.data.popup;
      this.setData({ visible: false, popup: null });
      if (popup) recordCampaignPopupAction(popup.popupId, "DISMISS").catch(() => null);
    },

    async primaryAction() {
      const popup = this.data.popup;
      if (!popup || this.data.actionLoading) return;
      this.setData({ actionLoading: true });
      try {
        await recordCampaignPopupAction(popup.popupId, "PRIMARY").catch(() => null);
        this.setData({ visible: false, popup: null });
        const action = popup.action || {};
        if (action.type === "OPEN_PRODUCT" && action.target) {
          setPendingProductFocus(action.target, "campaign_popup");
          router.open(`/pages/product-detail/index?productId=${action.target}`);
          return;
        }
        if (action.type === "OPEN_PAGE" && action.target) router.open(action.target);
      } finally {
        this.setData({ actionLoading: false });
      }
    },

    preventTouchMove() {},
  },
});
