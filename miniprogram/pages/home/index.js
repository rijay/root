const { syncTabBar } = require("../../utils/tab-bar");

Page({
  onShow() { syncTabBar(this, 0); },
});
