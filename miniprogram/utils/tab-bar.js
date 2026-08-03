function syncTabBar(page, selected) {
  if (!page || typeof page.getTabBar !== "function") return false;
  const tabBar = page.getTabBar();
  if (!tabBar || typeof tabBar.setSelected !== "function") return false;
  tabBar.setSelected(selected);
  return true;
}

module.exports = { syncTabBar };
