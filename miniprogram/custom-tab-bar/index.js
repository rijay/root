const { FORMAL_TABS } = require("../config/formal-launch-routes");

Component({
  data: {
    selected: 0,
    tabs: FORMAL_TABS,
  },

  methods: {
    setSelected(selected) {
      if (!Number.isInteger(selected) || selected < 0 || selected >= this.data.tabs.length) return;
      this.setData({ selected });
    },

    switchTab(event) {
      const index = Number(event.currentTarget.dataset.index);
      const tab = this.data.tabs[index];
      if (!tab || index === this.data.selected) return;
      this.setData({ selected: index });
      wx.switchTab({ url: `/${tab.pagePath}` });
    },
  },
});
