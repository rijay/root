const { openEntryTarget, pathOnly } = require("../../utils/entry-launch");

const DISPLAY_MS = 1200;
const HARD_LIMIT_MS = 2000;

Page({
  onLoad(options = {}) {
    this.entryId = String(options.entryId || "");
    this.finished = false;
    if (wx.hideShareMenu) wx.hideShareMenu();
    this.displayTimer = setTimeout(() => this.finish(), DISPLAY_MS);
    this.hardTimer = setTimeout(() => this.finish(), HARD_LIMIT_MS);
  },

  onUnload() {
    clearTimeout(this.displayTimer);
    clearTimeout(this.hardTimer);
  },

  finish() {
    if (this.finished) return;
    this.finished = true;
    clearTimeout(this.displayTimer);
    clearTimeout(this.hardTimer);
    const app = getApp();
    const entry = app && typeof app.consumeEntryLaunch === "function"
      ? app.consumeEntryLaunch(this.entryId)
      : null;
    if (entry && entry.overlay && !entry.forceTarget) {
      wx.navigateBack({ delta: 1, fail: () => openEntryTarget(entry.targetPage) });
      return;
    }
    const target = entry && entry.targetPage;
    if (pathOnly(target) === "/pages/launching/index") {
      openEntryTarget("/pages/home/index");
      return;
    }
    openEntryTarget(target || "/pages/home/index");
  },
});
