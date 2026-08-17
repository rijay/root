const { getToken, request } = require("../../../../utils/request");
const { presentActivityDetail, presentEnrollmentList } = require("../../../../utils/activity-presenter");
const {
  ROUTE_INTENT_STORAGE_KEY,
  commandReachedAuthorityState,
  createMyEnrollmentsLoginRouteIntent,
  deriveActivityAction,
  presentActivityWriteError,
} = require("../../../../utils/activity-actions");
const { createActivityPendingCommandRegistry } = require("../../../../utils/activity-command-recovery");
const {
  PAGE_SIZE,
  buildEnrollmentsUrl,
  cancellationSheet,
  decorateEnrollment,
  groupEnrollments,
  mergeEnrollments,
  paginationFrom,
  rawSessionIndex,
} = require("./model");
const router = require("../../../../utils/router");
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

function unknownCancelResult(command) {
  return {
    ...presentActivityWriteError({ code: "WRITE_RESULT_NOT_CONFIRMED" }),
    retryAvailable: true,
    voidAvailable: true,
    auditRef: command.idempotencyKey,
  };
}

function presentEnrollments(payload, nowMs) {
  const sessions = rawSessionIndex(payload);
  return presentEnrollmentList(payload).map((item) => decorateEnrollment({
    ...item,
    canCancel: deriveActivityAction(item, { authenticated: true }).kind === "CANCEL",
  }, sessions[item.sessionId], nowMs));
}

Page({
  data: {
    viewState: "loading",
    enrollments: [],
    enrollmentGroups: [],
    errorText: "",
    cancelingId: "",
    result: null,
    page: 1,
    pageSize: PAGE_SIZE,
    total: null,
    hasMore: false,
    isLoadingMore: false,
    loadMoreError: "",
    cancelSheetVisible: false,
    pendingCancel: null,
    voidSheetVisible: false,
  },

  onShow() {
    this.loadEnrollments({ reset: true });
  },

  onUnload() {
    this._loadSequence = (this._loadSequence || 0) + 1;
  },

  async loadEnrollments(options = {}) {
    const reset = options.reset !== false;
    const preserveResult = options.preserveResult === true;
    if (!reset && (this.data.isLoadingMore || !this.data.hasMore)) return;

    const requestedPage = reset ? 1 : this.data.page + 1;
    const loadSequence = (this._loadSequence || 0) + 1;
    this._loadSequence = loadSequence;
    if (reset) {
      this.setData({
        viewState: "loading",
        enrollments: [],
        enrollmentGroups: [],
        errorText: "",
        page: 1,
        total: null,
        hasMore: false,
        isLoadingMore: false,
        loadMoreError: "",
        ...(preserveResult ? {} : { result: null }),
      });
    } else {
      this.setData({ isLoadingMore: true, loadMoreError: "" });
    }
    if (!getToken()) {
      this.setData({ viewState: "guest", isLoadingMore: false });
      return;
    }

    try {
      const payload = await request({ url: buildEnrollmentsUrl(requestedPage) });
      if (loadSequence !== this._loadSequence) return;
      const incoming = presentEnrollments(payload, Date.now());
      const enrollments = mergeEnrollments(reset ? [] : this.data.enrollments, incoming);
      if (reset) {
        pendingCommands.list().forEach((command) => {
          const enrollment = enrollments.find((item) => item.sessionId === command.sessionId);
          if (enrollment && commandReachedAuthorityState(command, {
            sessionId: enrollment.sessionId,
            enrollment: { status: enrollment.enrollmentStatus },
          })) pendingCommands.clear(command);
        });
        this._unresolvedCommand = pendingCommands.list()[0] || null;
      }
      const pagination = paginationFrom(payload, requestedPage, incoming.length);
      this.setData({
        enrollments,
        enrollmentGroups: groupEnrollments(enrollments),
        viewState: enrollments.length ? "ready" : "empty",
        page: pagination.page,
        total: pagination.total,
        hasMore: pagination.hasMore,
        isLoadingMore: false,
        loadMoreError: "",
        ...(reset && this._unresolvedCommand ? { result: unknownCancelResult(this._unresolvedCommand) } : {}),
      });
    } catch (_) {
      if (loadSequence !== this._loadSequence) return;
      if (!reset) {
        this.setData({
          isLoadingMore: false,
          loadMoreError: "更多报名记录暂未加载，请重试。",
        });
        return;
      }
      this.setData({
        viewState: getToken() ? "error" : "guest",
        errorText: "报名记录暂未完成读取。请稍后重试，或联系人工协助。",
        isLoadingMore: false,
      });
    }
  },

  loadMore() {
    return this.loadEnrollments({ reset: false });
  },

  goLogin() {
    try {
      wx.setStorageSync(
        ROUTE_INTENT_STORAGE_KEY,
        createMyEnrollmentsLoginRouteIntent(Date.now()),
      );
    } catch (_) {
      // Login remains available; recovery falls back to the server-selected route.
    }
    router.go("/pages/login/index?source=my_enrollments");
  },

  openDetail(event) {
    const sessionId = event.currentTarget.dataset.sessionId;
    if (!sessionId) return;
    const item = this.data.enrollments.find((entry) => entry.sessionId === sessionId);
    if (item && !item.detailAvailable) {
      wx.showToast({ title: "活动已下架，报名记录仍保留", icon: "none" });
      return;
    }
    router.open(`/subpkg/activity/pages/detail/index?sessionId=${encodeURIComponent(sessionId)}&source=my_enrollments`);
  },

  confirmCancel(event) {
    const enrollmentId = event.currentTarget.dataset.enrollmentId;
    const item = this.data.enrollments.find((entry) => entry.enrollmentId === enrollmentId);
    if (!item || !item.canCancel || this.data.cancelingId || this._pendingCommand) return;
    const unresolved = pendingCommands.peek("CANCEL", item.sessionId, commandPayload(item.sessionId));
    if (unresolved) {
      this._unresolvedCommand = unresolved;
      this.setData({ result: unknownCancelResult(unresolved), cancelSheetVisible: false, pendingCancel: null });
      return;
    }
    this.setData({
      cancelSheetVisible: true,
      pendingCancel: cancellationSheet(item),
      result: null,
    });
  },

  closeCancelSheet() {
    if (this.data.cancelingId || this._pendingCommand) return;
    this.setData({ cancelSheetVisible: false, pendingCancel: null });
  },

  stopSheetTap() {},

  confirmCancelFromSheet() {
    if (!this.data.pendingCancel || this.data.cancelingId || this._pendingCommand) return;
    const item = this.data.enrollments.find(
      (entry) => entry.enrollmentId === this.data.pendingCancel.enrollmentId,
    );
    if (!item || !item.canCancel) {
      this.setData({ cancelSheetVisible: false, pendingCancel: null });
      return;
    }
    this.cancelEnrollment(item);
  },

  async fetchAuthoritativeActivity(sessionId) {
    const payload = await request({
      url: `/api/v1/activities/detail?sessionId=${encodeURIComponent(sessionId)}`,
    });
    const activity = presentActivityDetail(payload);
    if (!activity) throw new Error("ACTIVITY_DETAIL_INVALID");
    return activity;
  },

  async cancelEnrollment(item) {
    let command;
    try {
      command = pendingCommands.claim("CANCEL", item.sessionId, commandPayload(item.sessionId));
    } catch (_) {
      this.setData({
        cancelSheetVisible: false,
        pendingCancel: null,
        result: {
          kind: "UNKNOWN",
          title: "暂不能安全提交",
          body: "未能保存操作恢复记录。为避免重复取消，本次请求没有发出，请稍后重试。",
          support: true,
        },
      });
      return;
    }
    await this.submitCancelCommand(command, item);
  },

  async submitCancelCommand(command, item) {
    this._pendingCommand = command;
    this._unresolvedCommand = command;
    this.setData({ cancelingId: item.enrollmentId, result: null });
    track("activity_signup", {
      activityId: item.activityId || "",
      action: "CANCEL",
      result: "STARTED",
      failureReason: "",
    });
    let writeError = null;
    try {
      await request({
        url: "/api/v1/activities/cancel",
        method: "POST",
        idempotencyKey: command.idempotencyKey,
        data: { sessionId: command.sessionId },
      });
    } catch (error) {
      writeError = error;
    }

    let authorityActivity = null;
    try {
      authorityActivity = await this.fetchAuthoritativeActivity(command.sessionId);
    } catch (_) {
      // An unreadable authority response remains unknown; no local status is invented.
    }
    const confirmed = authorityActivity && commandReachedAuthorityState(command, authorityActivity);
    let result;
    if (confirmed) {
      try {
        pendingCommands.clear(command);
        this._unresolvedCommand = null;
        result = { kind: "SUCCESS", title: "报名已取消", body: "状态已从运营后台重新读取，请以当前记录为准。", support: false };
      } catch (_) {
        result = { kind: "UNKNOWN", title: "状态已确认，但恢复记录未清除", body: "权威记录已返回取消状态，但本机存储异常。请勿重试，并联系 ROOT 顾问。", support: true, auditRef: command.idempotencyKey };
      }
    } else if (writeError) {
      result = presentActivityWriteError(writeError);
      if (result.kind !== "UNKNOWN") {
        try {
          pendingCommands.clear(command);
          this._unresolvedCommand = null;
        } catch (_) {
          result = { kind: "UNKNOWN", title: "结果已返回，但恢复记录未清除", body: "本机存储异常。请勿重试，并联系 ROOT 顾问。", support: true, auditRef: command.idempotencyKey };
        }
      } else {
        result = unknownCancelResult(command);
      }
    } else {
      result = unknownCancelResult(command);
    }
    this._pendingCommand = null;
    this.setData({
      cancelingId: "",
      cancelSheetVisible: false,
      pendingCancel: null,
      result,
    });
    track("activity_signup", {
      activityId: item.activityId || "",
      action: "CANCEL",
      result: result.kind === "SUCCESS" ? "SUCCESS" : result.kind === "UNKNOWN" ? "UNKNOWN" : "FAILED",
      failureReason: result.kind === "SUCCESS" ? "" : failureReason(writeError || { code: result.kind }),
    });
    await this.loadEnrollments({ reset: true, preserveResult: true });
  },

  closeResult() {
    this.setData({ result: null });
  },

  retryPendingCancel() {
    if (this.data.cancelingId || this._pendingCommand || !this._unresolvedCommand) return;
    const item = this.data.enrollments.find((entry) => entry.sessionId === this._unresolvedCommand.sessionId);
    if (!item) {
      this.setData({ result: { ...unknownCancelResult(this._unresolvedCommand), body: "当前列表未加载到对应报名记录。请重新加载或联系 ROOT 顾问，不会自动重放。" } });
      return;
    }
    this.submitCancelCommand(this._unresolvedCommand, item);
  },

  voidPendingCancel() {
    if (this.data.cancelingId || this._pendingCommand || !this._unresolvedCommand) return;
    this.setData({ voidSheetVisible: true });
  },

  closeVoidSheet() {
    if (this.data.cancelingId || this._pendingCommand) return;
    this.setData({ voidSheetVisible: false });
  },

  confirmVoidPendingCancel() {
    if (this.data.cancelingId || this._pendingCommand || !this._unresolvedCommand) return;
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
        body: "后台状态未被改写。再次取消前，请重新加载并确认当前报名状态。",
        support: false,
      },
    });
  },

  backToList() {
    router.go("/pages/activities/index");
  },

  openSupport() {
    router.open("/subpkg/profile/pages/support/index?topic=activity&source=my_enrollments");
  },
});
