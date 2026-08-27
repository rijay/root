const { showFriendShareMenu } = require("../../../../utils/page-share");

const REFERENCES = Object.freeze([
  Object.freeze({
    id: "slavin-2003",
    type: "综述",
    authors: "Slavin JL, Greenberg NA",
    source: "Nutrition. 2003;19(6):549–552",
    focus: "PHGG 临床营养用途综述",
    identifier: "PMID: 12781858｜DOI: 10.1016/S0899-9007(02)01032-8",
  }),
  Object.freeze({
    id: "kapoor-2017",
    type: "系统综述与荟萃分析",
    authors: "Kapoor MP, Sugita M, Fukuzawa Y, Okubo T",
    source: "Journal of Functional Foods. 2017;33:52–66",
    focus: "多项 PHGG 人体研究的汇总分析",
    identifier: "DOI: 10.1016/j.jff.2017.03.028",
  }),
  Object.freeze({
    id: "yasukawa-2019",
    type: "随机双盲对照试验",
    authors: "Yasukawa Z, Inoue R, Ozeki M, et al.",
    source: "Nutrients. 2019;11(9):2170",
    focus: "粪便特征与肠道菌群研究",
    identifier: "DOI: 10.3390/nu11092170",
  }),
  Object.freeze({
    id: "abe-2023",
    type: "人体研究",
    authors: "Abe A, Morishima S, Kapoor MP, et al.",
    source: "J Clin Biochem Nutr. 2023;72(2):189–197",
    focus: "PHGG 与健康受试者肠道菌群相关研究",
    identifier: "PMID: 36936875｜PMCID: PMC10017317｜DOI: 10.3164/jcbn.22-75",
  }),
]);

function sectionScrollOffset() {
  try {
    if (typeof wx.getMenuButtonBoundingClientRect === "function") {
      const capsule = wx.getMenuButtonBoundingClientRect();
      const capsuleBottom = Number(capsule && capsule.bottom);
      if (Number.isFinite(capsuleBottom) && capsuleBottom > 0) return Math.ceil(capsuleBottom + 16);
    }
  } catch (_) {
    // 模拟器或低版本环境使用安全回退值。
  }
  return 112;
}

Page({
  data: { references: REFERENCES },

  onShow() {
    showFriendShareMenu();
  },

  scrollToSection(event) {
    const section = String(event.currentTarget.dataset.section || "");
    if (!/^[a-z-]+$/.test(section) || typeof wx.createSelectorQuery !== "function") return;
    const query = wx.createSelectorQuery();
    query.select(`#${section}`).boundingClientRect();
    query.selectViewport().scrollOffset();
    query.exec((result = []) => {
      const target = result[0];
      const viewport = result[1];
      if (!target || !viewport || typeof wx.pageScrollTo !== "function") return;
      wx.pageScrollTo({
        scrollTop: Math.max(0, viewport.scrollTop + target.top - sectionScrollOffset()),
        duration: 240,
      });
    });
  },

  copyReference(event) {
    const value = String(event.currentTarget.dataset.value || "").trim();
    if (!value || typeof wx.setClipboardData !== "function") return;
    wx.setClipboardData({ data: value });
  },

  onShareAppMessage() {
    return {
      title: "PHGG 原料科学档案｜ROOT",
      path: "/subpkg/content/pages/phgg-reference/index",
    };
  },
});
