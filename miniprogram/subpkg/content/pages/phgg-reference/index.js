const { showTimelineShareMenu } = require("../../../../utils/page-share");

const REFERENCES = Object.freeze([
  Object.freeze({
    id: "slavin-2003",
    title: "Slavin JL, Greenberg NA. Partially hydrolyzed guar gum: clinical nutrition uses.",
    citation: "Nutrition. 2003 Jun;19(6):549–52.",
    identifier: "PMID: 12781858｜DOI: 10.1016/S0899-9007(02)01032-8",
  }),
  Object.freeze({
    id: "kapoor-2017",
    title: "Kapoor MP, Sugita M, Fukuzawa Y, Okubo T. Impact of partially hydrolyzed guar gum (PHGG) on constipation prevention: A systematic review and meta-analysis.",
    citation: "Journal of Functional Foods. 2017;33:52–66.",
    identifier: "DOI: 10.1016/j.jff.2017.03.028",
  }),
  Object.freeze({
    id: "niv-2016",
    title: "Niv E, Halak A, Tiommny E, et al. Randomized clinical study: Partially hydrolyzed guar gum (PHGG) versus placebo in the treatment of patients with irritable bowel syndrome.",
    citation: "Nutrition & Metabolism. 2016;13:10.",
    identifier: "PMCID: PMC4744437｜PMID: 26855665",
  }),
  Object.freeze({
    id: "parisi-2002",
    title: "Parisi GC, Zilli M, Miani MP, et al. High-fiber diet supplementation in patients with irritable bowel syndrome (IBS): a multicenter, randomized, open trial comparison between wheat bran diet and partially hydrolyzed guar gum (PHGG).",
    citation: "Digestive Diseases and Sciences. 2002;47(8):1697–1704.",
    identifier: "DOI: 10.1023/A:1016419906546",
  }),
  Object.freeze({
    id: "parisi-2005",
    title: "Parisi GC, Bottona E, Carrara M, et al. Treatment effects of partially hydrolyzed guar gum on symptoms and quality of life of patients with irritable bowel syndrome. A multicenter randomized open trial.",
    citation: "Digestive Diseases and Sciences. 2005.",
    identifier: "",
  }),
  Object.freeze({
    id: "yasukawa-2019",
    title: "Yasukawa Z, Inoue R, Ozeki M, et al. Effect of repeated consumption of partially hydrolyzed guar gum on fecal characteristics and gut microbiota: a randomized, double-blind, placebo-controlled, and parallel-group clinical trial.",
    citation: "Nutrients. 2019;11(9):2170.",
    identifier: "DOI: 10.3390/nu11092170",
  }),
  Object.freeze({
    id: "monash-fodmap",
    title: "Monash University Low FODMAP Certification — Fibalance® (PHGG).",
    citation: "",
    identifier: "Monash FODMAP 官方认证数据库",
    copyValue: "https://www.monashfodmap.com",
  }),
  Object.freeze({
    id: "velazquez-2000",
    title: "Velázquez M, Davies C, Marett R, et al. Effect of oligosaccharides and fibre substitutes on short-chain fatty acid production by human faecal microflora.",
    citation: "Anaerobe. 2000;6(2):87–92.",
    identifier: "",
  }),
  Object.freeze({
    id: "ohashi-2015",
    title: "Ohashi Y, Hiraguchi M, Tanabe C, et al. Consumption of partially hydrolysed guar gum stimulates Bifidobacteria and butyrate-producing bacteria in the human large intestine.",
    citation: "Beneficial Microbes. 2015.",
    identifier: "",
  }),
  Object.freeze({
    id: "rao-2015",
    title: "Rao TP, Hayakawa M, Minami L, et al. Post-meal perceivable satiety and subsequent energy intake with intake of partially hydrolysed guar gum.",
    citation: "British Journal of Nutrition. 2015 May;113(9):1489–98.",
    identifier: "DOI: 10.1017/S0007114515000589",
  }),
  Object.freeze({
    id: "han-2025",
    title: "Han T, Zhuo J, Wu X, et al. Tolerability and efficacy of an enteral formula containing partially hydrolyzed guar gum in patients following gastrointestinal surgery: a prospective, multicenter, open-label, randomized controlled study.",
    citation: "Clinical Nutrition. 2025.",
    identifier: "PMID: 41483486｜DOI: 10.1016/j.clnu.2025.12.002",
  }),
  Object.freeze({
    id: "giannini-2006",
    title: "Giannini EG, Mansi C, Dulbecco P, Savarino V. Role of partially hydrolyzed guar gum in the treatment of irritable bowel syndrome.",
    citation: "Nutrition. 2006;22(3):334–342.",
    identifier: "DOI: 10.1016/j.nut.2005.10.003",
  }),
  Object.freeze({
    id: "russo-2015",
    title: "Russo L, Andreozzi P, Zito FP, et al. Partially hydrolyzed guar gum in the treatment of irritable bowel syndrome with constipation: effects of gender, age, and body mass index.",
    citation: "Saudi Journal of Gastroenterology. 2015;21(2):104–110.",
    identifier: "DOI: 10.4103/1319-3767.153835",
  }),
  Object.freeze({
    id: "chan-2022",
    title: "Chan TCW, Yu VMW, Luk JKH, et al. Effectiveness of partially hydrolyzed guar gum in reducing constipation in long term care facility residents: a randomized single-blinded placebo-controlled trial.",
    citation: "Journal of Nutrition, Health & Aging. 2022;26(3):247–251.",
    identifier: "DOI: 10.1007/s12603-022-1747-2",
  }),
  Object.freeze({
    id: "abe-2023",
    title: "Abe et al. Partially hydrolyzed guar gum is associated with improvement in gut health, sleep, and motivation among healthy subjects.",
    citation: "Beneficial Microbes / PMC. 2023.",
    identifier: "PMCID: PMC10017317",
  }),
]);

function navigationBottom() {
  try {
    if (typeof wx.getMenuButtonBoundingClientRect === "function") {
      const capsule = wx.getMenuButtonBoundingClientRect();
      const capsuleBottom = Number(capsule && capsule.bottom);
      if (Number.isFinite(capsuleBottom) && capsuleBottom > 0) return Math.ceil(capsuleBottom);
    }
  } catch (_) {
    // 模拟器或低版本环境使用安全回退值。
  }
  return 88;
}

function tocStickyTop() {
  return navigationBottom() + 8;
}

function sectionScrollOffset() {
  return tocStickyTop() + 60;
}

Page({
  data: {
    references: REFERENCES,
    sourceHtmlSha256: "33ad4be54acef24a7ac0d345ea7a1e54ae8ab3f8ab9ac34d8b4114c9f58d7081",
    tocTop: tocStickyTop(),
  },

  onShow() {
    showTimelineShareMenu();
  },

  scrollToSection(event) {
    const section = String(event.currentTarget.dataset.section || "");
    if (!/^s[1-7]$/.test(section) || typeof wx.createSelectorQuery !== "function") return;
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

  onShareTimeline() {
    return {
      title: "PHGG 原料科学档案｜ROOT",
      query: "",
    };
  },
});
