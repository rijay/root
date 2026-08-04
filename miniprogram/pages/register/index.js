const { request, stringifyError } = require("../../utils/request");
const { consume: consumeAuthIntent } = require("../../utils/auth-intent");
const { isPersistedAvatar, uploadCloudAvatar } = require("../../utils/avatar-upload");
const router = require("../../utils/router");

const REGISTRATION_CONTEXT_STORAGE_KEY = "ROOT_REGISTRATION_CONTEXT_V1";
const PROFILE_SUBMIT_KEY_STORAGE = "ROOT_PROFILE_SUBMIT_KEY_V1";

function today() {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

function submitKey() {
  const existing = wx.getStorageSync(PROFILE_SUBMIT_KEY_STORAGE);
  if (existing) return existing;
  const value = `profile:${Date.now()}:${Math.random().toString(16).slice(2)}`;
  wx.setStorageSync(PROFILE_SUBMIT_KEY_STORAGE, value);
  return value;
}

Page({
  data: {
    title: "欢迎注册",
    subtitle: "补全必要资料，开始你的 Root 会员旅程",
    nickname: "Root用户",
    avatarUrl: "",
    phone: "",
    birthDate: "",
    gender: "",
    userId: "",
    maxBirthDate: today(),
    loading: false,
    avatarUploading: false,
    newUser: true,
    editing: false,
  },

  onLoad(options = {}) {
    const context = wx.getStorageSync(REGISTRATION_CONTEXT_STORAGE_KEY) || {};
    const editing = options.mode === "edit";
    const newUser = context.outcome !== "PROFILE_REQUIRED";
    this.setData({
      editing,
      newUser: editing ? false : newUser,
      title: editing ? "编辑资料" : (newUser ? "欢迎注册" : "完善资料"),
      subtitle: editing ? "更新头像、昵称与必要会员资料" : (newUser ? "补全必要资料，开始你的 Root 会员旅程" : "补全缺失资料，继续使用 myRoot"),
      phone: context.phone || "",
      userId: context.userId || "",
    });
    this.refresh();
  },

  async refresh() {
    try {
      const data = await request({ url: "/api/v1/user/formal-profile", method: "GET", scope: "formal-profile" });
      const profile = data.profile || {};
      this.setData({
        nickname: profile.nickname || "Root用户",
        avatarUrl: profile.avatarUrl || "",
        phone: profile.phone || this.data.phone,
        birthDate: profile.birthDate || "",
        gender: profile.gender || "",
      });
    } catch (error) {
      // 登录返回的脱敏手机号足以先呈现表单；读失败不清空用户已输入内容。
    }
  },

  async chooseAvatar(event) {
    const avatarUrl = event && event.detail && event.detail.avatarUrl || "";
    if (!avatarUrl) return;
    this.setData({ avatarUrl, avatarUploading: true });
    const persistedAvatar = await uploadCloudAvatar(avatarUrl, this.data.userId || "formal-profile");
    this.setData({
      avatarUrl: persistedAvatar,
      avatarUploading: false,
    });
    if (!persistedAvatar) {
      wx.showToast({ title: "头像上传失败，已使用默认头像", icon: "none" });
    }
  },

  changeNickname(event) {
    this.setData({ nickname: String(event.detail.value || "").slice(0, 24) });
  },

  changeBirthDate(event) {
    this.setData({ birthDate: event.detail.value || "" });
  },

  selectGender(event) {
    this.setData({ gender: event.currentTarget.dataset.gender || "" });
  },

  async submitProfile() {
    if (this.data.loading) return;
    if (this.data.avatarUploading) {
      wx.showToast({ title: "头像处理中，请稍候", icon: "none" });
      return;
    }
    if (!this.data.phone || !this.data.birthDate || !this.data.gender) {
      wx.showToast({ title: "必填项未填写", icon: "none" });
      return;
    }
    this.setData({ loading: true });
    try {
      await request({
        url: "/api/v1/user/formal-profile",
        method: "POST",
        idempotencyKey: submitKey(),
        data: {
          nickname: this.data.nickname || "Root用户",
          avatarUrl: isPersistedAvatar(this.data.avatarUrl) ? this.data.avatarUrl : "",
          birthDate: this.data.birthDate,
          gender: this.data.gender,
        },
      });
      wx.removeStorageSync(PROFILE_SUBMIT_KEY_STORAGE);
      wx.removeStorageSync(REGISTRATION_CONTEXT_STORAGE_KEY);
      wx.showToast({ title: this.data.editing ? "资料已更新" : (this.data.newUser ? "成功注册" : "资料已完善"), icon: "success" });
      router.go(this.data.editing ? "/pages/profile/index" : (consumeAuthIntent() || "/pages/home/index"));
    } catch (error) {
      const resultUnknown = error && error.resultUnknown;
      wx.showToast({
        title: (resultUnknown ? "资料提交结果确认中，请稍候" : stringifyError(error) || "提交失败，请重试").slice(0, 28),
        icon: "none",
      });
    } finally {
      this.setData({ loading: false });
    }
  },
});
