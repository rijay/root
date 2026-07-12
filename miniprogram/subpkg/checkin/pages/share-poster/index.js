const { request } = require("../../../../utils/request");
const router = require("../../../../utils/router");
const {
  TRANSIENT_HEALTH_KEYS,
  consumeTransientHealthData,
} = require("../../../../utils/transient-health-state");

const canvasId = "rootSharePoster";

function fallbackPayload() {
  return {
    brand: "ROOT",
    dateText: "",
    title: "今天，身体记录已完成",
    subtitle: "一次真实记录，也是在照看身体的节律。",
    summaryRows: [],
    feedback: "今天也完成了一次真实记录。",
    streakText: "",
    footer: "身体自有其序，记录会让它被看见。",
  };
}

function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const chars = String(text || "").split("");
  let line = "";
  let lineCount = 0;
  chars.forEach((char, index) => {
    if (lineCount >= maxLines) return;
    const next = line + char;
    if (ctx.measureText(next).width > maxWidth && line) {
      ctx.fillText(line, x, y + lineCount * lineHeight);
      line = char;
      lineCount += 1;
      return;
    }
    line = next;
    if (index === chars.length - 1 && lineCount < maxLines) {
      ctx.fillText(line, x, y + lineCount * lineHeight);
    }
  });
}

Page({
  data: {
    payload: fallbackPayload(),
    posterPath: "",
    generating: false,
    saving: false,
    canvasWidth: 360,
    canvasHeight: 480,
  },

  async onLoad() {
    const allowed = await router.routeGuard("/subpkg/checkin/pages/share-poster/index");
    if (!allowed) return;
    const payload = consumeTransientHealthData(TRANSIENT_HEALTH_KEYS.SHARE_POSTER, fallbackPayload());
    this.setData({ payload }, () => this.generatePoster());
  },

  generatePoster() {
    const payload = this.data.payload || fallbackPayload();
    const ctx = wx.createCanvasContext(canvasId, this);
    const width = this.data.canvasWidth;
    const height = this.data.canvasHeight;
    this.setData({ generating: true, posterPath: "" });

    ctx.setFillStyle("#F8F3E8");
    ctx.fillRect(0, 0, width, height);
    ctx.setFillStyle("#080806");
    ctx.setFontSize(22);
    ctx.fillText(payload.brand || "ROOT", 28, 46);
    ctx.setFillStyle("#8A8172");
    ctx.setFontSize(13);
    ctx.fillText(payload.dateText || "", 244, 42);

    ctx.setFillStyle("#080806");
    ctx.setFontSize(27);
    drawWrappedText(ctx, payload.title, 28, 94, 304, 34, 2);
    ctx.setFillStyle("#6F6659");
    ctx.setFontSize(14);
    drawWrappedText(ctx, payload.subtitle, 28, 146, 304, 22, 2);

    ctx.setFillStyle("#FFFFFF");
    ctx.fillRect(28, 178, 304, 106);
    ctx.setFillStyle("#080806");
    ctx.setFontSize(15);
    let rowY = 205;
    (payload.summaryRows || []).slice(0, 3).forEach((row) => {
      ctx.fillText(`${row.label}：${row.value}`, 46, rowY);
      rowY += 24;
    });

    ctx.setFillStyle("#EEF3DE");
    ctx.fillRect(28, 304, 304, 70);
    ctx.setFillStyle("#586B3F");
    ctx.setFontSize(13);
    ctx.fillText("今日感受", 46, 328);
    ctx.setFillStyle("#080806");
    ctx.setFontSize(16);
    drawWrappedText(ctx, payload.feedback, 46, 352, 268, 22, 2);

    ctx.setFillStyle("#080806");
    ctx.fillRect(28, 392, 304, 42);
    ctx.setFillStyle("#FFFFFF");
    ctx.setFontSize(16);
    ctx.fillText(payload.streakText || "今日记录已保存", 58, 419);

    ctx.setFillStyle("#586B3F");
    ctx.setFontSize(13);
    ctx.fillText(payload.footer || "身体自有其序，记录会让它被看见。", 28, 458);

    ctx.draw(false, () => {
      wx.canvasToTempFilePath({
        canvasId,
        width,
        height,
        destWidth: 1080,
        destHeight: 1440,
        success: (res) => this.setData({ posterPath: res.tempFilePath, generating: false }),
        fail: () => {
          this.setData({ generating: false });
          wx.showToast({ title: "生成失败，请重试", icon: "none" });
        },
      }, this);
    });
  },

  async track(name) {
    await request({ url: "/api/v1/event/track", method: "POST", data: { eventName: name, payload: { source: "share_poster" } } }).catch(() => null);
  },

  savePoster() {
    if (!this.data.posterPath) {
      this.generatePoster();
      return;
    }
    this.setData({ saving: true });
    wx.saveImageToPhotosAlbum({
      filePath: this.data.posterPath,
      success: async () => {
        this.setData({ saving: false });
        await this.track("share_poster_saved");
        wx.showToast({ title: "已保存到相册", icon: "success" });
      },
      fail: () => {
        this.setData({ saving: false });
        wx.showModal({
          title: "需要相册权限",
          content: "请开启相册权限后再保存今日分享图。",
          confirmText: "去设置",
          success: (res) => {
            if (res.confirm) wx.openSetting({});
          },
        });
      },
    });
  },

  async sharePoster() {
    if (!this.data.posterPath) {
      this.generatePoster();
      return;
    }
    if (wx.showShareImageMenu) {
      await this.track("share_poster_share_menu");
      wx.showShareImageMenu({ path: this.data.posterPath });
      return;
    }
    wx.showToast({ title: "当前版本请先保存到相册", icon: "none" });
  },

  goHome() {
    router.go("/pages/home/index");
  },
});
