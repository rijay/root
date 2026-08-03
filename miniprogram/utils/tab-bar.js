function syncTabBar(page, selected, options = {}) {
  if (!page || typeof page.getTabBar !== "function") return false;
  const tabBar = page.getTabBar();
  if (!tabBar || typeof tabBar.setSelected !== "function") return false;
  tabBar.setSelected(selected);
  if (typeof tabBar.setHidden === "function") tabBar.setHidden(Boolean(options.hidden));
  return true;
}

module.exports = { syncTabBar };
