const { getToken, request } = require("../../../../utils/request");
const { presentActivityDetail, safeOpaqueId } = require("../../../../utils/activity-presenter");
const {
  ROUTE_INTENT_STORAGE_KEY,
  commandReachedAuthorityState,
  createActivityLoginRouteIntent,
  createMemberSupportRouteIntent,
  deriveActivityAction,
  presentActivityWriteError,
} = require("../../../../utils/activity-actions");
const router = require("../../../../utils/router");
const { createActivityPendingCommandRegistry } = require("../../../../utils/activity-command-recovery");
const { defaultOnShareAppMessage } = require("../../../../utils/page-share");
const { failureReason, track } = require("../../../../utils/analytics");

const pendingCommands = createActivityPendingCommandRegistry({
  storage: {
    getItem(key) { return wx.getStorageSync(key) || null; },
    setItem(key, value) { wx.setStorageSync(key, value); },
  },
});

function commandPayload(sessionId) {
  return { sessionId };
}

function unknownResult(command) {
  return {
    ...presentActivityWriteError({ code: "WRITE_RESULT_NOT_CONFIRMED" }),
    retryAvailable: true,
    voidAvailable: true,
    auditRef: command.idempotencyKey,
  };
}

Page({
  data: {
    viewState: "loading",
    sessionId: "",
    activityId: "",
    activity: null,
    action: null,
    errorText: "",
    confirmSheetVisible: false,
    submitting: false,
    result: null,
    voidSheetVisible: false,
  },

  onLoad(options = {}) {
    const sessionId = safeOpaqueId(options.sessionId);
    const activityId = safeOpaqueId(options.activityId);
    this._resumeConfirmation = options.source === "login_recovery";
    this.setData({ sessionId, activityId });
    track("activity_detail_view", {
      activityId: activityId || sessionId,
      sourcePage: options.source || "activity_list",
    });
    if (!sessionId && !activityId) {
      this.setData({ viewState: "invalid", errorText: "活动信息无效，请返回活动列表重新选择。" });
      return;
    }
    this.loadDetail();
  },

  async fetchAuthoritativeDetail() {
    const payload = await request({
      url: this.data.sessionId
        ? `/api/v1/activities/detail?sessionId=${encodeURIComponent(this.data.sessionId)}`
        : `/api/v1/activities/detail?activityId=${encodeURIComponent(this.data.activityId)}`,
    });
    const activity = presentActivityDetail(payload);
    if (!activity) throw new Error("ACTIVITY_DETAIL_INVALID");
    return activity;
  },

  authorityData(activity) {
    const activityView = { ...activity, heroReady: Boolean(activity.heroAssetUrl) };
    const derivedAction = deriveActivityAction(activityView, { authenticated: Boolean(getToken()) });
    const action = derivedAction;
    const availabilityText = activityView.enrollment
      ? `我的报名：${activityView.enrollment.label}`
      : (activityView.remainingCapacity !== null && activityView.listingState === "AVAILABLE"
        ? `剩余 ${activityView.remainingCapacity} 个名额`
        : activityView.statusLabel);
    return {
      viewState: "ready",
      activity: activityView,
      sessionId: activity.sessionId,
      action,
      availabilityText,
      errorText: "",
    };
  },

  async loadDetail() {
    if (!this.data.sessionId && !this.data.activityId) return;
    this.setData({ viewState: "loading", activity: null, action: null, errorText: "", result: null });
    try {
      const activity = await this.fetchAuthoritativeDetail();
      const authority = this.authorityData(activity);
      const unresolved = pendingCommands.listForSession(activity.sessionId);
      unresolved.forEach((command) => {
        if (commandReachedAuthorityState(command, activity)) pendingCommands.clear(command);
      });
      this._unresolvedCommand = pendingCommands.listForSession(activity.sessionId)[0] || null;
      const resumeConfirmation = this._resumeConfirmation && authority.action.kind === "ENROLL";
      this._resumeConfirmation = false;
      this.setData({
        ...authority,
        confirmSheetVisible: resumeConfirmation && !this._unresolvedCommand,
        result: this._unresolvedCommand ? unknownResult(this._unresolvedCommand) : null,
      });
    } catch (_) {
      this.setData({
        viewState: "error",
        errorText: "活动详情暂未完成读取。请稍后重试，或返回活动列表查看其他活动。",
      });
    }
  },

  handlePrimaryAction() {
    const action = deriveActivityAction(this.data.activity, { authenticated: Boolean(getToken()) });
    this.setData({ action });
    if (action.kind === "LOGIN") {
      try {
        wx.setStorageSync(
          ROUTE_INTENT_STORAGE_KEY,
          createActivityLoginRouteIntent(this.data.activity, Date.now()),
        );
      } catch (_) {
        // Login remains available; recovery simply falls back to the normal home route.
      }
      router.go("/pages/login/index?source=activity_detail");
      return;
    }
    if (["ENROLL", "CANCEL"].includes(action.kind)) {
      const unresolved = pendingCommands.peek(action.kind, this.data.sessionId, commandPayload(this.data.sessionId));
      if (unresolved) {
        this._unresolvedCommand = unresolved;
        this.setData({ result: unknownResult(unresolved), confirmSheetVisible: false });
        return;
      }
      this.setData({ confirmSheetVisible: true, result: null });
    }
  },

  closeConfirmation() {
    if (this.data.submitting) return;
    this.setData({ confirmSheetVisible: false });
  },

  stopSheetTap() {},

  async confirmActivityAction() {
    if (this.data.submitting || this._pendingCommand || !this.data.action) return;
    let command;
    try {
      command = pendingCommands.claim(
        this.data.action.kind,
        this.data.sessionId,
        commandPayload(this.data.sessionId),
      );
    } catch (_) {
      this.setData({
        confirmSheetVisible: false,
        result: {
          kind: "UNKNOWN",
          title: "暂不能安全提交",
          body: "未能保存操作恢复记录。为避免重复报名或取消，本次请求没有发出，请稍后重试。",
          support: true,
        },
      });
      return;
    }
    await this.submitCommand(command);
  },

  async submitCommand(command) {
    this._pendingCommand = command;
    this._unresolvedCommand = command;
    this.setData({ submitting: true });
    let writeError = null;
    try {
      await request({
        url: command.kind === "ENROLL" ? "/api/v1/activities/enroll" : "/api/v1/activities/cancel",
        method: "POST",
        idempotencyKey: command.idempotencyKey,
        data: { sessionId: command.sessionId },
      });
    } catch (error) {
      writeError = error;
      if (String(error && error.code || "").toUpperCase() === "ACTIVE_MEMBERSHIP_REQUIRED") {
        try {
          wx.setStorageSync(
            ROUTE_INTENT_STORAGE_KEY,
            createMemberSupportRouteIntent(this.data.activity, Date.now()),
          );
        } catch (_) {
          // The support path remains available even when local storage is unavailable.
        }
      }
    }
    await this.reconcileCommand(command, writeError);
    this._pendingCommand = null;
  },

  async reconcileCommand(command, writeError) {
    let activity = null;
    try {
      activity = await this.fetchAuthoritativeDetail();
    } catch (_) {
      // Unknown outcomes are never converted into a local enrollment state.
    }

    let result;
    if (activity && commandReachedAuthorityState(command, activity)) {
      try {
        pendingCommands.clear(command);
        this._unresolvedCommand = null;
      } catch (_) {
        result = {
          kind: "UNKNOWN",
          title: "状态已确认，但恢复记录未清除",
          body: "权威记录已返回最新状态，但本机存储异常。请勿重试，并联系 ROOT 顾问提供审计检索标识。",
          support: true,
          auditRef: command.idempotencyKey,
        };
      }
      const pending = command.kind === "ENROLL" && activity.enrollment && activity.enrollment.status === "PENDING";
      result = result || {
        kind: "SUCCESS",
        title: command.kind === "CANCEL" ? "报名已取消" : (pending ? "报名申请已提交" : "报名已确认"),
        body: "报名状态已更新，请以当前页面展示为准。",
        support: false,
      };
      track("activity_signup", {
        activityId: activity.activityId || command.sessionId,
        action: command.kind,
        result: pending ? "PENDING" : "SUCCESS",
        failureReason: "",
      });
    } else if (writeError) {
      result = presentActivityWriteError(writeError);
      track("activity_signup", {
        activityId: this.data.activityId || command.sessionId,
        action: command.kind,
        result: result.kind === "UNKNOWN" ? "UNKNOWN" : "FAILED",
        failureReason: failureReason(writeError),
      });
      if (result.kind !== "UNKNOWN") {
        try {
          pendingCommands.clear(command);
          this._unresolvedCommand = null;
        } catch (_) {
          result = {
            kind: "UNKNOWN",
            title: "结果已返回，但恢复记录未清除",
            body: "本机存储异常。请勿重试，并联系 ROOT 顾问提供审计检索标识。",
            support: true,
            auditRef: command.idempotencyKey,
          };
        }
      } else {
        result = unknownResult(command);
      }
    } else {
      result = unknownResult(command);
      track("activity_signup", {
        activityId: this.data.activityId || command.sessionId,
        action: command.kind,
        result: "UNKNOWN",
        failureReason: "WRITE_RESULT_NOT_CONFIRMED",
      });
    }

    this.setData({
      ...(activity ? this.authorityData(activity) : {}),
      confirmSheetVisible: false,
      submitting: false,
      result,
    });
  },

  closeResult() {
    this.setData({ result: null });
  },

  retryPendingAction() {
    if (this.data.submitting || this._pendingCommand || !this._unresolvedCommand) return;
    this.submitCommand(this._unresolvedCommand);
  },

  voidPendingAction() {
    if (this.data.submitting || this._pendingCommand || !this._unresolvedCommand) return;
    this.setData({ voidSheetVisible: true });
  },

  closeVoidSheet() {
    if (this.data.submitting) return;
    this.setData({ voidSheetVisible: false });
  },

  confirmVoidPendingAction() {
    if (this.data.submitting || !this._unresolvedCommand) return;
    try { pendingCommands.clear(this._unresolvedCommand); } catch (_) {
      this.setData({ voidSheetVisible: false, result: { kind: "UNKNOWN", title: "作废未完成", body: "本机存储异常，原恢复记录仍保留。请勿创建新意图，并联系 ROOT 顾问。", support: true } });
      return;
    }
    this._unresolvedCommand = null;
    this.setData({
      voidSheetVisible: false,
      result: {
        kind: "DEFINITIVE",
        title: "本机恢复记录已作废",
        body: "后台状态未被改写。再次操作前，请先重新加载并确认当前报名状态。",
        support: false,
      },
    });
  },

  handleHeroError() {
    this.setData({ "activity.heroReady": false });
  },

  backToList() {
    router.go("/pages/activities/index");
  },

  openSupport() {
    router.open("/subpkg/profile/pages/support/index?topic=activity&source=activity_detail");
  },

  onShareAppMessage: defaultOnShareAppMessage,
});
