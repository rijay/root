const SLIDES = Object.freeze([1, 2, 3, 4, 5].map((number) => Object.freeze({
  id: `brand-foundation-${number}`,
  imageUrl: `/subpkg/content/assets/brand-foundation/${number}.jpg`,
})));

Page({
  data: {
    current: 0,
    slides: SLIDES,
  },

  changeSlide(event) {
    this.setData({ current: Number(event.detail.current || 0) });
  },

  onShareAppMessage() {
    return {
      title: "ROOT 的旅程，从一粒种子开始",
      imageUrl: SLIDES[0].imageUrl,
    };
  },
});
