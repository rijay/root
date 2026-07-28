const { nowISO } = require("./dates");
const { normalizePhone, recordLifecycleEvent } = require("./identity");
const { externalPayloadFieldPaths } = require("./externalEvidenceSanitizer");
const {
  VERIFIED_UNIONID_RESOLUTION,
  resolveVerifiedWechatUnionIdOwnership,
} = require("./wechatUnionIdAuthority");

function ensureList(data, key) {
  if (!Array.isArray(data[key])) data[key] = [];
  return data[key];
}

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function customerYzUid(input = {}) {
  return text(
    input.youzanYzUid ||
      input.youzan_yz_uid ||
      input.yzUid ||
      input.yz_uid ||
      input.buyerId ||
      input.buyer_id ||
      input.fansId ||
      input.fans_id ||
      input.customerId ||
      input.customer_id
  );
}

function customerUnionId(input = {}) {
  return text(input.unionid || input.unionId || input.union_id || input.buyerUnionId || input.buyer_unionid);
}

function rootUserByUnionId(data, unionid, options = {}) {
  const ownership = resolveVerifiedWechatUnionIdOwnership(
    ensureList(data, "wechatIdentities"),
    unionid,
    { env: options.env || process.env }
  );
  if (ownership.status !== VERIFIED_UNIONID_RESOLUTION.VERIFIED) return null;
  return ensureList(data, "rootUsers").find((item) => item.root_user_id === ownership.rootUserId) || null;
}

function rootUserByPhone(data, phone) {
  const value = normalizePhone(phone);
  if (!value) return null;
  const legacyUsers = ensureList(data, "users").filter((item) => normalizePhone(item.phone) === value);
  if (legacyUsers.length !== 1) return null;
  const rootUserId = legacyUsers[0].root_user_id || legacyUsers[0].user_id;
  return ensureList(data, "rootUsers").find((item) => item.root_user_id === rootUserId) || null;
}

function rootUserByInput(data, input = {}, options = {}) {
  const explicit = text(input.rootUserId || input.root_user_id || input.userId || input.user_id);
  if (explicit) return ensureList(data, "rootUsers").find((item) => item.root_user_id === explicit) || null;
  const unionid = customerUnionId(input);
  if (unionid) return rootUserByUnionId(data, unionid, options);
  return rootUserByPhone(data, input.phone || input.receiverPhone || input.receiver_phone);
}

function orderSummaryForCustomer(data, customer = {}) {
  const yzUid = customer.youzan_yz_uid || "";
  const orders = ensureList(data, "youzanOrders").filter((order) => order.youzan_yz_uid === yzUid);
  const latestOrder = orders
    .slice()
    .sort((left, right) => String(right.paid_at || right.matched_at || "").localeCompare(String(left.paid_at || left.matched_at || "")))[0] || null;
  return {
    totalOrders: orders.length,
    boundOrders: orders.filter((order) => order.user_id).length,
    unboundOrders: orders.filter((order) => !order.user_id).length,
    latestOrderNo: latestOrder ? latestOrder.youzan_order_no || "" : "",
    latestOrderStatus: latestOrder ? latestOrder.order_status || "" : "",
    latestDeliveryStatus: latestOrder ? latestOrder.delivery_status || "" : "",
    latestMatchSource: latestOrder ? latestOrder.match_source || "" : "",
  };
}

function linkStatusForCustomer(customer = {}, orderSummary = {}) {
  if (customer.root_user_id && orderSummary.unboundOrders) return "LINKED_WITH_UNBOUND_ORDERS";
  if (customer.root_user_id) return "LINKED";
  if (customer.unionid || customer.phone) return "PENDING_USER_MATCH";
  return "MISSING_EVIDENCE";
}

function nextActionForCustomer(customer = {}, orderSummary = {}) {
  const linkStatus = linkStatusForCustomer(customer, orderSummary);
  if (linkStatus === "LINKED_WITH_UNBOUND_ORDERS") return "该客户已补链但仍有同 yzUid 未绑定订单，重新导入订单或进入人工订单匹配";
  if (linkStatus === "LINKED") return "已补链，可继续观察后续订单是否自动绑定";
  if (customer.unionid) return "确认微信开放平台 UnionID 已认证并等待用户身份补链";
  if (customer.phone) return "等待用户授权手机号或核对该手机号是否唯一";
  return "补齐 unionid、手机号或 rootUserId 后再导入客户样本";
}

function toCustomerPayload(customer = {}, data = {}) {
  const orderSummary = orderSummaryForCustomer(data, customer);
  const linkStatus = linkStatusForCustomer(customer, orderSummary);
  return {
    youzanYzUid: customer.youzan_yz_uid || "",
    unionid: customer.unionid || "",
    rootUserId: customer.root_user_id || "",
    phone: customer.phone || "",
    nickname: customer.nickname || "",
    matchSource: customer.match_source || "",
    linkStatus,
    nextAction: nextActionForCustomer(customer, orderSummary),
    orderSummary,
    linkedAt: customer.linked_at || "",
    updatedAt: customer.updated_at || "",
  };
}

function upsertYouzanCustomer(data, input = {}, context = {}) {
  const yzUid = customerYzUid(input);
  if (!yzUid) {
    const error = new Error("有赞客户 yzUid 必填");
    error.code = 8301;
    throw error;
  }
  const now = nowISO();
  const customers = ensureList(data, "youzanCustomers");
  let customer = customers.find((item) => item.youzan_yz_uid === yzUid);
  const unionid = customerUnionId(input);
  const phone = normalizePhone(input.phone || input.receiverPhone || input.receiver_phone || input.buyerPhone || input.buyer_phone);
  const matchedRootUser = rootUserByInput(data, { ...input, unionid, phone }, context);
  if (!customer) {
    customer = {
      youzan_yz_uid: yzUid,
      unionid: "",
      root_user_id: "",
      phone: "",
      nickname: "",
      match_source: "",
      raw_payload: {},
      linked_at: "",
      created_at: now,
      updated_at: now,
    };
    customers.push(customer);
  }

  const beforeRootUserId = customer.root_user_id || "";
  customer.unionid = unionid || customer.unionid || "";
  customer.root_user_id = text(input.rootUserId || input.root_user_id || input.userId || input.user_id, customer.root_user_id);
  if (!customer.root_user_id && matchedRootUser) customer.root_user_id = matchedRootUser.root_user_id;
  customer.phone = phone || customer.phone || "";
  customer.nickname = text(input.nickname || input.nickName || input.nick_name || input.buyerName || input.buyer_name, customer.nickname);
  customer.match_source = customer.root_user_id
    ? text(input.matchSource || input.match_source, customer.unionid ? "UNIONID" : customer.phone ? "PHONE" : "MANUAL")
    : "";
  const incomingRawPayload = objectValue(input.rawPayload || input.raw_payload);
  if (Object.keys(incomingRawPayload).length) {
    customer.raw_payload = {
      field_paths: externalPayloadFieldPaths(incomingRawPayload),
    };
  }
  if (customer.root_user_id && customer.root_user_id !== beforeRootUserId) {
    customer.linked_at = now;
    recordLifecycleEvent(data, customer.root_user_id, "YOUZAN_CUSTOMER_LINKED", {
      sourceChannel: context.sourceChannel || "YOUZAN_CUSTOMER",
      metadata: { youzanYzUid: customer.youzan_yz_uid, matchSource: customer.match_source },
    });
  }
  customer.updated_at = now;
  return {
    customer,
    payload: toCustomerPayload(customer, data),
    linked: Boolean(customer.root_user_id),
    rootUserId: customer.root_user_id || "",
  };
}

function findCustomer(data, yzUid) {
  return ensureList(data, "youzanCustomers").find((item) => item.youzan_yz_uid === text(yzUid)) || null;
}

function listCustomers(data, query = {}) {
  const keyword = text(query.keyword || query.q).toLowerCase();
  const limit = Number(query.limit || 50);
  const customers = ensureList(data, "youzanCustomers")
    .filter((item) => {
      if (!keyword) return true;
      return [item.youzan_yz_uid, item.unionid, item.root_user_id, item.phone, item.nickname]
        .some((value) => String(value || "").toLowerCase().includes(keyword));
    })
    .slice(0, Number.isFinite(limit) && limit > 0 ? limit : 50)
    .map((customer) => toCustomerPayload(customer, data));
  return {
    total: customers.length,
    customers,
  };
}

module.exports = {
  customerUnionId,
  customerYzUid,
  findCustomer,
  listCustomers,
  orderSummaryForCustomer,
  rootUserByInput,
  toCustomerPayload,
  upsertYouzanCustomer,
};
