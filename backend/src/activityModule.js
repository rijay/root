const crypto = require("node:crypto");
const { createClientError } = require("./clientError");
const { nowISO } = require("./dates");
const { createId } = require("./seed");

const DEFINITION_STATES = Object.freeze(["DRAFT", "IN_REVIEW", "PUBLISHED", "UNPUBLISHED", "ARCHIVED"]);
const SESSION_STATES = Object.freeze(["SCHEDULED", "OPEN", "CLOSED", "CANCELED", "ENDED"]);
const ENROLLMENT_STATES = Object.freeze(["PENDING", "CONFIRMED", "REJECTED", "CANCELED"]);
const APPROVAL_MODES = Object.freeze(["AUTO", "MANUAL"]);
const PUBLICATION_AUTHORIZATION_MAX_AGE_MS = 5 * 60 * 1000;
const ADMIN_QUERY_DEFAULT_PAGE_SIZE = 20;
const ADMIN_QUERY_MAX_PAGE_SIZE = 100;
const PUBLIC_QUERY_DEFAULT_PAGE_SIZE = 10;
const PUBLIC_QUERY_MAX_PAGE_SIZE = 50;
const SESSION_CANCEL_REASONS = Object.freeze(["OPERATOR_CANCELED", "WEATHER", "VENUE", "FORCE_MAJEURE", "OTHER"]);
const ENROLLMENT_REASONS = Object.freeze([
  "USER_CANCELED",
  "SESSION_CANCELED",
  "APPROVAL_REJECTED",
  "REVIEW_TIMEOUT",
  "CAPACITY_FULL",
  "CAPACITY_FULL_AT_REVIEW",
  "CUTOFF_PASSED",
  "POLICY_BLOCKED",
  "OPERATOR_CORRECTION",
]);

function activityError(code, message, status = 200) {
  return createClientError(code, message, status);
}

function ensureList(data, key) {
  if (!Array.isArray(data[key])) data[key] = [];
  return data[key];
}

function ensureCollections(data) {
  return {
    definitions: ensureList(data, "activityDefinitionVersions"),
    sessions: ensureList(data, "activitySessions"),
    sessionEvents: ensureList(data, "activitySessionEvents"),
    enrollments: ensureList(data, "activityEnrollments"),
    events: ensureList(data, "activityEnrollmentEvents"),
  };
}

function requiredText(value, field) {
  const normalized = String(value || "").trim();
  if (!normalized) throw activityError("ACTIVITY_INPUT_INVALID", `${field}不能为空`, 400);
  return normalized;
}

function requiredBoundedText(value, field, maximumLength) {
  const normalized = requiredText(value, field);
  if (normalized.length > maximumLength) {
    throw activityError("ACTIVITY_INPUT_INVALID", `${field}长度超限`, 400);
  }
  return normalized;
}

function optionalText(value) {
  return String(value || "").trim();
}

function positiveInteger(value, field) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw activityError("ACTIVITY_INPUT_INVALID", `${field}必须是正整数`, 400);
  }
  return normalized;
}

function adminQueryText(value, field, maximumLength = 160) {
  const normalized = optionalText(value);
  if (normalized.length > maximumLength) {
    throw activityError("ACTIVITY_ADMIN_QUERY_INVALID", `${field}长度超限`, 400);
  }
  return normalized;
}

function adminQueryEnum(value, allowed, field) {
  const normalized = optionalText(value).toUpperCase();
  if (normalized && !allowed.includes(normalized)) {
    throw activityError("ACTIVITY_ADMIN_QUERY_INVALID", `${field}无效`, 400);
  }
  return normalized;
}

function adminQueryInteger(value, field, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0 || normalized > maximum) {
    throw activityError("ACTIVITY_ADMIN_QUERY_INVALID", `${field}必须是有效正整数`, 400);
  }
  return normalized;
}

function adminPagination(query = {}) {
  if (!query || typeof query !== "object" || Array.isArray(query)) {
    throw activityError("ACTIVITY_ADMIN_QUERY_INVALID", "query必须是对象", 400);
  }
  const requestedPageSize = [query.pageSize, query.page_size, query.limit]
    .find((value) => value !== undefined && value !== null && value !== "");
  return {
    page: adminQueryInteger(query.page, "page", 1),
    pageSize: adminQueryInteger(
      requestedPageSize,
      "pageSize",
      ADMIN_QUERY_DEFAULT_PAGE_SIZE,
      ADMIN_QUERY_MAX_PAGE_SIZE
    ),
  };
}

function firstAdminQueryValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function paginateAdminItems(items, query = {}) {
  const { page, pageSize } = adminPagination(query);
  const total = items.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  const offset = (page - 1) * pageSize;
  return {
    items: items.slice(offset, offset + pageSize),
    pagination: {
      page,
      pageSize,
      total,
      totalPages,
      hasNextPage: page < totalPages,
    },
  };
}

function publicPagination(query = {}) {
  if (!query || typeof query !== "object" || Array.isArray(query)) {
    throw activityError("ACTIVITY_QUERY_INVALID", "query必须是对象", 400);
  }
  const requestedPageSize = [query.pageSize, query.page_size, query.limit]
    .find((value) => value !== undefined && value !== null && value !== "");
  const parse = (value, field, fallback, maximum) => {
    if (value === undefined || value === null || value === "") return fallback;
    const normalized = Number(value);
    if (!Number.isInteger(normalized) || normalized <= 0 || normalized > maximum) {
      throw activityError("ACTIVITY_QUERY_INVALID", `${field}必须是有效正整数`, 400);
    }
    return normalized;
  };
  return {
    page: parse(query.page, "page", 1, Number.MAX_SAFE_INTEGER),
    pageSize: parse(requestedPageSize, "pageSize", PUBLIC_QUERY_DEFAULT_PAGE_SIZE, PUBLIC_QUERY_MAX_PAGE_SIZE),
  };
}

function paginatePublicItems(items, query = {}) {
  const { page, pageSize } = publicPagination(query);
  const total = items.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  const offset = (page - 1) * pageSize;
  return {
    items: items.slice(offset, offset + pageSize),
    pagination: {
      page,
      pageSize,
      total,
      totalPages,
      hasNextPage: page < totalPages,
    },
  };
}

function descendingInstant(left, right, field) {
  return optionalText(right[field]).localeCompare(optionalText(left[field]));
}

function normalizedNow(context = {}) {
  const value = context.now || context.occurredAt || nowISO();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw activityError("ACTIVITY_INPUT_INVALID", "时间格式无效", 400);
  return parsed.toISOString();
}

function compareTime(left, right) {
  return new Date(left).getTime() - new Date(right).getTime();
}

function definitionByVersion(data, activityVersionId) {
  return ensureCollections(data).definitions.find((item) => item.activity_version_id === activityVersionId) || null;
}

function sessionById(data, sessionId) {
  return ensureCollections(data).sessions.find((item) => item.activity_session_id === sessionId) || null;
}

function enrollmentByUser(data, sessionId, rootUserId) {
  return ensureCollections(data).enrollments.find((item) => (
    item.activity_session_id === sessionId && item.root_user_id === rootUserId
  )) || null;
}

function confirmedCount(data, sessionId) {
  return ensureCollections(data).enrollments.filter((item) => (
    item.activity_session_id === sessionId && item.status === "CONFIRMED"
  )).length;
}

function assertOpaqueRef(value, field) {
  const normalized = requiredText(value, field);
  if (normalized.length > 160 || /\s|https?:\/\/|@/.test(normalized)) {
    throw activityError("ACTIVITY_EVIDENCE_REF_INVALID", `${field}必须是受控系统中的不透明引用`, 400);
  }
  return normalized;
}

function assertSha256Digest(value, field) {
  const normalized = requiredText(value, field).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw activityError(
      "ACTIVITY_PUBLICATION_AUTHORIZATION_INPUT_INVALID",
      `${field}必须是SHA-256摘要`,
      403
    );
  }
  return normalized;
}

function publicationAuthorizationEnabled(env = {}) {
  return String(env.ROOT_ACTIVITY_PUBLICATION_AUTHORIZATION_ENABLED || "").trim().toLowerCase() === "true";
}

function publicationAuthorizationEvidence(definition, input = {}) {
  const controlledApprovalRef = assertOpaqueRef(
    input.controlledApprovalRef || input.controlled_approval_ref || input.contentApprovalRef
      || input.content_approval_ref,
    "controlledApprovalRef"
  );
  if (controlledApprovalRef !== definition.content_approval_ref) {
    throw activityError(
      "ACTIVITY_PUBLICATION_AUTHORIZATION_INPUT_INVALID",
      "受控审批引用与活动内容不一致",
      403
    );
  }
  return Object.freeze({
    controlledApprovalRef,
    contentAuthorizationDigest: assertSha256Digest(
      input.contentAuthorizationDigest || input.content_authorization_digest,
      "contentAuthorizationDigest"
    ),
    uedAcceptanceDigest: assertSha256Digest(
      input.uedAcceptanceDigest || input.ued_acceptance_digest,
      "uedAcceptanceDigest"
    ),
    photographyAuthorizationDigest: assertSha256Digest(
      input.photographyAuthorizationDigest || input.photography_authorization_digest,
      "photographyAuthorizationDigest"
    ),
    artifactProvenanceDigest: assertSha256Digest(
      input.artifactProvenanceDigest || input.artifact_provenance_digest,
      "artifactProvenanceDigest"
    ),
  });
}

function trustedAdminSignerRef(input = {}, context = {}, options = {}) {
  const principal = context.adminPrincipal;
  const errorCode = options.errorCode || "ACTIVITY_ADMIN_PRINCIPAL_UNTRUSTED";
  if (!principal || principal.tokenConfigured !== true || !optionalText(principal.operatorId)) {
    throw activityError(errorCode, `${options.field}缺少可信服务端主体`, 403);
  }
  const trustedSignerRef = assertOpaqueRef(principal.operatorId, options.field);
  const claimedOperatorId = optionalText(input.operatorId || input.operator_id);
  const claimedSignerRef = optionalText(input[options.camelKey] || input[options.snakeKey]);
  if ((claimedOperatorId && claimedOperatorId !== trustedSignerRef)
    || (claimedSignerRef && claimedSignerRef !== trustedSignerRef)) {
    throw activityError(errorCode, `${options.field}与服务端认证结果不一致`, 403);
  }
  return trustedSignerRef;
}

function authorizePublication(definition, input = {}, context = {}) {
  if (!publicationAuthorizationEnabled(context.env || {})) {
    throw activityError(
      "ACTIVITY_PUBLICATION_AUTHORIZATION_DISABLED",
      "活动发布授权开关未启用",
      403
    );
  }
  const adapter = context.activityPublicationAuthorizationAdapter;
  if (!adapter || typeof adapter.authorizeActivityPublication !== "function") {
    throw activityError(
      "ACTIVITY_PUBLICATION_AUTHORIZATION_ADAPTER_UNAVAILABLE",
      "活动发布授权适配器不可用",
      403
    );
  }
  const principal = context.adminPrincipal;
  if (!principal || principal.tokenConfigured !== true || !optionalText(principal.operatorId)) {
    throw activityError(
      "ACTIVITY_PUBLICATION_PRINCIPAL_UNTRUSTED",
      "活动发布缺少可信服务端主体",
      403
    );
  }
  if (optionalText(input.operatorId || input.operator_id) !== optionalText(principal.operatorId)) {
    throw activityError(
      "ACTIVITY_PUBLICATION_PRINCIPAL_UNTRUSTED",
      "活动发布主体与服务端认证结果不一致",
      403
    );
  }
  const evidence = publicationAuthorizationEvidence(definition, input);
  const request = Object.freeze({
    operation: "ACTIVITY_PUBLISH",
    activity: Object.freeze({
      ...toDefinitionPayload(definition),
      source: definition.source,
      contentApprovalRef: definition.content_approval_ref,
      contactOwnerSignerRef: definition.contact_owner_signer_ref,
    }),
    evidence,
    principal: Object.freeze({
      operatorId: optionalText(principal.operatorId),
      role: optionalText(principal.role),
      tokenConfigured: true,
    }),
    requestId: requiredText(input.requestId || input.request_id, "requestId"),
  });
  let decision;
  try {
    decision = adapter.authorizeActivityPublication(request);
  } catch (_) {
    throw activityError(
      "ACTIVITY_PUBLICATION_AUTHORIZATION_FAILED",
      "活动发布授权校验失败",
      403
    );
  }
  if (!decision || typeof decision.then === "function" || decision.authorized !== true) {
    throw activityError(
      "ACTIVITY_PUBLICATION_NOT_AUTHORIZED",
      "活动发布未通过受控授权",
      403
    );
  }
  const adapterId = assertOpaqueRef(decision.adapterId || decision.adapter_id, "adapterId");
  const decisionRef = assertOpaqueRef(decision.decisionRef || decision.decision_ref, "decisionRef");
  const publishOwnerSignerRef = assertOpaqueRef(
    decision.publishOwnerSignerRef || decision.publish_owner_signer_ref,
    "publishOwnerSignerRef"
  );
  const rawVerifiedAt = optionalText(decision.verifiedAt || decision.verified_at);
  if (!rawVerifiedAt) {
    throw activityError(
      "ACTIVITY_PUBLICATION_NOT_AUTHORIZED",
      "活动发布授权结论缺少显式校验时间",
      403
    );
  }
  let verifiedAt;
  try {
    verifiedAt = normalizedNow({ now: rawVerifiedAt });
  } catch (_) {
    throw activityError(
      "ACTIVITY_PUBLICATION_NOT_AUTHORIZED",
      "活动发布授权结论校验时间无效",
      403
    );
  }
  const authorizedAtMs = new Date(verifiedAt).getTime();
  const commandAtMs = new Date(normalizedNow(context)).getTime();
  if (authorizedAtMs > commandAtMs
    || commandAtMs - authorizedAtMs > PUBLICATION_AUTHORIZATION_MAX_AGE_MS) {
    throw activityError(
      "ACTIVITY_PUBLICATION_NOT_AUTHORIZED",
      "活动发布授权结论不在有效时间窗内",
      403
    );
  }
  const decisionEvidence = decision.evidence || {};
  const exactEvidence = [
    "controlledApprovalRef",
    "contentAuthorizationDigest",
    "uedAcceptanceDigest",
    "photographyAuthorizationDigest",
    "artifactProvenanceDigest",
  ].every((key) => decisionEvidence[key] === evidence[key]);
  const exactActivity = optionalText(decision.activityVersionId || decision.activity_version_id)
      === definition.activity_version_id
    && optionalText(decision.activityId || decision.activity_id) === definition.activity_id;
  if (!exactEvidence
    || !exactActivity
    || optionalText(decision.requestId || decision.request_id) !== request.requestId
    || optionalText(decision.principalOperatorId || decision.principal_operator_id) !== principal.operatorId) {
    throw activityError(
      "ACTIVITY_PUBLICATION_NOT_AUTHORIZED",
      "活动发布授权结论与请求事实不一致",
      403
    );
  }
  return Object.freeze({ adapterId, decisionRef, publishOwnerSignerRef, verifiedAt, evidence });
}

function normalizeContent(input = {}) {
  return {
    title: requiredBoundedText(input.title, "title", 160),
    summary: requiredBoundedText(input.summary, "summary", 512),
    objective: requiredBoundedText(input.objective, "objective", 1024),
    audience: requiredBoundedText(input.audience, "audience", 1024),
    agenda: requiredBoundedText(input.agenda, "agenda", 2048),
    organizer: requiredBoundedText(input.organizer, "organizer", 256),
    fee_description: requiredBoundedText(
      input.feeDescription || input.fee_description,
      "feeDescription",
      256
    ),
    bring_items: requiredBoundedText(input.bringItems || input.bring_items, "bringItems", 1024),
    cancel_policy: requiredBoundedText(input.cancelPolicy || input.cancel_policy, "cancelPolicy", 1024),
    privacy_notice_text: requiredBoundedText(
      input.privacyNoticeText || input.privacy_notice_text,
      "privacyNoticeText",
      2048
    ),
    photography_notice_text: requiredBoundedText(
      input.photographyNoticeText || input.photography_notice_text,
      "photographyNoticeText",
      2048
    ),
    contact_display: requiredBoundedText(
      input.contactDisplay || input.contact_display,
      "contactDisplay",
      256
    ),
    detail_version: requiredText(input.detailVersion || input.detail_version, "detailVersion"),
    city: requiredBoundedText(input.city, "city", 64),
    venue_summary: requiredBoundedText(input.venueSummary || input.venue_summary, "venueSummary", 256),
    activity_type: requiredBoundedText(input.activityType || input.activity_type, "activityType", 64),
    hero_asset_ref: assertOpaqueRef(input.heroAssetRef || input.hero_asset_ref, "heroAssetRef"),
    privacy_notice_ref: assertOpaqueRef(input.privacyNoticeRef || input.privacy_notice_ref, "privacyNoticeRef"),
    photography_notice_ref: assertOpaqueRef(
      input.photographyNoticeRef || input.photography_notice_ref,
      "photographyNoticeRef"
    ),
    content_approval_ref: assertOpaqueRef(input.contentApprovalRef || input.content_approval_ref, "contentApprovalRef"),
    source: requiredText(input.source, "source").toUpperCase(),
  };
}

function upsertDraft(data, input = {}, context = {}) {
  const definitions = Array.isArray(data.activityDefinitionVersions)
    ? data.activityDefinitionVersions
    : [];
  const now = normalizedNow(context);
  const activityId = requiredText(input.activityId || input.activity_id, "activityId");
  const version = positiveInteger(input.version, "version");
  let definition = definitions.find((item) => item.activity_id === activityId && item.version === version);
  if (definition && definition.status !== "DRAFT") {
    throw activityError("ACTIVITY_VERSION_IMMUTABLE", "已发布或归档的活动版本不可原地修改", 409);
  }
  const content = normalizeContent(input);
  if (content.source !== "OPS_BACKEND") {
    throw activityError("ACTIVITY_SOURCE_NOT_AUTHORIZED", "活动正式内容必须由运营后台注入", 403);
  }
  const visibility = String(input.visibility || "PUBLIC").trim().toUpperCase();
  if (!["PUBLIC", "MEMBER"].includes(visibility)) {
    throw activityError("ACTIVITY_VISIBILITY_INVALID", "visibility无效", 400);
  }
  if (visibility === "MEMBER" && !optionalText(input.memberRequirement || input.member_requirement)) {
    throw activityError("ACTIVITY_MEMBER_REQUIREMENT_REQUIRED", "会员活动必须声明会员要求", 400);
  }
  const contactOwnerSignerRef = assertOpaqueRef(
    input.contactOwnerSignerRef || input.contact_owner_signer_ref,
    "contactOwnerSignerRef"
  );
  const preboundTaskDefinitionId = optionalText(
    input.preboundTaskDefinitionId || input.prebound_task_definition_id
  );
  const preboundTaskDefinitionVersion = optionalText(
    input.preboundTaskDefinitionVersion || input.prebound_task_definition_version
  );
  if (preboundTaskDefinitionId.length > 32 || preboundTaskDefinitionVersion.length > 64) {
    throw activityError("ACTIVITY_TASK_BINDING_INCOMPLETE", "预绑定任务标识或版本长度超限", 400);
  }
  if (Boolean(preboundTaskDefinitionId) !== Boolean(preboundTaskDefinitionVersion)) {
    throw activityError("ACTIVITY_TASK_BINDING_INCOMPLETE", "预绑定任务标识与版本必须同时填写", 400);
  }
  if (!Array.isArray(data.activityDefinitionVersions)) data.activityDefinitionVersions = definitions;
  if (!definition) {
    definition = {
      activity_version_id: optionalText(input.activityVersionId || input.activity_version_id) || createId("actv"),
      activity_id: activityId,
      version,
      status: "DRAFT",
      created_at: now,
    };
    definitions.push(definition);
  }
  Object.assign(definition, content, {
    status: "DRAFT",
    visibility,
    member_requirement: optionalText(input.memberRequirement || input.member_requirement),
    contact_owner_signer_ref: contactOwnerSignerRef,
    prebound_task_definition_id: preboundTaskDefinitionId,
    prebound_task_definition_version: preboundTaskDefinitionVersion,
    published_at: null,
    updated_at: now,
  });
  return toDefinitionPayload(definition);
}

function submitForReview(data, activityVersionId, context = {}) {
  const definition = definitionByVersion(data, requiredText(activityVersionId, "activityVersionId"));
  if (!definition) throw activityError("ACTIVITY_NOT_FOUND", "活动版本不存在", 404);
  if (definition.status !== "DRAFT") throw activityError("ACTIVITY_STATE_CONFLICT", "仅草稿可提交审核", 409);
  definition.status = "IN_REVIEW";
  definition.updated_at = normalizedNow(context);
  return toDefinitionPayload(definition);
}

function requestChanges(data, activityVersionId, input = {}, context = {}) {
  const definition = definitionByVersion(data, requiredText(activityVersionId, "activityVersionId"));
  if (!definition) throw activityError("ACTIVITY_NOT_FOUND", "活动版本不存在", 404);
  if (definition.status !== "IN_REVIEW") throw activityError("ACTIVITY_STATE_CONFLICT", "仅审核中的活动可退回修改", 409);
  const reason = requiredText(input.reason, "reason");
  const reviewerSignerRef = trustedAdminSignerRef(input, context, {
    field: "reviewerSignerRef",
    camelKey: "reviewerSignerRef",
    snakeKey: "reviewer_signer_ref",
    errorCode: "ACTIVITY_REVIEWER_PRINCIPAL_UNTRUSTED",
  });
  const now = normalizedNow(context);
  definition.status = "DRAFT";
  definition.review_reason_code = "CHANGES_REQUESTED";
  definition.review_reason = reason;
  definition.reviewer_signer_ref = reviewerSignerRef;
  definition.updated_at = now;
  return toDefinitionPayload(definition);
}

function publish(data, activityVersionId, input = {}, context = {}) {
  const { definitions } = ensureCollections(data);
  const definition = definitionByVersion(data, requiredText(activityVersionId, "activityVersionId"));
  if (!definition) throw activityError("ACTIVITY_NOT_FOUND", "活动版本不存在", 404);
  if (definition.status !== "IN_REVIEW") throw activityError("ACTIVITY_STATE_CONFLICT", "仅审核中的活动可发布", 409);
  if (definition.source !== "OPS_BACKEND") throw activityError("ACTIVITY_SOURCE_NOT_AUTHORIZED", "活动来源未获授权", 403);
  const authorization = authorizePublication(definition, input, context);
  const conflicting = definitions.find((item) => (
    item.activity_id === definition.activity_id && item.status === "PUBLISHED" && item.activity_version_id !== activityVersionId
  ));
  if (conflicting) throw activityError("ACTIVITY_PUBLISHED_VERSION_CONFLICT", "同一活动已有发布版本", 409);
  const reusedDecision = definitions.find((item) => (
    item.activity_version_id !== activityVersionId
    && item.publication_authorization_adapter_id === authorization.adapterId
    && item.publication_authorization_decision_ref === authorization.decisionRef
  ));
  if (reusedDecision) {
    throw activityError("ACTIVITY_PUBLICATION_DECISION_REUSED", "活动发布授权结论已绑定其他版本", 409);
  }
  const now = normalizedNow(context);
  definition.status = "PUBLISHED";
  definition.publish_owner_signer_ref = authorization.publishOwnerSignerRef;
  definition.publication_authorization_adapter_id = authorization.adapterId;
  definition.publication_authorization_decision_ref = authorization.decisionRef;
  definition.publication_authorized_principal_ref = context.adminPrincipal.operatorId;
  definition.controlled_approval_ref = authorization.evidence.controlledApprovalRef;
  definition.content_authorization_digest = authorization.evidence.contentAuthorizationDigest;
  definition.ued_acceptance_digest = authorization.evidence.uedAcceptanceDigest;
  definition.photography_authorization_digest = authorization.evidence.photographyAuthorizationDigest;
  definition.artifact_provenance_digest = authorization.evidence.artifactProvenanceDigest;
  definition.authorization_verified_at = authorization.verifiedAt;
  definition.published_at = now;
  definition.updated_at = now;
  return toDefinitionPayload(definition);
}

function unpublish(data, activityVersionId, input = {}, context = {}) {
  const definition = definitionByVersion(data, requiredText(activityVersionId, "activityVersionId"));
  if (!definition) throw activityError("ACTIVITY_NOT_FOUND", "活动版本不存在", 404);
  if (definition.status !== "PUBLISHED") throw activityError("ACTIVITY_STATE_CONFLICT", "仅已发布活动可下架", 409);
  const withdrawOwnerSignerRef = trustedAdminSignerRef(input, context, {
    field: "withdrawOwnerSignerRef",
    camelKey: "withdrawOwnerSignerRef",
    snakeKey: "withdraw_owner_signer_ref",
    errorCode: "ACTIVITY_WITHDRAW_PRINCIPAL_UNTRUSTED",
  });
  const withdrawReason = requiredText(input.reason, "reason");
  const now = normalizedNow(context);
  definition.status = "UNPUBLISHED";
  definition.withdraw_owner_signer_ref = withdrawOwnerSignerRef;
  definition.withdraw_reason = withdrawReason;
  definition.updated_at = now;
  return toDefinitionPayload(definition);
}

function archive(data, activityVersionId, input = {}, context = {}) {
  const definition = definitionByVersion(data, requiredText(activityVersionId, "activityVersionId"));
  if (!definition) throw activityError("ACTIVITY_NOT_FOUND", "活动版本不存在", 404);
  if (definition.status !== "UNPUBLISHED") throw activityError("ACTIVITY_STATE_CONFLICT", "仅已下架活动可归档", 409);
  const archiveReason = requiredText(input.reason, "reason");
  const archiveOwnerSignerRef = trustedAdminSignerRef(input, context, {
    field: "archiveOwnerSignerRef",
    camelKey: "archiveOwnerSignerRef",
    snakeKey: "archive_owner_signer_ref",
    errorCode: "ACTIVITY_ARCHIVE_PRINCIPAL_UNTRUSTED",
  });
  const now = normalizedNow(context);
  definition.status = "ARCHIVED";
  definition.archive_reason = archiveReason;
  definition.archive_owner_signer_ref = archiveOwnerSignerRef;
  definition.updated_at = now;
  return toDefinitionPayload(definition);
}

function createSession(data, input = {}, context = {}) {
  const { sessions } = ensureCollections(data);
  const activityVersionId = requiredText(input.activityVersionId || input.activity_version_id, "activityVersionId");
  const definition = definitionByVersion(data, activityVersionId);
  if (!definition || definition.status !== "PUBLISHED") {
    throw activityError("ACTIVITY_VERSION_NOT_PUBLISHED", "仅已发布活动版本可创建场次", 409);
  }
  const sessionId = optionalText(input.sessionId || input.activity_session_id) || createId("acts");
  if (sessions.some((item) => item.activity_session_id === sessionId)) {
    throw activityError("ACTIVITY_SESSION_CONFLICT", "活动场次已存在", 409);
  }
  const approvalMode = String(input.approvalMode || input.approval_mode || "AUTO").trim().toUpperCase();
  if (!APPROVAL_MODES.includes(approvalMode)) throw activityError("ACTIVITY_INPUT_INVALID", "approvalMode无效", 400);
  const registrationOpenAt = requiredText(input.registrationOpenAt || input.registration_open_at, "registrationOpenAt");
  const registrationCloseAt = requiredText(input.registrationCloseAt || input.registration_close_at, "registrationCloseAt");
  const cancelCloseAt = requiredText(input.cancelCloseAt || input.cancel_close_at, "cancelCloseAt");
  const sessionStartAt = requiredText(input.sessionStartAt || input.session_start_at, "sessionStartAt");
  const sessionEndAt = requiredText(input.sessionEndAt || input.session_end_at, "sessionEndAt");
  [registrationOpenAt, registrationCloseAt, cancelCloseAt, sessionStartAt, sessionEndAt]
    .forEach((value) => normalizedNow({ now: value }));
  if (!(compareTime(registrationOpenAt, registrationCloseAt) < 0
    && compareTime(registrationCloseAt, sessionStartAt) <= 0
    && compareTime(registrationOpenAt, cancelCloseAt) < 0
    && compareTime(cancelCloseAt, sessionStartAt) <= 0
    && compareTime(sessionStartAt, sessionEndAt) < 0)) {
    throw activityError("ACTIVITY_TIME_WINDOW_INVALID", "报名、取消和场次时间顺序无效", 400);
  }
  const reviewDeadline = optionalText(input.reviewDeadline || input.review_deadline);
  if (approvalMode === "MANUAL" && !reviewDeadline) {
    throw activityError("ACTIVITY_REVIEW_DEADLINE_REQUIRED", "人工审核场次必须设置审核截止时间", 400);
  }
  if (reviewDeadline) {
    normalizedNow({ now: reviewDeadline });
    if (
      compareTime(reviewDeadline, registrationCloseAt) < 0
      || compareTime(reviewDeadline, sessionStartAt) > 0
    ) throw activityError("ACTIVITY_REVIEW_DEADLINE_INVALID", "审核截止时间必须位于报名截止与场次开始之间", 400);
  }
  const normalizedTimes = {
    registrationOpenAt: new Date(registrationOpenAt).toISOString(),
    registrationCloseAt: new Date(registrationCloseAt).toISOString(),
    cancelCloseAt: new Date(cancelCloseAt).toISOString(),
    sessionStartAt: new Date(sessionStartAt).toISOString(),
    sessionEndAt: new Date(sessionEndAt).toISOString(),
    reviewDeadline: reviewDeadline ? new Date(reviewDeadline).toISOString() : null,
  };
  const capacity = positiveInteger(input.capacity, "capacity");
  const allowReapply = input.allowReapply === true || input.allow_reapply === true;
  if (allowReapply && definition.prebound_task_definition_id) {
    throw activityError(
      "ACTIVITY_TASK_REAPPLY_UNSUPPORTED",
      "预绑定任务的活动场次暂不支持取消后重新报名",
      409
    );
  }
  const existingBusinessSession = sessions.find((item) => (
    item.activity_version_id === activityVersionId
    && item.session_start_at === normalizedTimes.sessionStartAt
  ));
  if (existingBusinessSession) {
    const sameIntent = existingBusinessSession.approval_mode === approvalMode
      && existingBusinessSession.capacity === capacity
      && existingBusinessSession.registration_open_at === normalizedTimes.registrationOpenAt
      && existingBusinessSession.registration_close_at === normalizedTimes.registrationCloseAt
      && existingBusinessSession.cancel_close_at === normalizedTimes.cancelCloseAt
      && existingBusinessSession.review_deadline === normalizedTimes.reviewDeadline
      && existingBusinessSession.session_end_at === normalizedTimes.sessionEndAt
      && existingBusinessSession.allow_reapply === allowReapply;
    if (sameIntent) return toSessionPayload(data, existingBusinessSession);
    throw activityError("ACTIVITY_SESSION_BUSINESS_CONFLICT", "同一活动版本和开始时间已存在不同场次配置", 409);
  }
  const now = normalizedNow(context);
  const session = {
    activity_session_id: sessionId,
    activity_version_id: activityVersionId,
    status: "SCHEDULED",
    approval_mode: approvalMode,
    capacity,
    registration_open_at: normalizedTimes.registrationOpenAt,
    registration_close_at: normalizedTimes.registrationCloseAt,
    cancel_close_at: normalizedTimes.cancelCloseAt,
    review_deadline: normalizedTimes.reviewDeadline,
    session_start_at: normalizedTimes.sessionStartAt,
    session_end_at: normalizedTimes.sessionEndAt,
    allow_reapply: allowReapply,
    created_at: now,
    updated_at: now,
  };
  sessions.push(session);
  return toSessionPayload(data, session);
}

function setSessionState(data, sessionId, nextStatus, context = {}) {
  const session = sessionById(data, requiredText(sessionId, "sessionId"));
  if (!session) throw activityError("ACTIVITY_SESSION_NOT_FOUND", "活动场次不存在", 404);
  const allowed = {
    SCHEDULED: ["OPEN"],
    OPEN: ["CLOSED"],
    CLOSED: ["ENDED"],
    CANCELED: [],
    ENDED: [],
  };
  const target = requiredText(nextStatus, "nextStatus").toUpperCase();
  if (!SESSION_STATES.includes(target) || !allowed[session.status].includes(target)) {
    throw activityError("ACTIVITY_SESSION_STATE_CONFLICT", "场次状态迁移无效", 409);
  }
  if (target === "ENDED" && ensureCollections(data).enrollments.some((item) => (
    item.activity_session_id === session.activity_session_id && item.status === "PENDING"
  ))) {
    throw activityError("ACTIVITY_PENDING_ENROLLMENTS_EXIST", "仍有待审核报名，场次不可结束", 409);
  }
  session.status = target;
  session.updated_at = normalizedNow(context);
  return toSessionPayload(data, session);
}

function requestReplay(data, requestId, operation, subjectId, attemptGeneration = null) {
  const collections = ensureCollections(data);
  if (collections.sessionEvents.some((item) => item.request_id === requestId)) {
    throw activityError("ACTIVITY_IDEMPOTENCY_CONFLICT", "请求标识已用于其他活动写入", 409);
  }
  const event = collections.events.find((item) => item.request_id === requestId);
  if (!event) return null;
  if (event.operation !== operation
    || event.activity_enrollment_id !== subjectId
    || (attemptGeneration !== null && event.attempt_generation !== attemptGeneration)) {
    throw activityError("ACTIVITY_IDEMPOTENCY_CONFLICT", "请求标识已用于其他活动写入", 409);
  }
  return event;
}

function appendEnrollmentEvent(data, enrollment, input = {}) {
  const collections = ensureCollections(data);
  const events = collections.events;
  const requestId = requiredText(input.requestId || input.request_id, "requestId");
  if (collections.sessionEvents.some((item) => item.request_id === requestId)) {
    throw activityError("ACTIVITY_IDEMPOTENCY_CONFLICT", "请求标识已用于其他活动写入", 409);
  }
  const existing = requestReplay(
    data,
    requestId,
    input.operation,
    enrollment.activity_enrollment_id,
    enrollment.attempt_generation
  );
  if (existing) return existing;
  const eventSequence = events.filter((item) => item.activity_enrollment_id === enrollment.activity_enrollment_id).length + 1;
  const event = {
    activity_enrollment_event_id: createId("aee"),
    activity_enrollment_id: enrollment.activity_enrollment_id,
    activity_session_id: enrollment.activity_session_id,
    root_user_id: enrollment.root_user_id,
    attempt_generation: enrollment.attempt_generation,
    event_sequence: eventSequence,
    operation: input.operation,
    from_status: input.fromStatus || null,
    to_status: enrollment.status,
    reason_code: input.reasonCode || null,
    request_id: requestId,
    occurred_at: input.occurredAt,
  };
  events.push(event);
  return event;
}

function sessionEventReplay(data, requestId, operation, sessionId) {
  const collections = ensureCollections(data);
  const event = collections.sessionEvents.find((item) => item.request_id === requestId);
  if (event) {
    if (event.operation !== operation || event.activity_session_id !== sessionId) {
      throw activityError("ACTIVITY_IDEMPOTENCY_CONFLICT", "请求标识已用于其他活动写入", 409);
    }
    return event;
  }
  if (collections.events.some((item) => item.request_id === requestId)) {
    throw activityError("ACTIVITY_IDEMPOTENCY_CONFLICT", "请求标识已用于其他活动写入", 409);
  }
  return null;
}

function appendSessionEvent(data, session, input = {}) {
  const sessionEvents = ensureCollections(data).sessionEvents;
  const requestId = requiredText(input.requestId || input.request_id, "requestId");
  const operation = requiredText(input.operation, "operation");
  const existing = sessionEventReplay(data, requestId, operation, session.activity_session_id);
  if (existing) return existing;
  const event = {
    activity_session_event_id: createId("ase"),
    activity_session_id: session.activity_session_id,
    event_sequence: sessionEvents.filter((item) => (
      item.activity_session_id === session.activity_session_id
    )).length + 1,
    operation,
    from_status: input.fromStatus || null,
    to_status: session.status,
    reason_code: input.reasonCode || null,
    reason_detail: optionalText(input.reasonDetail),
    request_id: requestId,
    actor_ref: assertOpaqueRef(input.actorRef, "actorRef"),
    occurred_at: input.occurredAt,
  };
  sessionEvents.push(event);
  return event;
}

function assertSessionAcceptsEnrollment(data, session, now, context = {}) {
  const definition = definitionByVersion(data, session.activity_version_id);
  if (!definition || definition.status !== "PUBLISHED") {
    throw activityError("ACTIVITY_NOT_AVAILABLE", "活动当前不可报名", 409);
  }
  if (session.status !== "OPEN") throw activityError("ACTIVITY_SESSION_NOT_OPEN", "场次当前不可报名", 409);
  if (definition.visibility === "MEMBER" && context.memberStatus !== "ACTIVE") {
    throw activityError("ACTIVE_MEMBERSHIP_REQUIRED", "该活动仅对已关联的有效会员开放", 403);
  }
  if (compareTime(now, session.registration_open_at) < 0) {
    throw activityError("REGISTRATION_NOT_OPEN", "报名尚未开始", 409);
  }
  if (compareTime(now, session.registration_close_at) >= 0) {
    throw activityError("CUTOFF_PASSED", "报名已截止", 409);
  }
}

function enroll(data, rootUserId, input = {}, context = {}) {
  const { enrollments } = ensureCollections(data);
  const userId = requiredText(rootUserId, "rootUserId");
  const sessionId = requiredText(input.sessionId || input.activity_session_id, "sessionId");
  const requestId = requiredText(input.requestId || input.request_id, "requestId");
  const now = normalizedNow(context);
  const session = sessionById(data, sessionId);
  if (!session) throw activityError("ACTIVITY_SESSION_NOT_FOUND", "活动场次不存在", 404);
  assertSessionAcceptsEnrollment(data, session, now, context);
  let enrollment = enrollmentByUser(data, sessionId, userId);
  const intendedGeneration = enrollment
    ? (enrollment.status === "CANCELED" && session.allow_reapply
      ? enrollment.attempt_generation + 1
      : enrollment.attempt_generation)
    : 1;
  const replay = requestReplay(
    data,
    requestId,
    "ENROLL",
    enrollment ? enrollment.activity_enrollment_id : "",
    intendedGeneration
  );
  if (replay) return { enrollment: toEnrollmentPayload(enrollment), replayed: true };
  if (enrollment) {
    if (["PENDING", "CONFIRMED"].includes(enrollment.status)) {
      return { enrollment: toEnrollmentPayload(enrollment), replayed: true };
    }
    if (enrollment.status !== "CANCELED" || !session.allow_reapply) {
      throw activityError("ACTIVITY_REAPPLY_NOT_ALLOWED", "当前报名记录不可重新申请", 409);
    }
  }
  const nextStatus = session.approval_mode === "MANUAL" ? "PENDING" : "CONFIRMED";
  if (nextStatus === "CONFIRMED" && confirmedCount(data, sessionId) >= session.capacity) {
    throw activityError("CAPACITY_FULL", "活动名额已满", 409);
  }
  const fromStatus = enrollment ? enrollment.status : null;
  if (!enrollment) {
    enrollment = {
      activity_enrollment_id: createId("aen"),
      activity_session_id: sessionId,
      root_user_id: userId,
      attempt_generation: 1,
      created_at: now,
    };
    enrollments.push(enrollment);
  } else {
    enrollment.attempt_generation += 1;
  }
  enrollment.status = nextStatus;
  enrollment.reason_code = null;
  enrollment.updated_at = now;
  appendEnrollmentEvent(data, enrollment, {
    operation: "ENROLL",
    fromStatus,
    requestId,
    occurredAt: now,
  });
  return { enrollment: toEnrollmentPayload(enrollment), replayed: false };
}

function reviewEnrollment(data, input = {}, context = {}) {
  const enrollmentId = requiredText(input.enrollmentId || input.activity_enrollment_id, "enrollmentId");
  const requestId = requiredText(input.requestId || input.request_id, "requestId");
  const enrollment = ensureCollections(data).enrollments.find((item) => item.activity_enrollment_id === enrollmentId);
  if (!enrollment) throw activityError("ACTIVITY_ENROLLMENT_NOT_FOUND", "报名记录不存在", 404);
  const expectedAttemptGeneration = positiveInteger(
    input.expectedAttemptGeneration || input.expected_attempt_generation,
    "expectedAttemptGeneration"
  );
  if (expectedAttemptGeneration !== enrollment.attempt_generation) {
    throw activityError("ACTIVITY_ENROLLMENT_GENERATION_CONFLICT", "报名申请已发生变化，请刷新后重试", 409);
  }
  const session = sessionById(data, enrollment.activity_session_id);
  if (!session || session.approval_mode !== "MANUAL") {
    throw activityError("ACTIVITY_ENROLLMENT_STATE_CONFLICT", "该场次不支持人工审核", 409);
  }
  const now = normalizedNow(context);
  const timedOut = compareTime(now, session.review_deadline) >= 0;
  const operation = timedOut ? "REVIEW_TIMEOUT" : "REVIEW";
  const replay = requestReplay(data, requestId, operation, enrollmentId, expectedAttemptGeneration);
  if (replay) return { enrollment: toEnrollmentPayload(enrollment), replayed: true };
  if (enrollment.status !== "PENDING") throw activityError("ACTIVITY_ENROLLMENT_STATE_CONFLICT", "仅审核中报名可处理", 409);
  if (["CANCELED", "ENDED"].includes(session.status)) {
    throw activityError("ACTIVITY_SESSION_STATE_CONFLICT", "当前场次不可审核报名", 409);
  }
  const approve = input.approve === true;
  const fromStatus = enrollment.status;
  if (timedOut) {
    enrollment.status = "REJECTED";
    enrollment.reason_code = "REVIEW_TIMEOUT";
  } else if (approve && confirmedCount(data, session.activity_session_id) < session.capacity) {
    enrollment.status = "CONFIRMED";
    enrollment.reason_code = null;
  } else {
    enrollment.status = "REJECTED";
    enrollment.reason_code = approve ? "CAPACITY_FULL_AT_REVIEW" : "APPROVAL_REJECTED";
  }
  enrollment.updated_at = now;
  appendEnrollmentEvent(data, enrollment, {
    operation,
    fromStatus,
    reasonCode: enrollment.reason_code,
    requestId,
    occurredAt: now,
  });
  return { enrollment: toEnrollmentPayload(enrollment), replayed: false };
}

function expirePendingReviews(data, input = {}, context = {}) {
  const requestId = requiredText(input.requestId || input.request_id, "requestId");
  const now = normalizedNow(context);
  let processedCount = 0;
  const { enrollments } = ensureCollections(data);
  enrollments.forEach((enrollment) => {
    if (enrollment.status !== "PENDING") return;
    const session = sessionById(data, enrollment.activity_session_id);
    if (!session || session.approval_mode !== "MANUAL" || !session.review_deadline) return;
    if (compareTime(now, session.review_deadline) < 0) return;
    const eventRequestId = `REVIEW_TIMEOUT:${crypto.createHash("sha256")
      .update(`${requestId}:${enrollment.activity_enrollment_id}`)
      .digest("hex")}`;
    const replay = requestReplay(
      data,
      eventRequestId,
      "REVIEW_TIMEOUT",
      enrollment.activity_enrollment_id,
      enrollment.attempt_generation
    );
    if (replay) return;
    const fromStatus = enrollment.status;
    enrollment.status = "REJECTED";
    enrollment.reason_code = "REVIEW_TIMEOUT";
    enrollment.updated_at = now;
    appendEnrollmentEvent(data, enrollment, {
      operation: "REVIEW_TIMEOUT",
      fromStatus,
      reasonCode: "REVIEW_TIMEOUT",
      requestId: eventRequestId,
      occurredAt: now,
    });
    processedCount += 1;
  });
  return { processedCount, occurredAt: now };
}

function cancelEnrollment(data, rootUserId, input = {}, context = {}) {
  const userId = requiredText(rootUserId, "rootUserId");
  const sessionId = requiredText(input.sessionId || input.activity_session_id, "sessionId");
  const requestId = requiredText(input.requestId || input.request_id, "requestId");
  const enrollment = enrollmentByUser(data, sessionId, userId);
  if (!enrollment) throw activityError("ACTIVITY_ENROLLMENT_NOT_FOUND", "报名记录不存在", 404);
  const replay = requestReplay(
    data,
    requestId,
    "CANCEL",
    enrollment.activity_enrollment_id,
    enrollment.attempt_generation
  );
  if (replay) return { enrollment: toEnrollmentPayload(enrollment), replayed: true };
  if (enrollment.status === "CANCELED") return { enrollment: toEnrollmentPayload(enrollment), replayed: true };
  if (!["PENDING", "CONFIRMED"].includes(enrollment.status)) {
    throw activityError("ACTIVITY_ENROLLMENT_STATE_CONFLICT", "当前报名状态不可取消", 409);
  }
  const session = sessionById(data, sessionId);
  const now = normalizedNow(context);
  if (!session || compareTime(now, session.cancel_close_at) >= 0) {
    throw activityError("CUTOFF_PASSED", "已超过取消截止时间，请联系人工协助", 409);
  }
  const fromStatus = enrollment.status;
  enrollment.status = "CANCELED";
  enrollment.reason_code = "USER_CANCELED";
  enrollment.updated_at = now;
  appendEnrollmentEvent(data, enrollment, {
    operation: "CANCEL",
    fromStatus,
    reasonCode: "USER_CANCELED",
    requestId,
    occurredAt: now,
  });
  return { enrollment: toEnrollmentPayload(enrollment), replayed: false };
}

function cancelSession(data, sessionId, input = {}, context = {}) {
  const session = sessionById(data, requiredText(sessionId, "sessionId"));
  if (!session) throw activityError("ACTIVITY_SESSION_NOT_FOUND", "活动场次不存在", 404);
  const requestId = requiredText(input.requestId || input.request_id, "requestId");
  const replay = sessionEventReplay(data, requestId, "SESSION_CANCELED", session.activity_session_id);
  if (replay) return toSessionPayload(data, session);
  if (["CANCELED", "ENDED"].includes(session.status)) {
    if (session.status === "CANCELED") {
      throw activityError("ACTIVITY_SESSION_STATE_CONFLICT", "场次已由其他请求取消", 409);
    }
    throw activityError("ACTIVITY_SESSION_STATE_CONFLICT", "已结束场次不可取消", 409);
  }
  const reason = requiredText(input.reason, "reason").toUpperCase();
  if (!SESSION_CANCEL_REASONS.includes(reason)) throw activityError("ACTIVITY_CANCEL_REASON_INVALID", "场次取消原因无效", 400);
  if (reason === "OTHER" && !optionalText(input.reasonDetail || input.reason_detail)) {
    throw activityError("ACTIVITY_CANCEL_REASON_DETAIL_REQUIRED", "OTHER必须填写原因说明", 400);
  }
  const now = normalizedNow(context);
  const claimedActorRef = optionalText(input.operatorId || input.operator_id);
  const trustedPrincipal = context.adminPrincipal && context.adminPrincipal.tokenConfigured === true
    ? context.adminPrincipal
    : null;
  const trustedActorRef = trustedPrincipal ? optionalText(trustedPrincipal.operatorId) : "";
  if (trustedPrincipal && (!trustedActorRef || (claimedActorRef && claimedActorRef !== trustedActorRef))) {
    throw activityError("ACTIVITY_SESSION_ACTOR_UNTRUSTED", "场次取消主体与服务端认证结果不一致", 403);
  }
  const actorRef = assertOpaqueRef(trustedActorRef || claimedActorRef, "operatorId");
  const fromStatus = session.status;
  session.status = "CANCELED";
  session.cancel_reason = reason;
  session.cancel_reason_detail = optionalText(input.reasonDetail || input.reason_detail);
  session.updated_at = now;
  appendSessionEvent(data, session, {
    operation: "SESSION_CANCELED",
    fromStatus,
    reasonCode: reason,
    reasonDetail: input.reasonDetail || input.reason_detail,
    requestId,
    actorRef,
    occurredAt: now,
  });
  ensureCollections(data).enrollments
    .filter((item) => item.activity_session_id === session.activity_session_id && ["PENDING", "CONFIRMED"].includes(item.status))
    .forEach((enrollment) => {
      const eventRequestId = `SESSION_CANCEL:${crypto.createHash("sha256")
        .update(`${requestId}:${enrollment.activity_enrollment_id}`)
        .digest("hex")}`;
      const fromStatus = enrollment.status;
      enrollment.status = "CANCELED";
      enrollment.reason_code = "SESSION_CANCELED";
      enrollment.updated_at = now;
      appendEnrollmentEvent(data, enrollment, {
        operation: "SESSION_CANCEL",
        fromStatus,
        reasonCode: "SESSION_CANCELED",
        requestId: eventRequestId,
        occurredAt: now,
      });
    });
  return toSessionPayload(data, session);
}

function listingState(data, session, now = nowISO()) {
  return listingStateForCount(session, confirmedCount(data, session.activity_session_id), now);
}

function listingStateForCount(session, count, now = nowISO()) {
  if (session.status === "CANCELED") return "CANCELED";
  if (session.status === "ENDED" || compareTime(now, session.session_end_at) >= 0) return "ENDED";
  if (compareTime(now, session.session_start_at) >= 0) return "IN_PROGRESS";
  if (session.status === "CLOSED" || compareTime(now, session.registration_close_at) >= 0) return "REGISTRATION_CLOSED";
  if (compareTime(now, session.registration_open_at) < 0) return "COMING_SOON";
  if (session.status === "OPEN") return count >= session.capacity ? "FULL" : "AVAILABLE";
  return "COMING_SOON";
}

function normalizePublicActivityFilters(query = {}) {
  const city = optionalText(query.city);
  const activityType = optionalText(query.activityType || query.activity_type || query.type);
  const date = optionalText(query.date);
  if (city.length > 64 || activityType.length > 64) {
    throw activityError("ACTIVITY_QUERY_INVALID", "活动筛选长度超限", 400);
  }
  if (date) {
    const parsed = new Date(`${date}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)
      || !Number.isFinite(parsed.getTime())
      || parsed.toISOString().slice(0, 10) !== date) {
      throw activityError("ACTIVITY_QUERY_INVALID", "date必须是有效日期", 400);
    }
  }
  return { city, activityType, date };
}

function visibleActivityRows(data, context = {}) {
  const { definitions, sessions } = ensureCollections(data);
  const now = normalizedNow(context);
  return sessions
    .map((session) => ({ session, definition: definitions.find((item) => item.activity_version_id === session.activity_version_id) }))
    .filter(({ definition }) => definition && definition.status === "PUBLISHED" && definition.source === "OPS_BACKEND")
    .sort((left, right) => {
      const leftHistorical = compareTime(now, left.session.session_end_at) >= 0 || left.session.status === "CANCELED";
      const rightHistorical = compareTime(now, right.session.session_end_at) >= 0 || right.session.status === "CANCELED";
      if (leftHistorical !== rightHistorical) return leftHistorical ? 1 : -1;
      return leftHistorical
        ? right.session.session_start_at.localeCompare(left.session.session_start_at)
        : left.session.session_start_at.localeCompare(right.session.session_start_at);
    });
}

function listVisible(data, query = {}, context = {}, rootUserId = "") {
  const now = normalizedNow(context);
  const { city, activityType, date } = normalizePublicActivityFilters(query);
  return visibleActivityRows(data, context)
    .filter(({ definition }) => !city || definition.city === city)
    .filter(({ definition }) => !activityType || definition.activity_type === activityType)
    .filter(({ session }) => !date || session.session_start_at.slice(0, 10) === date)
    .map(({ definition, session }) => ({
      ...toPublicListingPayload(definition, context),
      session: toSessionPayload(data, session, now),
      enrollment: rootUserId ? toOptionalEnrollmentPayload(enrollmentByUser(data, session.activity_session_id, rootUserId)) : null,
      actions: toUserActivityActions(session, rootUserId
        ? enrollmentByUser(data, session.activity_session_id, rootUserId)
        : null, now),
    }));
}

function toPublicListingPayload(definition, context = {}) {
  return {
    activityVersionId: definition.activity_version_id,
    activityId: definition.activity_id,
    version: definition.version,
    status: definition.status,
    title: definition.title,
    summary: definition.summary,
    city: definition.city,
    venueSummary: definition.venue_summary,
    activityType: definition.activity_type,
    heroAssetUrl: resolvePublicHeroAssetUrl(definition, context),
    visibility: definition.visibility,
    memberRequirement: definition.member_requirement || "",
  };
}

function toOptionalEnrollmentPayload(enrollment) {
  return enrollment ? toEnrollmentPayload(enrollment) : null;
}

function listVisiblePage(data, query = {}, context = {}, rootUserId = "") {
  const result = paginatePublicItems(listVisible(data, query, context, rootUserId), query);
  const rows = visibleActivityRows(data, context);
  return {
    ...result,
    filters: {
      cities: [...new Set(rows.map(({ definition }) => definition.city))].sort(),
      activityTypes: [...new Set(rows.map(({ definition }) => definition.activity_type))].sort(),
      dates: [...new Set(rows.map(({ session }) => session.session_start_at.slice(0, 10)))].sort(),
    },
  };
}

function adminProjectionError(message) {
  return activityError("ACTIVITY_ADMIN_PROJECTION_INVALID", message, 500);
}

function buildAdminProjectionIndex(data) {
  const collections = ensureCollections(data);
  const definitionsByVersion = new Map(collections.definitions.map((definition) => (
    [definition.activity_version_id, definition]
  )));
  const sessionsById = new Map(collections.sessions.map((session) => (
    [session.activity_session_id, session]
  )));
  const confirmedBySession = new Map();
  collections.enrollments.forEach((enrollment) => {
    if (enrollment.status !== "CONFIRMED") return;
    const current = confirmedBySession.get(enrollment.activity_session_id) || 0;
    confirmedBySession.set(enrollment.activity_session_id, current + 1);
  });
  return { ...collections, definitionsByVersion, sessionsById, confirmedBySession };
}

function definitionForAdminProjection(index, activityVersionId) {
  const definition = index.definitionsByVersion.get(activityVersionId);
  if (!definition) {
    throw adminProjectionError("活动场次关联的活动版本不存在");
  }
  return definition;
}

function sessionForAdminProjection(index, sessionId) {
  const session = index.sessionsById.get(sessionId);
  if (!session) {
    throw adminProjectionError("报名记录关联的活动场次不存在");
  }
  return session;
}

function toAdminDefinitionPayload(definition) {
  return {
    activityVersionId: definition.activity_version_id,
    activityId: definition.activity_id,
    version: definition.version,
    status: definition.status,
    title: definition.title,
    summary: definition.summary,
    objective: definition.objective,
    audience: definition.audience,
    agenda: definition.agenda,
    organizer: definition.organizer,
    feeDescription: definition.fee_description,
    bringItems: definition.bring_items,
    cancelPolicy: definition.cancel_policy,
    privacyNoticeText: definition.privacy_notice_text,
    photographyNoticeText: definition.photography_notice_text,
    contactDisplay: definition.contact_display,
    detailVersion: definition.detail_version,
    city: definition.city,
    venueSummary: definition.venue_summary,
    activityType: definition.activity_type,
    heroAssetRef: definition.hero_asset_ref,
    privacyNoticeRef: definition.privacy_notice_ref,
    photographyNoticeRef: definition.photography_notice_ref,
    contentApprovalRef: definition.content_approval_ref,
    contactOwnerSignerRef: definition.contact_owner_signer_ref,
    visibility: definition.visibility,
    memberRequirement: definition.member_requirement || "",
    preboundTaskDefinitionId: definition.prebound_task_definition_id || "",
    preboundTaskDefinitionVersion: definition.prebound_task_definition_version || "",
    source: definition.source,
    createdAt: definition.created_at,
    updatedAt: definition.updated_at,
    publishedAt: definition.published_at || null,
  };
}

function toAdminSessionPayload(index, session, now) {
  const definition = definitionForAdminProjection(index, session.activity_version_id);
  const count = index.confirmedBySession.get(session.activity_session_id) || 0;
  return {
    sessionId: session.activity_session_id,
    activityVersionId: session.activity_version_id,
    activityId: definition.activity_id,
    activityTitle: definition.title,
    city: definition.city,
    status: session.status,
    approvalMode: session.approval_mode,
    capacity: session.capacity,
    confirmedCount: count,
    remainingCapacity: Math.max(0, session.capacity - count),
    capacityState: count >= session.capacity ? "FULL" : "AVAILABLE",
    listingState: listingStateForCount(session, count, now),
    registrationOpenAt: session.registration_open_at,
    registrationCloseAt: session.registration_close_at,
    cancelCloseAt: session.cancel_close_at,
    reviewDeadline: session.review_deadline || null,
    sessionStartAt: session.session_start_at,
    sessionEndAt: session.session_end_at,
    allowReapply: session.allow_reapply === true,
    cancelReason: session.cancel_reason || "",
    createdAt: session.created_at,
    updatedAt: session.updated_at,
  };
}

function adminReviewState(session, now) {
  if (["CANCELED", "ENDED"].includes(session.status) || !session.review_deadline) {
    return "SESSION_UNAVAILABLE";
  }
  if (compareTime(now, session.review_deadline) >= 0) return "DEADLINE_PASSED";
  return "READY";
}

function toAdminEnrollmentPayload(index, enrollment, now) {
  const session = sessionForAdminProjection(index, enrollment.activity_session_id);
  const sessionPayload = toAdminSessionPayload(index, session, now);
  return {
    enrollmentId: enrollment.activity_enrollment_id,
    sessionId: enrollment.activity_session_id,
    activityVersionId: sessionPayload.activityVersionId,
    activityId: sessionPayload.activityId,
    activityTitle: sessionPayload.activityTitle,
    city: sessionPayload.city,
    rootUserId: enrollment.root_user_id,
    status: enrollment.status,
    reasonCode: enrollment.reason_code || "",
    attemptGeneration: enrollment.attempt_generation,
    approvalMode: sessionPayload.approvalMode,
    capacity: sessionPayload.capacity,
    confirmedCount: sessionPayload.confirmedCount,
    remainingCapacity: sessionPayload.remainingCapacity,
    capacityState: sessionPayload.capacityState,
    reviewDeadline: sessionPayload.reviewDeadline,
    reviewState: adminReviewState(session, now),
    sessionStartAt: sessionPayload.sessionStartAt,
    createdAt: enrollment.created_at,
    updatedAt: enrollment.updated_at,
  };
}

function listAdminDefinitions(data, query = {}) {
  const index = buildAdminProjectionIndex(data);
  const status = adminQueryEnum(query.status, DEFINITION_STATES, "status");
  const activityId = adminQueryText(query.activityId || query.activity_id, "activityId");
  const city = adminQueryText(query.city, "city", 80);
  const activityType = adminQueryText(
    query.activityType || query.activity_type || query.type,
    "activityType",
    80
  ).toUpperCase();
  const search = adminQueryText(query.search, "search").toLowerCase();
  const items = index.definitions
    .filter((definition) => !status || definition.status === status)
    .filter((definition) => !activityId || definition.activity_id === activityId)
    .filter((definition) => !city || definition.city === city)
    .filter((definition) => !activityType || optionalText(definition.activity_type).toUpperCase() === activityType)
    .filter((definition) => {
      if (!search) return true;
      return [definition.activity_id, definition.title, definition.summary]
        .some((value) => optionalText(value).toLowerCase().includes(search));
    })
    .sort((left, right) => (
      descendingInstant(left, right, "updated_at")
      || optionalText(left.activity_version_id).localeCompare(optionalText(right.activity_version_id))
    ))
    .map(toAdminDefinitionPayload);
  return paginateAdminItems(items, query);
}

function listAdminSessions(data, query = {}, context = {}) {
  const index = buildAdminProjectionIndex(data);
  const now = normalizedNow(context);
  const status = adminQueryEnum(query.status, SESSION_STATES, "status");
  const approvalMode = adminQueryEnum(
    query.approvalMode || query.approval_mode,
    APPROVAL_MODES,
    "approvalMode"
  );
  const activityVersionId = adminQueryText(
    query.activityVersionId || query.activity_version_id,
    "activityVersionId"
  );
  const activityId = adminQueryText(query.activityId || query.activity_id, "activityId");
  const city = adminQueryText(query.city, "city", 80);
  const items = index.sessions
    .map((session) => ({ session, definition: definitionForAdminProjection(index, session.activity_version_id) }))
    .filter(({ session }) => !status || session.status === status)
    .filter(({ session }) => !approvalMode || session.approval_mode === approvalMode)
    .filter(({ session }) => !activityVersionId || session.activity_version_id === activityVersionId)
    .filter(({ definition }) => !activityId || definition.activity_id === activityId)
    .filter(({ definition }) => !city || definition.city === city)
    .sort((left, right) => (
      optionalText(left.session.session_start_at).localeCompare(optionalText(right.session.session_start_at))
      || optionalText(left.session.activity_session_id).localeCompare(optionalText(right.session.activity_session_id))
    ))
    .map(({ session }) => toAdminSessionPayload(index, session, now));
  return paginateAdminItems(items, query);
}

function adminEnrollmentItems(data, query = {}, context = {}) {
  const index = buildAdminProjectionIndex(data);
  const now = normalizedNow(context);
  const status = adminQueryEnum(query.status, ENROLLMENT_STATES, "status");
  const sessionId = adminQueryText(query.sessionId || query.session_id, "sessionId");
  const activityId = adminQueryText(query.activityId || query.activity_id, "activityId");
  const rootUserId = adminQueryText(query.rootUserId || query.root_user_id, "rootUserId");
  const attemptGeneration = adminQueryInteger(
    firstAdminQueryValue(query.attemptGeneration, query.attempt_generation),
    "attemptGeneration",
    null
  );
  return index.enrollments
    .filter((enrollment) => !status || enrollment.status === status)
    .filter((enrollment) => !sessionId || enrollment.activity_session_id === sessionId)
    .filter((enrollment) => !rootUserId || enrollment.root_user_id === rootUserId)
    .map((enrollment) => toAdminEnrollmentPayload(index, enrollment, now))
    .filter((enrollment) => !activityId || enrollment.activityId === activityId)
    .filter((enrollment) => !attemptGeneration || enrollment.attemptGeneration === attemptGeneration)
    .sort((left, right) => (
      optionalText(right.updatedAt).localeCompare(optionalText(left.updatedAt))
      || optionalText(left.enrollmentId).localeCompare(optionalText(right.enrollmentId))
    ));
}

function listAdminEnrollments(data, query = {}, context = {}) {
  return paginateAdminItems(adminEnrollmentItems(data, query, context), query);
}

function listAdminReviewQueue(data, query = {}, context = {}) {
  const city = adminQueryText(query.city, "city", 80);
  const reviewState = adminQueryEnum(
    query.reviewState || query.review_state,
    ["READY", "DEADLINE_PASSED", "SESSION_UNAVAILABLE"],
    "reviewState"
  );
  const items = adminEnrollmentItems(data, { ...query, status: "PENDING" }, context)
    .filter((enrollment) => enrollment.approvalMode === "MANUAL")
    .filter((enrollment) => !city || enrollment.city === city)
    .filter((enrollment) => !reviewState || enrollment.reviewState === reviewState)
    .sort((left, right) => (
      optionalText(left.reviewDeadline).localeCompare(optionalText(right.reviewDeadline))
      || optionalText(left.updatedAt).localeCompare(optionalText(right.updatedAt))
      || optionalText(left.enrollmentId).localeCompare(optionalText(right.enrollmentId))
    ));
  return paginateAdminItems(items, query);
}

function resolveDetailSession(data, input, context = {}) {
  if (typeof input === "string") return sessionById(data, requiredText(input, "sessionId"));
  const query = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const sessionId = optionalText(query.sessionId || query.session_id);
  if (sessionId) return sessionById(data, sessionId);
  const activityId = requiredText(query.activityId || query.activity_id, "activityId");
  const { definitions, sessions } = ensureCollections(data);
  const versionIds = new Set(definitions
    .filter((item) => item.activity_id === activityId && item.status === "PUBLISHED" && item.source === "OPS_BACKEND")
    .map((item) => item.activity_version_id));
  const now = normalizedNow(context);
  const candidates = sessions.filter((item) => versionIds.has(item.activity_version_id));
  const current = candidates
    .filter((item) => item.status !== "CANCELED"
      && compareTime(now, item.session_start_at) >= 0
      && compareTime(now, item.session_end_at) < 0)
    .sort((left, right) => left.session_start_at.localeCompare(right.session_start_at))[0];
  if (current) return current;
  const next = candidates
    .filter((item) => item.status !== "CANCELED" && compareTime(now, item.session_start_at) < 0)
    .sort((left, right) => left.session_start_at.localeCompare(right.session_start_at))[0];
  if (next) return next;
  return candidates
    .sort((left, right) => right.session_start_at.localeCompare(left.session_start_at))[0] || null;
}

function toUserActivityActions(session, enrollment, now) {
  if (!enrollment || !["PENDING", "CONFIRMED"].includes(enrollment.status)) {
    return { cancelAllowed: false, cancelReasonCode: "NO_ACTIVE_ENROLLMENT" };
  }
  if (compareTime(now, session.cancel_close_at) >= 0) {
    return { cancelAllowed: false, cancelReasonCode: "CUTOFF_PASSED" };
  }
  return { cancelAllowed: true, cancelReasonCode: "" };
}

function projectDetail(data, session, rootUserId, context, options = {}) {
  const definition = session && definitionByVersion(data, session.activity_version_id);
  const allowedStatus = options.allowHistorical === true
    ? DEFINITION_STATES.includes(definition && definition.status)
    : definition && definition.status === "PUBLISHED";
  if (!session || !definition || !allowedStatus || definition.source !== "OPS_BACKEND") {
    throw activityError("ACTIVITY_NOT_FOUND", "活动不存在或未发布", 404);
  }
  const enrollment = rootUserId ? enrollmentByUser(data, session.activity_session_id, rootUserId) : null;
  const now = normalizedNow(context);
  return {
    ...toDefinitionPayload(definition, context),
    session: toSessionPayload(data, session, now),
    enrollment: enrollment ? toEnrollmentPayload(enrollment) : null,
    actions: toUserActivityActions(session, enrollment, now),
  };
}

function getDetail(data, input, rootUserId = "", context = {}) {
  return projectDetail(data, resolveDetailSession(data, input, context), rootUserId, context);
}

function getMyEnrollments(data, rootUserId, query = {}, context = {}) {
  const userId = requiredText(rootUserId, "rootUserId");
  const status = optionalText(query.status).toUpperCase();
  if (status && !ENROLLMENT_STATES.includes(status)) throw activityError("ACTIVITY_INPUT_INVALID", "status无效", 400);
  const now = normalizedNow(context);
  return ensureCollections(data).enrollments
    .filter((item) => item.root_user_id === userId && (!status || item.status === status))
    .map((enrollment) => ({
      enrollment: toEnrollmentPayload(enrollment),
      activity: projectDetail(
        data,
        sessionById(data, enrollment.activity_session_id),
        userId,
        context,
        { allowHistorical: true }
      ),
    }))
    .sort((left, right) => {
      const leftSession = left.activity.session;
      const rightSession = right.activity.session;
      const leftCanceled = left.enrollment.status === "CANCELED" || leftSession.status === "CANCELED";
      const rightCanceled = right.enrollment.status === "CANCELED" || rightSession.status === "CANCELED";
      const leftHistorical = compareTime(now, leftSession.sessionEndAt) >= 0 || leftCanceled;
      const rightHistorical = compareTime(now, rightSession.sessionEndAt) >= 0 || rightCanceled;
      if (leftHistorical !== rightHistorical) return leftHistorical ? 1 : -1;
      if (leftCanceled !== rightCanceled) return leftCanceled ? 1 : -1;
      return leftHistorical
        ? rightSession.sessionStartAt.localeCompare(leftSession.sessionStartAt)
        : leftSession.sessionStartAt.localeCompare(rightSession.sessionStartAt);
    });
}

function getMyEnrollmentsPage(data, rootUserId, query = {}, context = {}) {
  return paginatePublicItems(getMyEnrollments(data, rootUserId, query, context), query);
}

function resolvePublicHeroAssetUrl(definition, context = {}) {
  const adapter = context.activityAssetAdapter;
  if (!adapter || typeof adapter.resolvePublicAsset !== "function") return "";
  let result;
  try {
    result = adapter.resolvePublicAsset({
      assetRef: definition.hero_asset_ref,
      purpose: "ACTIVITY_HERO",
      activityVersionId: definition.activity_version_id,
    });
  } catch (_) {
    return "";
  }
  if (result && typeof result.then === "function") return "";
  const url = optionalText(typeof result === "string" ? result : result && result.url);
  return /^https:\/\/[^\s]{1,1016}$/.test(url) ? url : "";
}

function toDefinitionPayload(definition, context = {}) {
  return {
    activityVersionId: definition.activity_version_id,
    activityId: definition.activity_id,
    version: definition.version,
    status: definition.status,
    title: definition.title,
    summary: definition.summary,
    objective: definition.objective,
    audience: definition.audience,
    agenda: definition.agenda,
    organizer: definition.organizer,
    feeDescription: definition.fee_description,
    bringItems: definition.bring_items,
    cancelPolicy: definition.cancel_policy,
    privacyNoticeText: definition.privacy_notice_text,
    photographyNoticeText: definition.photography_notice_text,
    contactDisplay: definition.contact_display,
    detailVersion: definition.detail_version,
    city: definition.city,
    venueSummary: definition.venue_summary,
    activityType: definition.activity_type,
    heroAssetRef: definition.hero_asset_ref,
    heroAssetUrl: resolvePublicHeroAssetUrl(definition, context),
    privacyNoticeRef: definition.privacy_notice_ref,
    photographyNoticeRef: definition.photography_notice_ref,
    visibility: definition.visibility,
    memberRequirement: definition.member_requirement || "",
    preboundTaskDefinitionId: definition.prebound_task_definition_id || "",
    preboundTaskDefinitionVersion: definition.prebound_task_definition_version || "",
  };
}

function toSessionPayload(data, session, now = nowISO()) {
  const count = confirmedCount(data, session.activity_session_id);
  return {
    sessionId: session.activity_session_id,
    activityVersionId: session.activity_version_id,
    status: session.status,
    approvalMode: session.approval_mode,
    capacity: session.capacity,
    confirmedCount: count,
    remainingCapacity: Math.max(0, session.capacity - count),
    capacityState: count >= session.capacity ? "FULL" : "AVAILABLE",
    listingState: listingState(data, session, now),
    registrationOpenAt: session.registration_open_at,
    registrationCloseAt: session.registration_close_at,
    cancelCloseAt: session.cancel_close_at,
    reviewDeadline: session.review_deadline,
    sessionStartAt: session.session_start_at,
    sessionEndAt: session.session_end_at,
    allowReapply: session.allow_reapply === true,
    cancelReason: session.cancel_reason || "",
  };
}

function toEnrollmentPayload(enrollment) {
  return {
    enrollmentId: enrollment.activity_enrollment_id,
    sessionId: enrollment.activity_session_id,
    status: enrollment.status,
    reasonCode: enrollment.reason_code || "",
    attemptGeneration: enrollment.attempt_generation,
    createdAt: enrollment.created_at,
    updatedAt: enrollment.updated_at,
  };
}

module.exports = Object.freeze({
  APPROVAL_MODES,
  DEFINITION_STATES,
  ENROLLMENT_REASONS,
  ENROLLMENT_STATES,
  SESSION_CANCEL_REASONS,
  SESSION_STATES,
  archive,
  cancelEnrollment,
  cancelSession,
  confirmedCount,
  createSession,
  enroll,
  ensureCollections,
  expirePendingReviews,
  getDetail,
  getMyEnrollments,
  getMyEnrollmentsPage,
  listAdminDefinitions,
  listAdminEnrollments,
  listAdminReviewQueue,
  listAdminSessions,
  listVisible,
  listVisiblePage,
  listingState,
  publish,
  requestChanges,
  reviewEnrollment,
  setSessionState,
  submitForReview,
  unpublish,
  upsertDraft,
});
