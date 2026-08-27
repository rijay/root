const assert = require("node:assert/strict");

let registered = null;
let shown = 0;
let shareMenuOptions = null;
let copied = "";
let scrolledTo = null;

global.Page = (definition) => {
  registered = definition;
  return definition;
};
global.wx = {
  showShareMenu(options) {
    shown += 1;
    shareMenuOptions = options;
  },
  setClipboardData(options) { copied = options.data; },
  getMenuButtonBoundingClientRect() { return { bottom: 104 }; },
  createSelectorQuery() {
    return {
      select() { return this; },
      boundingClientRect() { return this; },
      selectViewport() { return this; },
      scrollOffset() { return this; },
      exec(callback) { callback([{ top: 140 }, { scrollTop: 200 }]); },
    };
  },
  pageScrollTo(options) { scrolledTo = options; },
};

require("../subpkg/content/pages/phgg-reference/index");

assert.ok(registered);
assert.equal(registered.data.references.length, 15);
assert.equal(registered.data.sourceHtmlSha256, "33ad4be54acef24a7ac0d345ea7a1e54ae8ab3f8ab9ac34d8b4114c9f58d7081");
assert.equal(registered.data.tocTop, 112);
assert.deepEqual(registered.data.references[14], {
  id: "abe-2023",
  title: "Abe et al. Partially hydrolyzed guar gum is associated with improvement in gut health, sleep, and motivation among healthy subjects.",
  citation: "Beneficial Microbes / PMC. 2023.",
  identifier: "PMCID: PMC10017317",
});
assert.deepEqual(registered.data.references[6], {
  id: "monash-fodmap",
  title: "Monash University Low FODMAP Certification — Fibalance® (PHGG).",
  citation: "",
  identifier: "Monash FODMAP 官方认证数据库",
  copyValue: "https://www.monashfodmap.com",
});

registered.onShow();
assert.equal(shown, 1);
assert.deepEqual(shareMenuOptions.menus, ["shareAppMessage", "shareTimeline"]);

registered.copyReference({ currentTarget: { dataset: { value: "DOI: 10.3390/nu11092170" } } });
assert.equal(copied, "DOI: 10.3390/nu11092170");

registered.scrollToSection({ currentTarget: { dataset: { section: "s7" } } });
assert.deepEqual(scrolledTo, { scrollTop: 168, duration: 240 });

assert.deepEqual(registered.onShareAppMessage(), {
  title: "PHGG 原料科学档案｜ROOT",
  path: "/subpkg/content/pages/phgg-reference/index",
});
assert.deepEqual(registered.onShareTimeline(), {
  title: "PHGG 原料科学档案｜ROOT",
  query: "",
});

delete global.Page;
delete global.wx;
console.log("PHGG reference page tests passed");
