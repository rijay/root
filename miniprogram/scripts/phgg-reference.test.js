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
assert.equal(registered.data.references.length, 4);
assert.deepEqual(registered.data.references[3], {
  id: "abe-2023",
  type: "人体研究",
  authors: "Abe A, Morishima S, Kapoor MP, et al.",
  source: "J Clin Biochem Nutr. 2023;72(2):189–197",
  focus: "PHGG 与健康受试者肠道菌群相关研究",
  identifier: "PMID: 36936875｜PMCID: PMC10017317｜DOI: 10.3164/jcbn.22-75",
});

registered.onShow();
assert.equal(shown, 1);
assert.deepEqual(shareMenuOptions.menus, ["shareAppMessage", "shareTimeline"]);

registered.copyReference({ currentTarget: { dataset: { value: "DOI: 10.3390/nu11092170" } } });
assert.equal(copied, "DOI: 10.3390/nu11092170");

registered.scrollToSection({ currentTarget: { dataset: { section: "references" } } });
assert.deepEqual(scrolledTo, { scrollTop: 220, duration: 240 });

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
