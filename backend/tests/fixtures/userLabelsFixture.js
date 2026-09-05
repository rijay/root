const { createStore } = require("../../src/domain");
const { FIELD_SPEC } = require("../../src/feishuUserLabels");

function fixture(now = new Date()) {
  const data = createStore();
  const t = (days) => new Date(now.getTime() - days * 86400000).toISOString();
  data.users = [{ user_id: "usr_labels_demo", root_user_id: "usr_labels_demo", app_code: "MYROOT", created_at: t(5),
    phone: "13800138000", unionid: "private-union", nickname: "PRIVATE_NAME" }];
  data.rootUsers = [{ root_user_id: "usr_labels_demo", lifecycle_status: "REGISTERED", created_at: t(5), updated_at: t(1), unionid_status: "PENDING" }];
  data.channelQrCodes = [{ channel_qr_code_id: "qr_demo", channel_id: "VENUE_DEMO", campaign_id: "EVENT_DEMO", label: "演示场馆码" }];
  data.channelFunnelVisits = [{ root_user_id: "usr_labels_demo", channel_funnel_visit_id: "visit_demo", channel_qr_code_id: "qr_demo", channel_id: "VENUE_DEMO", campaign_id: "EVENT_DEMO", opened_at: t(4) }];
  data.healthAssessmentDefinitions = [{ assessment_definition_id: "def_demo", questionnaire_id: "ROOT_GUT_5Q", questionnaire_version: 2,
    questions: ["Q1", "Q2", "Q3", "Q4", "Q5"].map((field) => ({ field })), result_copies: [{ code: "SENSITIVE", title: "肠道较敏感" }] }];
  data.healthAssessmentAttempts = [{ assessment_id: "has_demo", root_user_id: "usr_labels_demo", questionnaire_id: "ROOT_GUT_5Q",
    assessment_definition_id: "def_demo", questionnaire_version: 2, status: "COMPLETED", completed_at: t(3), updated_at: t(3),
    answers_json: { Q1: "A", Q2: "B", Q3: ["B", "D"], Q4: ["C"], Q5: ["B", "E"] }, result_json: { resultCode: "SENSITIVE", title: "肠道较敏感" } }];
  data.userLabelMappings = [{ user_label_mapping_id: "ulm_demo", source_type: "QR_CODE", source_id: "qr_demo", source_version: 0,
    mapping_version: 1, effective_from: t(5), attributes_json: { activity: "演示活动", city: "上海", partner: "演示场馆", channelType: "场馆陪伴计划" },
    reason: "本地虚构演示", created_by: "demo", created_at: t(5) }];
  return data;
}
function remoteFixture() {
  return { fields: FIELD_SPEC.map(([field_name, type]) => ({ field_name, type,
    property: { options: ["待确认", "待核验", "待观察", "是", "否", "演示活动", "上海", "演示场馆", "场馆陪伴计划", "其他", "人工活动"]
      .map((name) => ({ name })) } })), records: [] };
}
function fakeAdapter(remote = remoteFixture()) {
  return { configured: true, writesEnabled: true, targetKey: "demo_target", remote, writes: 0,
    async read() { return structuredClone(remote); },
    async write(action) {
      this.writes += 1;
      let record = remote.records.find((r) => r.recordId === action.recordId);
      if (!record) { record = { recordId: `recDemo${remote.records.length + 1}`, fields: {} }; remote.records.push(record); }
      Object.assign(record.fields, action.fields); return record.recordId;
    },
    async get(recordId) { return structuredClone(remote.records.find((r) => r.recordId === recordId)); },
  };
}
module.exports = { fixture, remoteFixture, fakeAdapter };
