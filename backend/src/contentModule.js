const crypto = require("node:crypto");

const { createClientError } = require("./clientError");
const { nowISO } = require("./dates");
const { createId } = require("./seed");

const TYPES = Object.freeze({
  WELCOME: "WELCOME",
  HOME: "HOME_CAROUSEL",
  DETAIL: "SHARED_DETAIL",
});
const FORMAL_INTERNAL_PATHS = new Set([
  "/pages/home/index",
  "/pages/health/index",
  "/pages/activities/index",
  "/pages/profile/index",
  "/subpkg/activity/pages/detail/index",
  "/subpkg/profile/pages/about/index",
  "/subpkg/profile/pages/support/index",
  "/subpkg/content/pages/detail/index",
]);
const ACTION_TYPES = new Set(["MINIPROGRAM_PAGE", "ROOT_MEMBER_CENTER", "BUSINESS_WEBVIEW"]);
const ADMIN_TARGET_TYPES = new Set(["MINIPROGRAM_PAGE", "ROOT_MEMBER_CENTER", "WEBVIEW_ALLOWLIST"]);
const ASSET_SCOPES = new Set(["welcome-1", "welcome-2", "home-carousel", "shared-detail", "activity-hero", "content"]);
const IMAGE_TYPES = new Set(["image/jpeg", "image/png"]);
const ROOT_MEMBER_CENTER_SHORT_LINK = /^#小程序:\/\/ROOT会员中心\/[A-Za-z0-9_-]{4,80}$/;

function contentError(code, message, status = 400, details = undefined) {
  const error = createClientError(code, message, status);
  if (details) error.details = details;
  return error;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function versionRows(data) {
  if (!Array.isArray(data.contentVersions)) data.contentVersions = [];
  return data.contentVersions;
}

function assetRows(data) {
  if (!Array.isArray(data.contentAssets)) data.contentAssets = [];
  return data.contentAssets;
}

function publicationRows(data) {
  if (!Array.isArray(data.contentPublicationRecords)) data.contentPublicationRecords = [];
  return data.contentPublicationRecords;
}

function previewRows(data) {
  if (!Array.isArray(data.contentPreviewRecords)) data.contentPreviewRecords = [];
  return data.contentPreviewRecords;
}

function legacyRows(data) {
  return Array.isArray(data && data.formalContentItems) ? data.formalContentItems : [];
}

function instant(context = {}) {
  const value = context.now || nowISO();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw contentError("CONTENT_TIME_INVALID", "时间格式无效");
  return date.toISOString();
}

function optionalInstant(value, field) {
  const text = String(value || "").trim();
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw contentError("CONTENT_INPUT_INVALID", `${field}格式无效`);
  return date.toISOString();
}

function requiredText(value, field, maximum) {
  const text = String(value || "").trim();
  if (!text) throw contentError("CONTENT_INPUT_INVALID", `${field}不能为空`);
  if (text.length > maximum) throw contentError("CONTENT_INPUT_INVALID", `${field}长度超限`);
  return text;
}

function optionalText(value, field, maximum) {
  const text = String(value || "").trim();
  if (text.length > maximum) throw contentError("CONTENT_INPUT_INVALID", `${field}长度超限`);
  return text;
}

function safeId(value) {
  const id = String(value || "").trim();
  return /^[A-Za-z0-9_-]{3,80}$/.test(id) ? id : "";
}

function safeHttpsOrCloudUrl(value) {
  const url = String(value || "").trim();
  return /^(https:\/\/|cloud:\/\/)/i.test(url) && url.length <= 1024 ? url : "";
}

function safeText(value, maxLength) {
  const text = String(value || "").trim();
  return text && text.length <= maxLength ? text : "";
}

function pageQuery(query = {}) {
  const page = Number(query.page || 1);
  const pageSize = Number(query.pageSize || query.page_size || 20);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) {
    throw contentError("CONTENT_QUERY_INVALID", "分页参数无效");
  }
  const keyword = String(query.keyword || query.search || "").trim().toLowerCase();
  if (keyword.length > 120) throw contentError("CONTENT_QUERY_INVALID", "搜索内容过长");
  return { page, pageSize, keyword };
}

function paginate(items, query = {}) {
  const { page, pageSize } = pageQuery(query);
  return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize };
}

function allowedBusinessHosts(env = {}) {
  try {
    const parsed = JSON.parse(env.ROOT_CONTENT_WEBVIEW_HOSTS || "[]");
    return new Set((Array.isArray(parsed) ? parsed : []).map((host) => String(host || "").trim().toLowerCase()).filter(Boolean));
  } catch (error) {
    return new Set();
  }
}

function normalizeAction(value, env = {}) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || !ACTION_TYPES.has(value.type)) return undefined;
  if (value.type === "MINIPROGRAM_PAGE") {
    const path = String(value.path || "").trim();
    const pathOnly = path.split("?")[0];
    return FORMAL_INTERNAL_PATHS.has(pathOnly) ? { type: value.type, path } : undefined;
  }
  if (value.type === "ROOT_MEMBER_CENTER") {
    const shortLink = String(value.shortLink || value.short_link || value.path || "").trim();
    if (ROOT_MEMBER_CENTER_SHORT_LINK.test(shortLink)) {
      return { type: value.type, shortLink };
    }
    const configuredAppId = String(env.ROOT_MEMBER_CENTER_APPID || "").trim();
    const appId = String(value.appId || "").trim();
    const path = String(value.path || "").trim();
    if (!configuredAppId || appId !== configuredAppId || !/^pages\/[A-Za-z0-9_/?=&.-]{1,240}$/.test(path)) return undefined;
    return { type: value.type, appId, path };
  }
  try {
    const url = new URL(String(value.url || ""));
    if (url.protocol !== "https:" || !allowedBusinessHosts(env).has(url.hostname.toLowerCase())) return undefined;
    return { type: value.type, url: url.toString() };
  } catch (error) {
    return undefined;
  }
}

function validateTarget(input = {}, context = {}) {
  const targetType = String(input.targetType || input.target_type || "").trim();
  const target = String(input.target || "").trim();
  if (!ADMIN_TARGET_TYPES.has(targetType) || !target || target.length > 1024) {
    throw contentError("CONTENT_TARGET_INVALID", "跳转目标格式无效");
  }
  let action;
  let message;
  if (targetType === "MINIPROGRAM_PAGE") {
    action = normalizeAction({ type: "MINIPROGRAM_PAGE", path: target }, context.env || {});
    message = "小程序路径检查通过";
  } else if (targetType === "ROOT_MEMBER_CENTER") {
    action = normalizeAction({
      type: "ROOT_MEMBER_CENTER",
      appId: String((context.env || {}).ROOT_MEMBER_CENTER_APPID || "").trim(),
      path: target,
      shortLink: target,
    }, context.env || {});
    message = action && action.shortLink ? "Root 会员中心短链接检查通过" : "Root 会员中心固定路径检查通过";
  } else {
    action = normalizeAction({ type: "BUSINESS_WEBVIEW", url: target }, context.env || {});
    message = "白名单网页检查通过";
  }
  if (!action) throw contentError("CONTENT_TARGET_INVALID", "跳转目标不在已批准路径或域名白名单内");
  return { status: "PASS", message, action };
}

function inspectPng(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature)) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function inspectJpeg(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 8 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    if (!Number.isInteger(length) || length < 2) return null;
    offset += length + 2;
  }
  return null;
}

function prepareAssetUpload(input = {}, context = {}) {
  const scope = String(input.scope || "content").trim();
  const name = requiredText(input.name || input.fileName, "文件名", 120);
  const mimeType = String(input.mimeType || input.mime_type || "").trim().toLowerCase();
  if (!ASSET_SCOPES.has(scope) || !IMAGE_TYPES.has(mimeType)) {
    throw contentError("CONTENT_ASSET_INVALID", "仅支持已批准范围内的 JPG 或 PNG 图片");
  }
  const dataBase64 = String(input.dataBase64 || input.data_base64 || "").replace(/^data:image\/(?:png|jpeg);base64,/i, "");
  if (!/^[A-Za-z0-9+/=]+$/.test(dataBase64)) throw contentError("CONTENT_ASSET_INVALID", "图片数据格式无效");
  const buffer = Buffer.from(dataBase64, "base64");
  if (!buffer.length || buffer.length > 600 * 1024) throw contentError("CONTENT_ASSET_TOO_LARGE", "图片超过 600KB 硬上限", 413);
  const dimensions = mimeType === "image/png" ? inspectPng(buffer) : inspectJpeg(buffer);
  if (!dimensions || dimensions.width < 1 || dimensions.height < 1) throw contentError("CONTENT_ASSET_INVALID", "图片文件损坏或格式与声明不一致");
  const assetId = createId("content_asset");
  const createdAt = instant(context);
  const extension = mimeType === "image/png" ? "png" : "jpg";
  const datePath = createdAt.slice(0, 10).replace(/-/g, "/");
  return {
    assetId,
    buffer,
    objectKey: `content-assets/${datePath}/${assetId}.${extension}`,
    record: {
      content_asset_id: assetId,
      scope,
      name,
      mime_type: mimeType,
      byte_size: buffer.length,
      width: dimensions.width,
      height: dimensions.height,
      state: "AUTHORIZED",
      created_at: createdAt,
      created_by: context.operatorId || "",
    },
  };
}

function recordUploadedAsset(data, prepared, uploadResult = {}) {
  const externalRef = safeHttpsOrCloudUrl(uploadResult.externalRef || uploadResult.fileId);
  if (!prepared || !prepared.record || !externalRef) {
    throw contentError("CONTENT_ASSET_STORAGE_FAILED", "图片存储未返回可用地址", 503);
  }
  const asset = {
    ...prepared.record,
    storage_provider: String(uploadResult.provider || "CLOUDBASE").toUpperCase(),
    storage_object_key: prepared.objectKey,
    storage_external_ref: externalRef,
  };
  assetRows(data).push(asset);
  return { asset: presentAsset(asset) };
}

function presentAsset(asset) {
  return {
    assetId: asset.content_asset_id,
    name: asset.name,
    mimeType: asset.mime_type,
    byteSize: asset.byte_size,
    width: asset.width,
    height: asset.height,
    dimensions: `${asset.width} × ${asset.height}`,
    assetMeta: `${asset.width} × ${asset.height} · ${Math.ceil(asset.byte_size / 1024)}KB`,
    previewUrl: safeHttpsOrCloudUrl(asset.storage_external_ref)
      || `/api/v1/public/content/assets/${asset.content_asset_id}`,
    state: asset.state,
  };
}

function getAsset(data, assetId) {
  const id = safeId(assetId);
  const asset = assetRows(data).find((row) => row.content_asset_id === id && row.state === "AUTHORIZED");
  if (!asset) throw contentError("CONTENT_ASSET_NOT_FOUND", "图片不存在", 404);
  if (!asset.data_base64) throw contentError("CONTENT_ASSET_MOVED", "图片已迁移至对象存储", 404);
  return { mimeType: asset.mime_type, body: Buffer.from(asset.data_base64, "base64"), etag: `"${asset.content_asset_id}"` };
}

function assetById(data, assetId) {
  return assetRows(data).find((asset) => asset.content_asset_id === assetId && asset.state === "AUTHORIZED") || null;
}

function nextVersion(data, logicalId) {
  return versionRows(data).filter((row) => row.logicalId === logicalId).reduce((max, row) => Math.max(max, Number(row.version || 0)), 0) + 1;
}

function newVersion(data, type, logicalId, content, input, context) {
  const createdAt = instant(context);
  const version = {
    content_version_id: createId("content_version"),
    versionId: "",
    logicalId,
    type,
    version: nextVersion(data, logicalId),
    revision: 1,
    status: "DRAFT",
    sourceVersionId: String(input.sourceVersionId || input.source_version_id || "").trim(),
    content: clone(content),
    validation: { status: "PENDING", issues: [] },
    createdAt,
    updatedAt: createdAt,
    createdBy: context.operatorId || "",
    updatedBy: context.operatorId || "",
  };
  version.versionId = version.content_version_id;
  versionRows(data).push(version);
  return version;
}

function editableDraft(data, type, input = {}) {
  const id = String(input.id || input.versionId || input.version_id || "").trim();
  if (!id) return null;
  const version = versionRows(data).find((row) => row.versionId === id && row.type === type);
  if (!version) throw contentError("CONTENT_VERSION_NOT_FOUND", "内容版本不存在", 404);
  if (version.status !== "DRAFT") throw contentError("CONTENT_PUBLISHED_IMMUTABLE", "已发布内容不可原地修改");
  const expectedRevision = Number(input.expectedRevision);
  if (!Number.isInteger(expectedRevision) || expectedRevision !== version.revision) {
    throw contentError("CONTENT_REVISION_CONFLICT", "内容已被其他运营更新，请刷新后重试", 409);
  }
  return version;
}

function updateDraft(version, content, context) {
  version.content = clone(content);
  version.revision += 1;
  version.updatedAt = instant(context);
  version.updatedBy = context.operatorId || "";
  version.validation = { status: "PENDING", issues: [] };
  return version;
}

function currentPublished(data, type, logicalId) {
  return versionRows(data)
    .filter((row) => row.type === type && row.logicalId === logicalId && row.status === "PUBLISHED")
    .sort((left, right) => Number(right.version || 0) - Number(left.version || 0))[0] || null;
}

function draftForLogical(data, type, logicalId) {
  return versionRows(data).find((row) => row.type === type && row.logicalId === logicalId && row.status === "DRAFT") || null;
}

function saveWelcomeDraft(data, input = {}, context = {}) {
  const slot = Number(input.slot);
  if (![1, 2].includes(slot)) throw contentError("CONTENT_INPUT_INVALID", "欢迎页固定为第 1 或第 2 屏");
  const logicalId = `WELCOME_SLOT_${slot}`;
  const content = {
    slot,
    copy: requiredText(input.copy, "欢迎页文案", 500),
    assetId: requiredText(input.assetId || input.asset_id, "背景图", 80),
  };
  const selectedDraft = editableDraft(data, TYPES.WELCOME, input);
  const unselectedDraft = selectedDraft ? null : draftForLogical(data, TYPES.WELCOME, logicalId);
  if (unselectedDraft) throw contentError("CONTENT_REVISION_CONFLICT", "已有欢迎页草稿，请刷新后重试", 409);
  const existing = selectedDraft;
  const source = currentPublished(data, TYPES.WELCOME, logicalId);
  const version = existing
    ? updateDraft(existing, content, context)
    : newVersion(data, TYPES.WELCOME, logicalId, content, { ...input, sourceVersionId: input.sourceVersionId || (source && source.versionId) }, context);
  return { version: presentVersion(data, version) };
}

function splitCopy(copy, lineCount) {
  const raw = requiredText(copy, "展示文案", 72);
  const lines = raw.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === lineCount) return lines;
  if (!raw.includes("\n")) {
    const size = Math.ceil(raw.length / lineCount);
    const inferred = Array.from({ length: lineCount }, (_, index) => raw.slice(index * size, (index + 1) * size)).filter(Boolean);
    if (inferred.length === lineCount) return inferred;
  }
  throw contentError("CONTENT_INPUT_INVALID", `展示文案必须明确分为 ${lineCount} 行`);
}

function saveHomeCarouselDraft(data, input = {}, context = {}) {
  const draft = editableDraft(data, TYPES.HOME, input);
  const sourceId = String(input.sourceVersionId || input.source_version_id || "").trim();
  const source = sourceId ? versionRows(data).find((row) => row.versionId === sourceId && row.type === TYPES.HOME) : null;
  if (sourceId && !source) throw contentError("CONTENT_VERSION_NOT_FOUND", "来源轮播版本不存在", 404);
  const logicalId = draft ? draft.logicalId : source ? source.logicalId : createId("HOME_CAROUSEL").toUpperCase();
  const lineCount = Number(input.lineCount || input.line_count || 2);
  if (![2, 3].includes(lineCount)) throw contentError("CONTENT_INPUT_INVALID", "展示文案只支持 2 行或 3 行");
  const scheduleRange = Array.isArray(input.scheduleRange) ? input.scheduleRange : [];
  const startsAt = optionalInstant(scheduleRange[0] || input.startsAt, "上线时间");
  const endsAt = optionalInstant(scheduleRange[1] || input.endsAt, "下线时间");
  if (startsAt && endsAt && Date.parse(startsAt) >= Date.parse(endsAt)) throw contentError("CONTENT_INPUT_INVALID", "下线时间必须晚于上线时间");
  const content = {
    order: Math.max(1, Math.min(999, Number(input.order || 1))),
    internalName: requiredText(input.internalName, "内部名称", 40),
    kicker: requiredText(input.kicker || (source && source.content.kicker) || "ROOT FOUNDATION", "英文眉题", 40),
    copy: requiredText(input.copy, "展示文案", 72),
    lines: splitCopy(input.copy, lineCount),
    assetId: requiredText(input.assetId, "背景图", 80),
    lineCount,
    fontSize: ["MEDIUM", "LARGE"].includes(input.fontSize) ? input.fontSize : "LARGE",
    alignment: input.alignment === "CENTER" ? "CENTER" : "CENTER",
    sharedDetailVersionId: requiredText(input.sharedDetailVersionId, "关联共用详情", 80),
    startsAt,
    endsAt,
  };
  const version = draft
    ? updateDraft(draft, content, context)
    : newVersion(data, TYPES.HOME, logicalId, content, { ...input, sourceVersionId: sourceId }, context);
  return { version: presentVersion(data, version) };
}

function normalizeHotspot(hotspot, context) {
  const numeric = (value, field) => {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || number > 100) throw contentError("CONTENT_INPUT_INVALID", `${field}必须在 0–100 之间`);
    return Math.round(number * 100) / 100;
  };
  const x = numeric(hotspot.x, "热点 X");
  const y = numeric(hotspot.y, "热点 Y");
  const width = numeric(hotspot.width, "热点宽度");
  const height = numeric(hotspot.height, "热点高度");
  if (width < 4 || height < 4 || x + width > 100 || y + height > 100) throw contentError("CONTENT_INPUT_INVALID", "热点区域超出图片或过小");
  const checked = validateTarget(hotspot, context);
  return {
    id: safeId(hotspot.id) || createId("hotspot"),
    x,
    y,
    width,
    height,
    targetType: hotspot.targetType,
    target: String(hotspot.target || "").trim(),
    action: checked.action,
  };
}

function saveSharedDetailDraft(data, input = {}, context = {}) {
  const draft = editableDraft(data, TYPES.DETAIL, input);
  const sourceId = String(input.sourceVersionId || input.source_version_id || "").trim();
  const source = sourceId ? versionRows(data).find((row) => row.versionId === sourceId && row.type === TYPES.DETAIL) : null;
  if (sourceId && !source) throw contentError("CONTENT_VERSION_NOT_FOUND", "来源详情版本不存在", 404);
  const logicalId = draft ? draft.logicalId : source ? source.logicalId : createId("SHARED_DETAIL").toUpperCase();
  if (!Array.isArray(input.assets) || input.assets.length < 1 || input.assets.length > 10) {
    throw contentError("CONTENT_INPUT_INVALID", "共用详情需要 1–10 张图片");
  }
  const seenAssets = new Set();
  const seenHotspots = new Set();
  const assets = input.assets.map((asset, index) => {
    const assetId = requiredText(asset.assetId, "详情图片", 80);
    if (seenAssets.has(assetId)) throw contentError("CONTENT_INPUT_INVALID", "同一详情不能重复使用相同图片");
    seenAssets.add(assetId);
    const hotspots = Array.isArray(asset.hotspots) ? asset.hotspots.map((hotspot) => normalizeHotspot(hotspot, context)) : [];
    if (hotspots.length > 20) throw contentError("CONTENT_INPUT_INVALID", "单张图片热点不能超过 20 个");
    hotspots.forEach((hotspot) => {
      if (seenHotspots.has(hotspot.id)) hotspot.id = createId("hotspot");
      seenHotspots.add(hotspot.id);
    });
    return { assetId, order: Number(asset.order || index + 1), hotspots };
  }).sort((left, right) => left.order - right.order);
  const content = {
    title: requiredText(input.title, "详情名称", 40),
    previewCopy: optionalText(input.previewCopy, "预览文案", 120),
    assets,
  };
  const version = draft
    ? updateDraft(draft, content, context)
    : newVersion(data, TYPES.DETAIL, logicalId, content, { ...input, sourceVersionId: sourceId }, context);
  return { version: presentVersion(data, version) };
}

function validateVersion(data, version, context = {}, candidateVersions = versionRows(data)) {
  const issues = [];
  const content = version.content || {};
  const checkAsset = (assetId, maximum, label) => {
    const asset = assetById(data, assetId);
    if (!asset) issues.push(`${label}不存在或未获授权`);
    else if (asset.byte_size > maximum) issues.push(`${label}超过 ${maximum / 1024}KB 硬上限`);
  };
  if (version.type === TYPES.WELCOME) {
    if (![1, 2].includes(content.slot)) issues.push("欢迎页屏位无效");
    if (!String(content.copy || "").trim()) issues.push("欢迎页文案缺失");
    checkAsset(content.assetId, 600 * 1024, "欢迎页背景图");
  } else if (version.type === TYPES.HOME) {
    checkAsset(content.assetId, Number(content.order) === 1 ? 600 * 1024 : 500 * 1024, "首页轮播图");
    if (![2, 3].includes(content.lineCount) || !Array.isArray(content.lines) || content.lines.length !== content.lineCount) issues.push("首页文案行数不符合 2–3 行预设");
    const detail = candidateVersions.find((row) => row.versionId === content.sharedDetailVersionId && row.type === TYPES.DETAIL && ["DRAFT", "PUBLISHED"].includes(row.status));
    if (!detail) issues.push("首页关联的共用详情版本不存在或未发布");
  } else if (version.type === TYPES.DETAIL) {
    if (!Array.isArray(content.assets) || !content.assets.length) issues.push("共用详情至少需要一张图片");
    (content.assets || []).forEach((asset, index) => {
      checkAsset(asset.assetId, 600 * 1024, `详情图片 ${index + 1}`);
      (asset.hotspots || []).forEach((hotspot, hotspotIndex) => {
        try { validateTarget(hotspot, context); } catch (error) { issues.push(`详情图片 ${index + 1} 热点 ${hotspotIndex + 1}：${error.message}`); }
      });
    });
  } else {
    issues.push("未知内容类型");
  }
  return { status: issues.length ? "BLOCKED" : "PASS", issues, validatedAt: instant(context) };
}

function candidateDrafts(data) {
  return versionRows(data).filter((row) => row.status === "DRAFT").sort((left, right) => left.versionId.localeCompare(right.versionId));
}

function candidateId(drafts) {
  if (!drafts.length) return "";
  const digest = crypto.createHash("sha256")
    .update(drafts.map((row) => `${row.versionId}:${row.revision}`).join("|"))
    .digest("hex").slice(0, 12).toUpperCase();
  return `CONTENT-CANDIDATE-${digest}`;
}

function effectivePublishedVersions(data, drafts) {
  const replacedLogicalVersions = new Set(drafts.map((row) => `${row.type}:${row.logicalId}`));
  return [
    ...versionRows(data).filter((row) => row.status === "PUBLISHED" && !replacedLogicalVersions.has(`${row.type}:${row.logicalId}`)),
    ...drafts,
  ];
}

function buildReleaseSummary(data, context = {}) {
  const drafts = candidateDrafts(data);
  const blockers = [];
  drafts.forEach((version) => {
    const validation = validateVersion(data, version, context, versionRows(data));
    validation.issues.forEach((issue) => blockers.push({
      type: version.type === TYPES.WELCOME ? "欢迎页" : version.type === TYPES.HOME ? "首页轮播" : "共用详情",
      content: version.content.title || version.content.internalName || `第 ${version.content.slot || "—"} 屏`,
      issue,
      status: "BLOCKED",
      module: version.type === TYPES.DETAIL ? "content-detail" : version.type === TYPES.HOME ? "content-home" : "content-welcome",
    }));
  });
  const effectiveVersions = effectivePublishedVersions(data, drafts);
  effectiveVersions.filter((row) => row.type === TYPES.HOME).forEach((home) => {
    const detail = effectiveVersions.find((row) => row.type === TYPES.DETAIL && row.versionId === home.content.sharedDetailVersionId);
    if (!detail) blockers.push({
      type: "首页轮播",
      content: home.content.internalName || home.logicalId,
      issue: "发布后关联详情将失效，请同步更新该首页轮播的详情版本",
      status: "BLOCKED",
      module: "content-home",
    });
  });
  const welcomeSlots = new Set(
    versionRows(data)
      .filter((row) => row.type === TYPES.WELCOME && ["DRAFT", "PUBLISHED"].includes(row.status))
      .map((row) => Number(row.content && row.content.slot)),
  );
  if (drafts.some((row) => row.type === TYPES.WELCOME)) {
    if (!welcomeSlots.has(1)) blockers.push({ type: "欢迎页", content: "第一屏", issue: "欢迎页第一屏尚未配置", status: "BLOCKED", module: "content-welcome" });
    if (!welcomeSlots.has(2)) blockers.push({ type: "欢迎页", content: "第二屏", issue: "欢迎页第二屏尚未配置", status: "BLOCKED", module: "content-welcome" });
  }
  const id = candidateId(drafts);
  const preview = previewRows(data).find((row) => row.candidate_version === id) || null;
  const current = publicationRows(data).find((row) => row.status === "PUBLISHED") || null;
  return {
    status: drafts.length ? "DRAFT" : current ? "PUBLISHED" : "EMPTY",
    draftCount: drafts.length,
    scheduledCount: drafts.filter((row) => row.type === TYPES.HOME && row.content.startsAt && Date.parse(row.content.startsAt) > Date.parse(instant(context))).length,
    blockerCount: blockers.length,
    blockers,
    candidateVersion: id,
    currentVersion: current ? current.release_version : "—",
    previewStatus: preview ? "COMPLETED" : id ? "AVAILABLE" : "UNAVAILABLE",
    previewedAt: preview ? preview.previewed_at : "",
    previewPath: id ? `/admin?module=content-home&candidate=${encodeURIComponent(id)}` : "",
    changeSummary: `欢迎页 ${drafts.filter((row) => row.type === TYPES.WELCOME).length} · 首页 ${drafts.filter((row) => row.type === TYPES.HOME).length} · 共用详情 ${drafts.filter((row) => row.type === TYPES.DETAIL).length}`,
  };
}

function markPreviewCompleted(data, input = {}, context = {}) {
  const summary = buildReleaseSummary(data, context);
  const version = requiredText(input.version, "候选内容版本", 80);
  if (!summary.candidateVersion || version !== summary.candidateVersion) throw contentError("CONTENT_CANDIDATE_STALE", "候选内容已变化，请重新校验", 409);
  if (summary.blockerCount) throw contentError("CONTENT_VALIDATION_FAILED", "仍有内容发布阻断项", 409, summary.blockers);
  const existing = previewRows(data).find((row) => row.candidate_version === version);
  if (existing) return { preview: clone(existing) };
  const preview = {
    content_preview_record_id: createId("content_preview"),
    candidate_version: version,
    previewed_at: instant(context),
    previewed_by: context.operatorId || "",
  };
  previewRows(data).unshift(preview);
  return { preview: clone(preview) };
}

function publishCandidate(data, input = {}, context = {}) {
  const summary = buildReleaseSummary(data, context);
  const version = requiredText(input.version, "候选内容版本", 80);
  if (!summary.candidateVersion || version !== summary.candidateVersion) throw contentError("CONTENT_CANDIDATE_STALE", "候选内容已变化，请重新校验", 409);
  if (summary.blockerCount) throw contentError("CONTENT_VALIDATION_FAILED", "仍有内容发布阻断项", 409, summary.blockers);
  if (!previewRows(data).some((row) => row.candidate_version === version)) throw contentError("CONTENT_PREVIEW_REQUIRED", "请先完成小程序预览", 409);
  if (input.confirmed !== true || String(input.confirmationText || "").trim() !== "确认发布内容") {
    throw contentError("CONTENT_PUBLISH_CONFIRMATION_REQUIRED", "需要二次确认后才能发布", 409);
  }
  const drafts = candidateDrafts(data);
  const publishedAt = instant(context);
  drafts.forEach((draft) => {
    versionRows(data).forEach((row) => {
      if (row.logicalId === draft.logicalId && row.status === "PUBLISHED") {
        row.status = row.type === TYPES.DETAIL ? "RETIRED" : "OFFLINE";
        row.updatedAt = publishedAt;
      }
    });
    draft.status = "PUBLISHED";
    draft.publishedAt = publishedAt;
    draft.publishedBy = context.operatorId || "";
    draft.updatedAt = publishedAt;
  });
  publicationRows(data).forEach((row) => { if (row.status === "PUBLISHED") row.status = "SUPERSEDED"; });
  const record = {
    content_publication_record_id: createId("content_release"),
    release_version: version.replace("CONTENT-CANDIDATE", "CONTENT"),
    candidate_version: version,
    status: "PUBLISHED",
    version_ids: drafts.map((row) => row.versionId),
    published_at: publishedAt,
    published_by: context.operatorId || "",
  };
  publicationRows(data).unshift(record);
  return { releaseVersion: record.release_version, publishedCount: drafts.length, publishedAt };
}

function unpublishVersion(data, input = {}, context = {}) {
  const id = requiredText(input.versionId || input.version_id, "内容版本", 80);
  const version = versionRows(data).find((row) => row.versionId === id);
  if (!version || version.status !== "PUBLISHED") throw contentError("CONTENT_VERSION_NOT_PUBLISHED", "内容版本未发布", 404);
  if (version.type === TYPES.DETAIL) {
    const referenced = versionRows(data).some((row) => row.type === TYPES.HOME
      && row.status === "PUBLISHED"
      && row.content.sharedDetailVersionId === version.versionId);
    if (referenced) throw contentError("CONTENT_VERSION_IN_USE", "该共用详情仍被已发布首页轮播引用，请先下线引用入口", 409);
  }
  version.status = version.type === TYPES.DETAIL ? "RETIRED" : "OFFLINE";
  version.updatedAt = instant(context);
  version.updatedBy = context.operatorId || "";
  return { version: presentVersion(data, version) };
}

function presentVersion(data, version) {
  const content = clone(version.content || {});
  const base = {
    id: version.versionId,
    versionId: version.versionId,
    logicalId: version.logicalId,
    type: version.type,
    status: version.status,
    version: version.version,
    versionLabel: `v${version.version}.0`,
    revision: version.revision,
    sourceVersionId: version.sourceVersionId || "",
    sourceVersionLabel: version.sourceVersionId ? `基于 v${Math.max(1, version.version - 1)}.0` : "",
    updatedAt: version.updatedAt,
    updatedAtLabel: version.updatedAt,
    validationLabel: version.validation && version.validation.status === "PASS" ? "已通过" : version.validation && version.validation.status === "BLOCKED" ? "有阻断" : "待校验",
  };
  if (version.type === TYPES.WELCOME) {
    const asset = assetById(data, content.assetId);
    return { ...base, ...content, ...(asset ? { ...presentAsset(asset), assetId: content.assetId } : {}) };
  }
  if (version.type === TYPES.HOME) {
    const asset = assetById(data, content.assetId);
    const detail = versionRows(data).find((row) => row.versionId === content.sharedDetailVersionId);
    return {
      ...base,
      ...content,
      scheduleRange: [content.startsAt, content.endsAt].filter(Boolean),
      scheduleLabel: content.startsAt ? `${content.startsAt} 至 ${content.endsAt || "长期有效"}` : "立即上线 · 长期有效",
      alignmentLabel: "居中",
      detailTitle: detail && detail.content.title || "未关联",
      detailVersion: detail ? `v${detail.version}.0` : "—",
      thumbnailUrl: asset ? presentAsset(asset).previewUrl : "",
      assetName: asset ? asset.name : "",
      assetMeta: asset ? presentAsset(asset).assetMeta : "",
    };
  }
  const assets = (content.assets || []).map((row) => {
    const asset = assetById(data, row.assetId);
    return {
      id: row.assetId,
      assetId: row.assetId,
      order: row.order,
      hotspots: clone(row.hotspots || []),
      previewUrl: asset ? presentAsset(asset).previewUrl : "",
      dimensions: asset ? presentAsset(asset).dimensions : "",
    };
  });
  const referenceCount = versionRows(data).filter((row) => row.type === TYPES.HOME && row.content.sharedDetailVersionId === version.versionId && ["DRAFT", "PUBLISHED"].includes(row.status)).length;
  return { ...base, ...content, assets, assetCount: assets.length, referenceCount };
}

function listAdminWelcome(data) {
  const screens = [1, 2].map((slot) => {
    const logicalId = `WELCOME_SLOT_${slot}`;
    const version = draftForLogical(data, TYPES.WELCOME, logicalId) || currentPublished(data, TYPES.WELCOME, logicalId);
    return version ? presentVersion(data, version) : { slot, status: "EMPTY", validationLabel: "待校验" };
  });
  return { screens, previewPath: screens.some((screen) => screen.status === "PUBLISHED") ? "/pages/welcome/index" : "" };
}

function listAdminHomeCarousel(data, query = {}) {
  const { keyword } = pageQuery(query);
  let items = versionRows(data).filter((row) => row.type === TYPES.HOME);
  const status = String(query.status || "").trim();
  if (status) items = items.filter((row) => row.status === status);
  if (keyword) items = items.filter((row) => `${row.content.internalName} ${row.content.copy}`.toLowerCase().includes(keyword));
  items.sort((left, right) => Number(left.content.order || 0) - Number(right.content.order || 0) || right.updatedAt.localeCompare(left.updatedAt));
  const result = paginate(items.map((row) => presentVersion(data, row)), query);
  return { ...result, previewPath: items.some((row) => row.status === "PUBLISHED") ? "/pages/home/index" : "" };
}

function listAdminSharedDetails(data, query = {}) {
  const { keyword } = pageQuery(query);
  let items = versionRows(data).filter((row) => row.type === TYPES.DETAIL);
  const status = String(query.status || "").trim();
  if (status) items = items.filter((row) => row.status === status);
  if (keyword) items = items.filter((row) => `${row.content.title} v${row.version}.0`.toLowerCase().includes(keyword));
  items.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return paginate(items.map((row) => presentVersion(data, row)), query);
}

function activeLegacy(row, context = {}) {
  if (!row || row.status !== "PUBLISHED" || row.placement !== "HOME") return false;
  if (context.env && context.env.NODE_ENV === "production" && row.assetState === "DEVELOPMENT_PLACEHOLDER") return false;
  const now = Date.parse(context.now || new Date().toISOString());
  const startsAt = row.startsAt ? Date.parse(row.startsAt) : Number.NEGATIVE_INFINITY;
  const endsAt = row.endsAt ? Date.parse(row.endsAt) : Number.POSITIVE_INFINITY;
  return Number.isFinite(now) && now >= startsAt && now < endsAt;
}

function presentLegacy(row, context = {}) {
  const contentId = safeId(row.contentId);
  const kicker = safeText(row.kicker, 40);
  const lines = Array.isArray(row.lines) ? row.lines.map((line) => safeText(line, 40)) : [];
  const action = normalizeAction(row.action, context.env || {});
  const placeholder = row.assetState === "DEVELOPMENT_PLACEHOLDER";
  const coverAssetUrl = safeHttpsOrCloudUrl(row.coverAssetUrl);
  const detailImages = Array.isArray(row.detailImages) ? row.detailImages.map(safeHttpsOrCloudUrl).filter(Boolean).slice(0, 10) : [];
  if (!contentId || !kicker || ![2, 3].includes(lines.length) || lines.some((line) => !line)) return null;
  if (!placeholder && (!coverAssetUrl || detailImages.length === 0)) return null;
  if (row.action !== null && row.action !== undefined && action === undefined) return null;
  return {
    contentId,
    version: Number.isInteger(row.version) && row.version > 0 ? row.version : 1,
    assetState: placeholder ? "DEVELOPMENT_PLACEHOLDER" : "AUTHORIZED",
    kicker,
    lines,
    coverAssetUrl,
    detailImages,
    assets: detailImages.map((imageUrl) => ({ imageUrl, hotspots: [] })),
    detailPath: `/subpkg/content/pages/detail/index?contentId=${encodeURIComponent(contentId)}`,
    action: action || null,
  };
}

function publishedNewVersions(data, type) {
  return versionRows(data).filter((row) => row.type === type && row.status === "PUBLISHED");
}

function listWelcome(data, context = {}) {
  const published = publishedNewVersions(data, TYPES.WELCOME).sort((left, right) => left.content.slot - right.content.slot);
  const screens = published.map((version) => {
    const asset = assetById(data, version.content.assetId);
    if (!asset) return null;
    return {
      slot: version.content.slot,
      copy: version.content.copy,
      assetUrl: presentAsset(asset).previewUrl,
      versionId: version.versionId,
      version: version.version,
    };
  }).filter(Boolean);
  return { publicationState: screens.length === 2 ? "PUBLISHED" : "NOT_PUBLISHED", screens };
}

function listHome(data, context = {}) {
  if (versionRows(data).length) {
    const now = Date.parse(context.now || new Date().toISOString());
    const items = publishedNewVersions(data, TYPES.HOME)
      .filter((row) => (!row.content.startsAt || now >= Date.parse(row.content.startsAt)) && (!row.content.endsAt || now < Date.parse(row.content.endsAt)))
      .sort((left, right) => Number(left.content.order || 0) - Number(right.content.order || 0))
      .map((version) => {
        const asset = assetById(data, version.content.assetId);
        const detail = versionRows(data).find((row) => row.versionId === version.content.sharedDetailVersionId && row.type === TYPES.DETAIL && row.status === "PUBLISHED");
        if (!asset || !detail) return null;
        return {
          contentId: detail.logicalId,
          contentVersionId: version.versionId,
          detailVersionId: detail.versionId,
          version: version.version,
          assetState: "AUTHORIZED",
          kicker: safeText(version.content.kicker, 40) || "ROOT FOUNDATION",
          lines: clone(version.content.lines),
          typography: { lineCount: version.content.lineCount, fontSize: version.content.fontSize, alignment: version.content.alignment },
          coverAssetUrl: presentAsset(asset).previewUrl,
          detailPath: `/subpkg/content/pages/detail/index?contentId=${encodeURIComponent(detail.logicalId)}`,
          action: null,
        };
      }).filter(Boolean);
    return { publicationState: items.length ? "PUBLISHED" : "NOT_PUBLISHED", items };
  }
  const items = legacyRows(data).filter((row) => activeLegacy(row, context)).sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0)).map((row) => presentLegacy(row, context)).filter(Boolean);
  return { publicationState: items.length ? "PUBLISHED" : "NOT_PUBLISHED", items };
}

function getDetail(data, contentId, context = {}) {
  const id = safeId(contentId);
  if (versionRows(data).length) {
    const version = publishedNewVersions(data, TYPES.DETAIL)
      .filter((row) => row.logicalId === id || row.versionId === id)
      .sort((left, right) => Number(right.version || 0) - Number(left.version || 0))[0];
    if (!version) throw contentError("FORMAL_CONTENT_NOT_FOUND", "内容暂未发布", 404);
    const assets = (version.content.assets || []).map((row) => {
      const asset = assetById(data, row.assetId);
      if (!asset) return null;
      return {
        assetId: row.assetId,
        imageUrl: presentAsset(asset).previewUrl,
        hotspots: (row.hotspots || []).map((hotspot) => ({
          id: hotspot.id,
          x: hotspot.x,
          y: hotspot.y,
          width: hotspot.width,
          height: hotspot.height,
          action: hotspot.action && hotspot.action.type === "BUSINESS_WEBVIEW"
            ? { type: "BUSINESS_WEBVIEW", actionId: hotspot.id }
            : clone(hotspot.action),
        })),
      };
    }).filter(Boolean);
    return { item: {
      contentId: version.logicalId,
      versionId: version.versionId,
      version: version.version,
      title: version.content.title,
      previewCopy: version.content.previewCopy,
      assetState: "AUTHORIZED",
      assets,
      detailImages: assets.map((asset) => asset.imageUrl),
      action: null,
    } };
  }
  const row = legacyRows(data).find((candidate) => candidate.contentId === id && activeLegacy(candidate, context));
  const item = row && presentLegacy(row, context);
  if (!item) throw contentError("FORMAL_CONTENT_NOT_FOUND", "内容暂未发布", 404);
  return { item };
}

function getAction(data, actionId) {
  const id = safeId(actionId);
  for (const version of publishedNewVersions(data, TYPES.DETAIL)) {
    for (const asset of version.content.assets || []) {
      const hotspot = (asset.hotspots || []).find((row) => row.id === id);
      if (hotspot && hotspot.action && hotspot.action.type === "BUSINESS_WEBVIEW") return { action: clone(hotspot.action) };
    }
  }
  throw contentError("CONTENT_ACTION_NOT_FOUND", "内容跳转已失效", 404);
}

module.exports = {
  TYPES,
  buildReleaseSummary,
  getAction,
  getAsset,
  getDetail,
  listAdminHomeCarousel,
  listAdminSharedDetails,
  listAdminWelcome,
  listHome,
  listWelcome,
  markPreviewCompleted,
  normalizeAction,
  publishCandidate,
  saveHomeCarouselDraft,
  saveSharedDetailDraft,
  saveWelcomeDraft,
  unpublishVersion,
  prepareAssetUpload,
  recordUploadedAsset,
  validateTarget,
};
