const { FORMAL_TABS } = require("../config/formal-launch-routes");
const { remember: rememberAuthIntent } = require("../utils/auth-intent");
const { getToken } = require("../utils/request");

// 健康 Tab 对访客开放介绍内容；只有用户主动开始评测时才进入登录流程。
const PROTECTED_TAB_INDEXES = new Set([4]);

Component({
  data: {
    selected: 0,
    hidden: false,
    tabs: FORMAL_TABS,
  },

  methods: {
    setSelected(selected) {
      if (!Number.isInteger(selected) || selected < 0 || selected >= this.data.tabs.length) return;
      this.setData({ selected });
    },

    setHidden(hidden) {
      this.setData({ hidden: Boolean(hidden) });
    },

    switchTab(event) {
      const index = Number(event.currentTarget.dataset.index);
      const tab = this.data.tabs[index];
      if (!tab || index === this.data.selected) return;
      const route = `/${tab.pagePath}`;
      if (PROTECTED_TAB_INDEXES.has(index) && !getToken()) {
        rememberAuthIntent(route);
        wx.navigateTo({ url: `/pages/login/index?intent=${encodeURIComponent(route)}` });
        return;
      }
      this.setData({ selected: index });
      wx.switchTab({ url: route });
    },
  },
});
