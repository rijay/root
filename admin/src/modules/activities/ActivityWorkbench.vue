<template>
  <section class="workbench activity-workbench">
    <el-alert
      :closable="false"
      class="workbench-alert"
      title="正式活动内容只接受 OPS_BACKEND。UED 占位、示意文案和未授权摄影素材不可提交。"
      type="warning"
      show-icon
    />
    <el-alert
      v-if="readErrors.length"
      :closable="false"
      class="workbench-alert"
      :title="readErrors.join('；')"
      type="error"
      show-icon
    />
    <el-alert
      v-if="activityCommandRecoveryError"
      :closable="false"
      class="workbench-alert"
      :title="activityCommandRecoveryError"
      type="error"
      show-icon
    />
    <el-card v-if="pendingRecords.length" class="pending-command-card" shadow="never">
      <template #header>
        <div class="toolbar-title">
          <span>待确认写入</span>
          <el-tag effect="plain" type="warning">{{ pendingRecords.length }} 个未决意图</el-tag>
        </div>
      </template>
      <el-alert
        :closable="false"
        title="这些操作尚未被权威读取证明成功。复用会沿用原幂等意图并生成新的尝试标识；作废只清理本机恢复记录，不会撤销后台可能已完成的写入。"
        type="warning"
        show-icon
      />
      <el-table :data="pendingRecords" size="small">
        <el-table-column prop="operation" label="操作" width="150" />
        <el-table-column label="审计检索标识" min-width="280">
          <template #default="{ row }"><code>{{ row.idempotencyKey }}</code></template>
        </el-table-column>
        <el-table-column label="操作" width="220">
          <template #default="{ row }">
            <el-space>
              <el-button :loading="writeLoading" size="small" type="primary" @click="retryPendingCommand(row)">复用原意图重试</el-button>
              <el-button :disabled="writeLoading" size="small" type="danger" plain @click="voidPendingCommand(row)">作废原意图</el-button>
            </el-space>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-tabs v-model="activeTab" class="workbench-tabs">
      <el-tab-pane label="活动内容" name="activities">
        <el-row :gutter="16">
          <el-col :span="9">
            <el-card shadow="never">
              <template #header>
                <div class="toolbar-title">
                  <span>{{ draftForm.activityVersionId ? "编辑草稿" : "新建草稿" }}</span>
                  <el-tag effect="plain" type="success">OPS_BACKEND</el-tag>
                </div>
              </template>
              <el-form label-position="top" :model="draftForm">
                <el-row :gutter="12">
                  <el-col :span="16"><el-form-item label="活动 ID"><el-input v-model="draftForm.activityId" /></el-form-item></el-col>
                  <el-col :span="8"><el-form-item label="版本"><el-input-number v-model="draftForm.version" :min="1" /></el-form-item></el-col>
                </el-row>
                <el-form-item label="标题"><el-input v-model="draftForm.title" /></el-form-item>
                <el-form-item label="摘要"><el-input v-model="draftForm.summary" :rows="2" type="textarea" /></el-form-item>
                <el-form-item label="活动目标"><el-input v-model="draftForm.objective" :rows="3" type="textarea" /></el-form-item>
                <el-form-item label="适合人群"><el-input v-model="draftForm.audience" :rows="3" type="textarea" /></el-form-item>
                <el-form-item label="活动流程"><el-input v-model="draftForm.agenda" :rows="5" type="textarea" /></el-form-item>
                <el-row :gutter="12">
                  <el-col :span="12"><el-form-item label="主办方"><el-input v-model="draftForm.organizer" /></el-form-item></el-col>
                  <el-col :span="12"><el-form-item label="费用口径"><el-input v-model="draftForm.feeDescription" /></el-form-item></el-col>
                </el-row>
                <el-form-item label="携带物品"><el-input v-model="draftForm.bringItems" :rows="3" type="textarea" /></el-form-item>
                <el-form-item label="取消规则"><el-input v-model="draftForm.cancelPolicy" :rows="3" type="textarea" /></el-form-item>
                <el-form-item label="报名隐私说明"><el-input v-model="draftForm.privacyNoticeText" :rows="3" type="textarea" /></el-form-item>
                <el-form-item label="现场摄影说明"><el-input v-model="draftForm.photographyNoticeText" :rows="3" type="textarea" /></el-form-item>
                <el-form-item label="用户可见联系人"><el-input v-model="draftForm.contactDisplay" /></el-form-item>
                <el-row :gutter="12">
                  <el-col :span="12"><el-form-item label="详情版本"><el-input v-model="draftForm.detailVersion" /></el-form-item></el-col>
                  <el-col :span="12"><el-form-item label="活动类型"><el-input v-model="draftForm.activityType" /></el-form-item></el-col>
                  <el-col :span="10"><el-form-item label="城市"><el-input v-model="draftForm.city" /></el-form-item></el-col>
                  <el-col :span="14"><el-form-item label="场地摘要"><el-input v-model="draftForm.venueSummary" /></el-form-item></el-col>
                </el-row>
                <el-form-item label="主视觉受控资产引用">
                  <el-input v-model="draftForm.heroAssetRef" placeholder="asset://..." />
                  <span class="description-meta">摄影素材先进入已授权资产存储 Adapter，再填写不可变引用。</span>
                </el-form-item>
                <el-form-item label="隐私告知引用"><el-input v-model="draftForm.privacyNoticeRef" placeholder="notice://..." /></el-form-item>
                <el-form-item label="摄影告知引用"><el-input v-model="draftForm.photographyNoticeRef" placeholder="notice://..." /></el-form-item>
                <el-form-item label="内容审批引用"><el-input v-model="draftForm.contentApprovalRef" placeholder="approval://..." /></el-form-item>
                <el-form-item label="联系负责人受信引用"><el-input v-model="draftForm.contactOwnerSignerRef" placeholder="signer://..." /></el-form-item>
                <el-row :gutter="12">
                  <el-col :span="10">
                    <el-form-item label="可见范围">
                      <el-select v-model="draftForm.visibility" style="width: 100%">
                        <el-option label="公开" value="PUBLIC" />
                        <el-option label="会员" value="MEMBER" />
                      </el-select>
                    </el-form-item>
                  </el-col>
                  <el-col :span="14">
                    <el-form-item label="会员要求"><el-input v-model="draftForm.memberRequirement" :disabled="draftForm.visibility !== 'MEMBER'" /></el-form-item>
                  </el-col>
                </el-row>
                <el-space wrap>
                  <el-button :disabled="!canContentWrite" :loading="writeLoading" type="primary" @click="submitDraft">保存草稿</el-button>
                  <el-button @click="resetDraft">清空</el-button>
                  <span v-if="!canContentWrite" class="description-meta">{{ access.reason(ADMIN_CAPABILITIES.ACTIVITY_CONTENT_WRITE) }}</span>
                </el-space>
              </el-form>
            </el-card>
          </el-col>

          <el-col :span="15">
            <el-card shadow="never">
              <template #header>
                <div class="toolbar-title">
                  <span>活动版本</span>
                  <el-space wrap>
                    <el-input v-model="activityFilters.search" clearable placeholder="活动 ID 或标题" @keyup.enter="refreshActivities" />
                    <el-select v-model="activityFilters.status" clearable placeholder="状态">
                      <el-option v-for="status in definitionStates" :key="status" :label="status" :value="status" />
                    </el-select>
                    <el-button :loading="activitiesLoading" @click="refreshActivities">刷新</el-button>
                  </el-space>
                </div>
              </template>
              <el-table v-loading="activitiesLoading" :data="activities" height="650" empty-text="暂无活动版本，或后台读取 Interface 尚未交付">
                <el-table-column label="活动" min-width="210">
                  <template #default="{ row }">
                    <div class="table-title">{{ row.title || row.activityId }}</div>
                    <div class="table-meta">{{ row.activityId }} / v{{ row.version }}</div>
                  </template>
                </el-table-column>
                <el-table-column prop="city" label="城市" width="90" />
                <el-table-column label="状态" width="120">
                  <template #default="{ row }"><el-tag :type="statusType(row.status)" effect="plain">{{ row.status }}</el-tag></template>
                </el-table-column>
                <el-table-column prop="visibility" label="范围" width="90" />
                <el-table-column label="操作" min-width="310" fixed="right">
                  <template #default="{ row }">
                    <el-space wrap>
                      <el-button v-if="row.status === 'DRAFT'" size="small" @click="editDraft(row)">编辑</el-button>
                      <el-button v-if="row.status === 'DRAFT'" :disabled="!canContentWrite" size="small" type="primary" @click="submitForReview(row)">提交审核</el-button>
                      <el-button v-if="row.status === 'IN_REVIEW'" :disabled="!canContentWrite" size="small" @click="returnForChanges(row)">退回</el-button>
                      <el-button v-if="row.status === 'IN_REVIEW'" :disabled="!canPublish" size="small" type="success" @click="openPublish(row)">发布 Gate</el-button>
                      <el-button v-if="row.status === 'PUBLISHED'" :disabled="!canPublish" size="small" type="warning" @click="withdraw(row)">下架</el-button>
                      <el-button v-if="row.status === 'UNPUBLISHED'" :disabled="!canPublish" size="small" type="danger" @click="archive(row)">归档</el-button>
                    </el-space>
                  </template>
                </el-table-column>
              </el-table>
              <el-pagination
                v-if="activityPagination.total > activityPagination.pageSize"
                class="activity-pagination"
                :current-page="activityPagination.page"
                :page-size="activityPagination.pageSize"
                :total="activityPagination.total"
                layout="total, prev, pager, next"
                @current-change="changeActivityPage"
              />
            </el-card>
          </el-col>
        </el-row>
      </el-tab-pane>

      <el-tab-pane label="场次管理" name="sessions">
        <el-card shadow="never">
          <template #header><div class="toolbar-title"><span>创建场次</span><el-button :loading="sessionsLoading" @click="refreshSessions">刷新场次</el-button></div></template>
          <el-form :inline="true" :model="sessionForm" class="activity-inline-form">
            <el-form-item label="活动版本"><el-input v-model="sessionForm.activityVersionId" placeholder="actv_..." /></el-form-item>
            <el-form-item label="容量"><el-input-number v-model="sessionForm.capacity" :min="1" /></el-form-item>
            <el-form-item label="审核"><el-select v-model="sessionForm.approvalMode"><el-option label="自动" value="AUTO" /><el-option label="人工" value="MANUAL" /></el-select></el-form-item>
            <el-form-item label="报名开始"><el-date-picker v-model="sessionForm.registrationOpenAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ssZ" /></el-form-item>
            <el-form-item label="报名截止"><el-date-picker v-model="sessionForm.registrationCloseAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ssZ" /></el-form-item>
            <el-form-item label="自助取消截止"><el-date-picker v-model="sessionForm.cancelCloseAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ssZ" /></el-form-item>
            <el-form-item v-if="sessionForm.approvalMode === 'MANUAL'" label="审核截止"><el-date-picker v-model="sessionForm.reviewDeadline" type="datetime" value-format="YYYY-MM-DDTHH:mm:ssZ" /></el-form-item>
            <el-form-item label="开始"><el-date-picker v-model="sessionForm.sessionStartAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ssZ" /></el-form-item>
            <el-form-item label="结束"><el-date-picker v-model="sessionForm.sessionEndAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ssZ" /></el-form-item>
            <el-form-item><el-checkbox v-model="sessionForm.allowReapply">允许重新报名</el-checkbox></el-form-item>
            <el-form-item><el-button :disabled="!canSessionControl" :loading="writeLoading" type="primary" @click="submitSession">创建场次</el-button></el-form-item>
          </el-form>
        </el-card>
        <el-card shadow="never">
          <template #header>
            <div class="toolbar-title">
              <span>场次列表</span>
              <el-space><el-input v-model="sessionFilters.activityVersionId" clearable placeholder="活动版本" /><el-select v-model="sessionFilters.status" clearable placeholder="状态"><el-option v-for="status in sessionStates" :key="status" :label="status" :value="status" /></el-select></el-space>
            </div>
          </template>
          <el-table v-loading="sessionsLoading" :data="sessions" empty-text="暂无场次，或后台读取 Interface 尚未交付">
            <el-table-column prop="sessionId" label="场次 ID" min-width="160" />
            <el-table-column prop="activityVersionId" label="活动版本" min-width="160" />
            <el-table-column label="状态" width="110"><template #default="{ row }"><el-tag :type="statusType(row.status)" effect="plain">{{ row.status }}</el-tag></template></el-table-column>
            <el-table-column label="容量" width="120"><template #default="{ row }">{{ row.confirmedCount || 0 }} / {{ row.capacity }}</template></el-table-column>
            <el-table-column prop="approvalMode" label="审核" width="90" />
            <el-table-column prop="sessionStartAt" label="开始时间" min-width="175" />
            <el-table-column label="操作" width="260" fixed="right">
              <template #default="{ row }">
                <el-space>
                  <el-button v-if="nextSessionState(row.status)" :disabled="!canSessionControl" size="small" type="primary" @click="advanceSession(row)">转为 {{ nextSessionState(row.status) }}</el-button>
                  <el-button v-if="!['CANCELED', 'ENDED'].includes(row.status)" :disabled="!canSessionControl" size="small" type="danger" @click="openCancel(row)">取消</el-button>
                </el-space>
              </template>
            </el-table-column>
          </el-table>
          <el-pagination
            v-if="sessionPagination.total > sessionPagination.pageSize"
            class="activity-pagination"
            :current-page="sessionPagination.page"
            :page-size="sessionPagination.pageSize"
            :total="sessionPagination.total"
            layout="total, prev, pager, next"
            @current-change="changeSessionPage"
          />
        </el-card>
      </el-tab-pane>

      <el-tab-pane :disabled="!canEnrollmentReview" label="报名审核" name="enrollments">
        <el-card shadow="never">
          <template #header>
            <div class="toolbar-title">
              <span>报名申请</span>
              <el-space wrap>
                <el-input v-model="enrollmentFilters.sessionId" clearable placeholder="场次 ID" />
                <el-select v-model="enrollmentFilters.status" clearable placeholder="状态"><el-option v-for="status in enrollmentStates" :key="status" :label="status" :value="status" /></el-select>
                <el-button :loading="enrollmentsLoading" @click="refreshEnrollments">刷新</el-button>
              </el-space>
            </div>
          </template>
          <el-alert :closable="false" class="workbench-alert" title="审核命令必须携带列表当前的 expectedAttemptGeneration。若用户重新报名，旧页面操作会被服务端拒绝。" type="info" />
          <el-table v-loading="enrollmentsLoading" :data="enrollments" empty-text="暂无报名，或后台读取 Interface 尚未交付">
            <el-table-column prop="enrollmentId" label="报名 ID" min-width="180" />
            <el-table-column prop="sessionId" label="场次 ID" min-width="160" />
            <el-table-column label="状态" width="110"><template #default="{ row }"><el-tag :type="statusType(row.status)" effect="plain">{{ row.status }}</el-tag></template></el-table-column>
            <el-table-column prop="attemptGeneration" label="申请代次" width="100" />
            <el-table-column prop="updatedAt" label="更新时间" min-width="175" />
            <el-table-column label="操作" width="210" fixed="right">
              <template #default="{ row }">
                <el-space v-if="row.status === 'PENDING'">
                  <el-button :disabled="!canEnrollmentReview" size="small" type="success" @click="reviewEnrollment(row, true)">通过</el-button>
                  <el-button :disabled="!canEnrollmentReview" size="small" type="danger" @click="reviewEnrollment(row, false)">拒绝</el-button>
                </el-space>
              </template>
            </el-table-column>
          </el-table>
          <el-pagination
            v-if="enrollmentPagination.total > enrollmentPagination.pageSize"
            class="activity-pagination"
            :current-page="enrollmentPagination.page"
            :page-size="enrollmentPagination.pageSize"
            :total="enrollmentPagination.total"
            layout="total, prev, pager, next"
            @current-change="changeEnrollmentPage"
          />
        </el-card>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="publishDialogVisible" title="活动发布 Gate" width="620px" @closed="resetPublishGate">
      <el-alert :closable="false" class="workbench-alert" title="Gate 默认关闭。这里只提交证据绑定，受信 Authorization Adapter 仍会校验主体、证据、版本和有效时间。" type="warning" show-icon />
      <el-form label-position="top" :model="publishForm">
        <el-form-item label="受控审批引用"><el-input v-model="publishForm.controlledApprovalRef" disabled /><span class="description-meta">值来自草稿 contentApprovalRef，不允许在发布时改写。</span></el-form-item>
        <el-form-item v-for="item in digestFields" :key="item.key" :label="item.label"><el-input v-model="publishForm[item.key]" placeholder="64 位 SHA-256" /></el-form-item>
        <el-checkbox v-model="publishGateAcknowledged">我确认四份证据与当前活动版本一致，且不含 UED 占位或未授权摄影素材。</el-checkbox>
      </el-form>
      <template #footer>
        <el-button @click="publishDialogVisible = false">取消</el-button>
        <el-button :disabled="!publishGateReady" :loading="writeLoading" type="primary" @click="submitPublish">提交受控发布</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="cancelDialogVisible" title="取消活动场次" width="520px" @closed="resetCancelForm">
      <el-form label-position="top" :model="cancelForm">
        <el-form-item label="取消原因"><el-select v-model="cancelForm.reason" style="width: 100%"><el-option v-for="reason in cancelReasons" :key="reason" :label="reason" :value="reason" /></el-select></el-form-item>
        <el-form-item v-if="cancelForm.reason === 'OTHER'" label="原因说明"><el-input v-model="cancelForm.reasonDetail" :rows="3" type="textarea" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="cancelDialogVisible = false">返回</el-button><el-button :disabled="!cancelForm.reason || (cancelForm.reason === 'OTHER' && !cancelForm.reasonDetail.trim())" :loading="writeLoading" type="danger" @click="submitCancel">确认取消</el-button></template>
    </el-dialog>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  archiveActivity,
  cancelActivitySession,
  createActivitySession,
  fetchActivities,
  fetchActivityEnrollments,
  fetchActivitySessions,
  publishActivity,
  requestActivityChanges,
  reviewActivityEnrollment,
  saveActivityDraft,
  submitActivityReview,
  unpublishActivity,
  updateActivitySessionState,
} from "./adminActivityApi";
import {
  activityCommandKey,
  createPendingActivityCommandRegistry,
} from "./pendingActivityCommands";
import { ADMIN_CAPABILITIES, useAdminAccess } from "../access";

const access = useAdminAccess();
const activeTab = ref("activities");
const activities = ref([]);
const sessions = ref([]);
const enrollments = ref([]);
const activitiesLoading = ref(false);
const sessionsLoading = ref(false);
const enrollmentsLoading = ref(false);
const writeLoading = ref(false);
const pendingRecords = ref([]);
const activityCommandRecoveryError = ref("");
const activityCommandRecoveryBlocked = ref(false);
const readErrorMap = reactive({ activities: "", sessions: "", enrollments: "" });
const readErrors = computed(() => Object.values(readErrorMap).filter(Boolean));

const definitionStates = ["DRAFT", "IN_REVIEW", "PUBLISHED", "UNPUBLISHED", "ARCHIVED"];
const sessionStates = ["SCHEDULED", "OPEN", "CLOSED", "CANCELED", "ENDED"];
const enrollmentStates = ["PENDING", "CONFIRMED", "REJECTED", "CANCELED"];
const cancelReasons = ["OPERATOR_CANCELED", "WEATHER", "VENUE", "FORCE_MAJEURE", "OTHER"];
const activityFilters = reactive({ search: "", status: "", page: 1, pageSize: 20 });
const sessionFilters = reactive({ activityVersionId: "", status: "", page: 1, pageSize: 20 });
const enrollmentFilters = reactive({ sessionId: "", status: "PENDING", page: 1, pageSize: 20 });
const activityPagination = reactive({ page: 1, pageSize: 20, total: 0 });
const sessionPagination = reactive({ page: 1, pageSize: 20, total: 0 });
const enrollmentPagination = reactive({ page: 1, pageSize: 20, total: 0 });

const canContentWrite = computed(() => access.has(ADMIN_CAPABILITIES.ACTIVITY_CONTENT_WRITE));
const canPublish = computed(() => access.has(ADMIN_CAPABILITIES.ACTIVITY_PUBLISH));
const canSessionControl = computed(() => access.has(ADMIN_CAPABILITIES.ACTIVITY_SESSION_CONTROL));
const canEnrollmentReview = computed(() => access.has(ADMIN_CAPABILITIES.ACTIVITY_ENROLLMENT_REVIEW));

function emptyDraft() {
  return {
    activityVersionId: "", activityId: "", version: 1, title: "", summary: "", detailVersion: "1",
    objective: "", audience: "", agenda: "", organizer: "", feeDescription: "", bringItems: "",
    cancelPolicy: "", privacyNoticeText: "", photographyNoticeText: "", contactDisplay: "",
    city: "", venueSummary: "", activityType: "", heroAssetRef: "", privacyNoticeRef: "",
    photographyNoticeRef: "", contentApprovalRef: "", contactOwnerSignerRef: "", visibility: "MEMBER",
    memberRequirement: "ROOT_MEMBER", source: "OPS_BACKEND",
  };
}
const draftForm = reactive(emptyDraft());
const sessionForm = reactive({ activityVersionId: "", capacity: 20, approvalMode: "AUTO", registrationOpenAt: "", registrationCloseAt: "", cancelCloseAt: "", reviewDeadline: "", sessionStartAt: "", sessionEndAt: "", allowReapply: false });

const publishDialogVisible = ref(false);
const publishTarget = ref(null);
const publishGateAcknowledged = ref(false);
const publishForm = reactive({ controlledApprovalRef: "", contentAuthorizationDigest: "", uedAcceptanceDigest: "", photographyAuthorizationDigest: "", artifactProvenanceDigest: "" });
const digestFields = [
  { key: "contentAuthorizationDigest", label: "活动内容授权摘要" },
  { key: "uedAcceptanceDigest", label: "UED 验收摘要" },
  { key: "photographyAuthorizationDigest", label: "摄影授权摘要" },
  { key: "artifactProvenanceDigest", label: "制品来源摘要" },
];
const digestPattern = /^[a-f0-9]{64}$/i;
const publishGateReady = computed(() => canPublish.value
  && publishGateAcknowledged.value
  && Boolean(publishTarget.value?.activityVersionId)
  && Boolean(publishForm.controlledApprovalRef)
  && digestFields.every((item) => digestPattern.test(publishForm[item.key])));

const cancelDialogVisible = ref(false);
const cancelTarget = ref(null);
const cancelForm = reactive({ reason: "", reasonDetail: "" });

function activityCommandStorage() {
  try { return window.localStorage; } catch (_) { return undefined; }
}

const pendingCommands = createPendingActivityCommandRegistry({ storage: activityCommandStorage() });
function syncPendingRecords() {
  try {
    pendingRecords.value = pendingCommands.list();
    if (!activityCommandRecoveryBlocked.value) activityCommandRecoveryError.value = "";
  } catch (_) {
    pendingRecords.value = [];
    activityCommandRecoveryBlocked.value = true;
    activityCommandRecoveryError.value = "活动写入恢复存储不可用；为避免重复写入，当前页面将拒绝新的活动管理操作。";
  }
}
const unsubscribePendingCommands = pendingCommands.subscribe(syncPendingRecords);

function listFrom(payload, key) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.[key])) return payload[key];
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function normalizeRows(rows) {
  return rows.map((row) => ({
    ...row,
    activityVersionId: row.activityVersionId || row.activity_version_id,
    activityId: row.activityId || row.activity_id,
    sessionId: row.sessionId || row.activity_session_id,
    enrollmentId: row.enrollmentId || row.activity_enrollment_id,
    attemptGeneration: row.attemptGeneration || row.attempt_generation,
  }));
}

function applyPagination(target, payload, filters) {
  const pagination = payload?.pagination || {};
  target.page = Number(pagination.page) || filters.page;
  target.pageSize = Number(pagination.pageSize) || filters.pageSize;
  target.total = Number(pagination.total) || 0;
}

async function loadActivities() {
  activitiesLoading.value = true;
  readErrorMap.activities = "";
  try {
    const payload = await fetchActivities(activityFilters);
    activities.value = normalizeRows(listFrom(payload, "activities"));
    applyPagination(activityPagination, payload, activityFilters);
    return activities.value;
  } catch (error) {
    activities.value = [];
    activityPagination.total = 0;
    readErrorMap.activities = `活动版本读取失败：${error.message}`;
  } finally { activitiesLoading.value = false; }
}

async function loadSessions() {
  sessionsLoading.value = true;
  readErrorMap.sessions = "";
  try {
    const payload = await fetchActivitySessions(sessionFilters);
    sessions.value = normalizeRows(listFrom(payload, "sessions"));
    applyPagination(sessionPagination, payload, sessionFilters);
    return sessions.value;
  } catch (error) {
    sessions.value = [];
    sessionPagination.total = 0;
    readErrorMap.sessions = `活动场次读取失败：${error.message}`;
  } finally { sessionsLoading.value = false; }
}

async function loadEnrollments() {
  if (!canEnrollmentReview.value) {
    enrollments.value = [];
    readErrorMap.enrollments = "";
    return;
  }
  enrollmentsLoading.value = true;
  readErrorMap.enrollments = "";
  try {
    const payload = await fetchActivityEnrollments(enrollmentFilters);
    enrollments.value = normalizeRows(listFrom(payload, "enrollments"));
    applyPagination(enrollmentPagination, payload, enrollmentFilters);
    return enrollments.value;
  } catch (error) {
    enrollments.value = [];
    enrollmentPagination.total = 0;
    readErrorMap.enrollments = `报名申请读取失败：${error.message}`;
  } finally { enrollmentsLoading.value = false; }
}

async function load() {
  const reads = [loadActivities(), loadSessions()];
  if (canEnrollmentReview.value) reads.push(loadEnrollments());
  await Promise.allSettled(reads);
}

function refreshActivities() { activityFilters.page = 1; return loadActivities(); }
function refreshSessions() { sessionFilters.page = 1; return loadSessions(); }
function refreshEnrollments() { enrollmentFilters.page = 1; return loadEnrollments(); }
function changeActivityPage(page) { activityFilters.page = page; return loadActivities(); }
function changeSessionPage(page) { sessionFilters.page = page; return loadSessions(); }
function changeEnrollmentPage(page) { enrollmentFilters.page = page; return loadEnrollments(); }

function containsUedPlaceholder(payload) {
  return Object.values(payload).some((value) => typeof value === "string" && /(PLACEHOLDER|占位)/i.test(value));
}

function assertDraftReady() {
  const required = ["activityId", "title", "summary", "objective", "audience", "agenda", "organizer", "feeDescription", "bringItems", "cancelPolicy", "privacyNoticeText", "photographyNoticeText", "contactDisplay", "detailVersion", "city", "venueSummary", "activityType", "heroAssetRef", "privacyNoticeRef", "photographyNoticeRef", "contentApprovalRef", "contactOwnerSignerRef"];
  const missing = required.filter((key) => !String(draftForm[key] || "").trim());
  if (missing.length) throw new Error(`请补齐字段：${missing.join(", ")}`);
  if (draftForm.visibility === "MEMBER" && !draftForm.memberRequirement.trim()) throw new Error("会员活动必须填写会员要求");
  if (draftForm.source !== "OPS_BACKEND" || containsUedPlaceholder(draftForm)) throw new Error("UED 占位或非 OPS_BACKEND 内容不可提交");
}

function activityCommandSpec(operation, payload) {
  const specs = {
    draft: { action: saveActivityDraft, reload: loadActivities },
    "submit-review": { action: submitActivityReview, reload: loadActivities },
    "request-changes": { action: requestActivityChanges, reload: loadActivities },
    publish: { action: publishActivity, reload: loadActivities },
    unpublish: { action: unpublishActivity, reload: loadActivities },
    archive: { action: archiveActivity, reload: loadActivities },
    "session-create": { action: createActivitySession, reload: loadSessions },
    "session-state": { action: updateActivitySessionState, reload: loadSessions },
    "session-cancel": { action: cancelActivitySession, reload: loadSessions },
    "enrollment-review": { action: reviewActivityEnrollment, reload: loadEnrollments },
  };
  const spec = specs[operation];
  if (!spec || !payload || typeof payload !== "object") throw new Error("ACTIVITY_PENDING_COMMAND_INVALID");
  return spec;
}

function sameDraft(authority, payload) {
  const keys = [
    "activityId", "version", "title", "summary", "objective", "audience", "agenda", "organizer",
    "feeDescription", "bringItems", "cancelPolicy", "privacyNoticeText", "photographyNoticeText",
    "contactDisplay", "detailVersion", "city", "venueSummary", "activityType", "heroAssetRef",
    "privacyNoticeRef", "photographyNoticeRef", "contentApprovalRef", "contactOwnerSignerRef",
    "visibility", "memberRequirement", "source",
  ];
  return keys.every((key) => String(authority?.[key] ?? "") === String(payload?.[key] ?? ""));
}

function commandReachedAdminAuthority(operation, payload) {
  if (operation === "draft") {
    return activities.value.some((row) => (
      (payload.activityVersionId ? row.activityVersionId === payload.activityVersionId : (
        row.activityId === payload.activityId && Number(row.version) === Number(payload.version)
      )) && sameDraft(row, payload)
    ));
  }
  const definitionState = {
    "submit-review": "IN_REVIEW",
    "request-changes": "DRAFT",
    publish: "PUBLISHED",
    unpublish: "UNPUBLISHED",
    archive: "ARCHIVED",
  }[operation];
  if (definitionState) {
    return activities.value.some((row) => row.activityVersionId === payload.activityVersionId && row.status === definitionState);
  }
  if (operation === "session-create") {
    return sessions.value.some((row) => row.activityVersionId === payload.activityVersionId
      && String(row.sessionStartAt || row.session_start_at) === String(payload.sessionStartAt));
  }
  if (operation === "session-state") {
    return sessions.value.some((row) => row.sessionId === payload.sessionId && row.status === payload.nextStatus);
  }
  if (operation === "session-cancel") {
    return sessions.value.some((row) => row.sessionId === payload.sessionId && row.status === "CANCELED");
  }
  if (operation === "enrollment-review") {
    const expected = payload.approve ? "CONFIRMED" : "REJECTED";
    return enrollments.value.some((row) => row.enrollmentId === payload.enrollmentId
      && Number(row.attemptGeneration) === Number(payload.expectedAttemptGeneration)
      && row.status === expected);
  }
  return false;
}

async function executeWrite(operation, payload, successMessage) {
  if (activityCommandRecoveryBlocked.value) {
    ElMessage.error(activityCommandRecoveryError.value || "活动写入恢复链路不可用，已拒绝本次操作。");
    return;
  }
  const commandKey = activityCommandKey(operation, payload);
  const spec = activityCommandSpec(operation, payload);
  let pending;
  try {
    pending = await pendingCommands.claim(commandKey, { operation, payload });
    activityCommandRecoveryBlocked.value = false;
    syncPendingRecords();
  } catch (_) {
    syncPendingRecords();
    ElMessage.error("无法取得跨标签写入锁或持久恢复记录，已拒绝本次操作。请保留页面并联系管理员检查浏览器存储策略。");
    return;
  }
  writeLoading.value = true;
  try {
    await spec.action(payload, pending.idempotencyKey);
    try {
      await pendingCommands.clear(commandKey, "write-confirmed");
    } catch (_) {
      activityCommandRecoveryBlocked.value = true;
      activityCommandRecoveryError.value = "后台已确认写入，但本机恢复记录无法清除。为防止误重试，活动管理写入已禁用；请保留幂等意图标识并联系管理员修复浏览器存储。";
      await spec.reload();
      ElMessage.error(activityCommandRecoveryError.value);
      return;
    }
    ElMessage.success(successMessage);
    await spec.reload();
  } catch (error) {
    if (!error.outcomeUnknown) {
      try {
        await pendingCommands.clear(commandKey, "definitive-error");
      } catch (_) {
        activityCommandRecoveryBlocked.value = true;
        activityCommandRecoveryError.value = "明确失败已返回，但本机恢复记录无法清除。为防止错误复用，活动管理写入已禁用。";
      }
    }
    await spec.reload();
    if (error.outcomeUnknown && commandReachedAdminAuthority(operation, payload)) {
      try {
        await pendingCommands.clear(commandKey, "authority-proved");
        ElMessage.success(`${successMessage}（已由权威记录证明）`);
      } catch (_) {
        activityCommandRecoveryBlocked.value = true;
        activityCommandRecoveryError.value = "权威记录已证明写入完成，但本机恢复记录无法清除。为防止误重试，活动管理写入已禁用。";
        ElMessage.error(activityCommandRecoveryError.value);
      }
    } else {
      ElMessage.error(error.outcomeUnknown
        ? "结果仍未确认：恢复记录已保留。请使用“复用原意图重试”或在确认风险后作废；审计可按幂等意图标识检索。"
        : error.message);
    }
  } finally {
    writeLoading.value = false;
    syncPendingRecords();
  }
}

async function retryPendingCommand(record) {
  await executeWrite(record.operation, record.payload, "待确认操作已完成");
}

async function voidPendingCommand(record) {
  try {
    await ElMessageBox.confirm(
      "作废仅移除本机恢复记录，不能撤销后台可能已完成的写入。确定后，再次执行相同操作会生成新的幂等意图。",
      "作废原幂等意图",
      { type: "error", confirmButtonText: "确认作废" },
    );
    await pendingCommands.clear(record.commandKey, "operator-voided");
    syncPendingRecords();
    ElMessage.warning("原意图已在本机作废；后台状态仍须通过权威读取或审计确认。下一次操作会生成新意图。");
  } catch (error) {
    if (error !== "cancel" && error !== "close") {
      activityCommandRecoveryBlocked.value = true;
      activityCommandRecoveryError.value = "原意图未能安全作废；活动管理写入已禁用，请保留审计检索标识并检查浏览器存储。";
      ElMessage.error(activityCommandRecoveryError.value);
    }
  }
}

async function submitDraft() {
  if (!canContentWrite.value) return ElMessage.warning(access.reason(ADMIN_CAPABILITIES.ACTIVITY_CONTENT_WRITE));
  try { assertDraftReady(); } catch (error) { return ElMessage.warning(error.message); }
  const payload = { ...draftForm, activityVersionId: draftForm.activityVersionId || undefined, source: "OPS_BACKEND" };
  await executeWrite("draft", payload, "草稿已保存");
}

function resetDraft() { Object.assign(draftForm, emptyDraft()); }
function editDraft(row) {
  Object.assign(draftForm, emptyDraft(), row, { source: "OPS_BACKEND" });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function submitForReview(row) {
  await executeWrite("submit-review", { activityVersionId: row.activityVersionId }, "已提交审核");
}

async function returnForChanges(row) {
  try {
    const { value } = await ElMessageBox.prompt("填写必须修改的具体原因", "退回活动", { inputValidator: (value) => Boolean(String(value || "").trim()) || "原因不能为空" });
    await executeWrite("request-changes", { activityVersionId: row.activityVersionId, reason: value.trim() }, "已退回修改");
  } catch (error) { if (error !== "cancel" && error !== "close") ElMessage.error(error.message || String(error)); }
}

function openPublish(row) {
  publishTarget.value = row;
  publishForm.controlledApprovalRef = row.contentApprovalRef || row.content_approval_ref || "";
  publishDialogVisible.value = true;
}

function resetPublishGate() {
  publishTarget.value = null;
  publishGateAcknowledged.value = false;
  Object.keys(publishForm).forEach((key) => { publishForm[key] = ""; });
}

async function submitPublish() {
  if (!publishGateReady.value) return ElMessage.warning("发布 Gate 未满足，请补齐并确认全部授权证据");
  const payload = { activityVersionId: publishTarget.value.activityVersionId, ...publishForm };
  await executeWrite("publish", payload, "活动已提交受控发布");
  publishDialogVisible.value = false;
}

async function withdraw(row) {
  try {
    const { value } = await ElMessageBox.prompt("填写下架原因", "下架已发布活动", { type: "warning", inputValidator: (value) => Boolean(String(value || "").trim()) || "原因不能为空" });
    await executeWrite("unpublish", { activityVersionId: row.activityVersionId, reason: value.trim() }, "活动已下架");
  } catch (error) { if (error !== "cancel" && error !== "close") ElMessage.error(error.message || String(error)); }
}

async function archive(row) {
  try {
    const { value } = await ElMessageBox.prompt("归档不可用于恢复发布，请填写原因", "归档活动", { type: "error", confirmButtonText: "确认归档", inputValidator: (value) => Boolean(String(value || "").trim()) || "原因不能为空" });
    await executeWrite("archive", { activityVersionId: row.activityVersionId, reason: value.trim() }, "活动已归档");
  } catch (error) { if (error !== "cancel" && error !== "close") ElMessage.error(error.message || String(error)); }
}

async function submitSession() {
  if (!canSessionControl.value) return ElMessage.warning(access.reason(ADMIN_CAPABILITIES.ACTIVITY_SESSION_CONTROL));
  const required = ["activityVersionId", "registrationOpenAt", "registrationCloseAt", "cancelCloseAt", "sessionStartAt", "sessionEndAt"];
  if (required.some((key) => !sessionForm[key]) || (sessionForm.approvalMode === "MANUAL" && !sessionForm.reviewDeadline)) return ElMessage.warning("请补齐场次时间和活动版本");
  await executeWrite("session-create", { ...sessionForm }, "场次已创建");
}

function nextSessionState(status) { return ({ SCHEDULED: "OPEN", OPEN: "CLOSED", CLOSED: "ENDED" })[status] || ""; }
async function advanceSession(row) {
  const nextStatus = nextSessionState(row.status);
  if (!nextStatus) return;
  try {
    await ElMessageBox.confirm(`确认将场次从 ${row.status} 转为 ${nextStatus}？`, "更新场次状态", { type: "warning" });
    await executeWrite("session-state", { sessionId: row.sessionId, nextStatus }, "场次状态已更新");
  } catch (error) { if (error !== "cancel" && error !== "close") ElMessage.error(error.message || String(error)); }
}

function openCancel(row) { cancelTarget.value = row; cancelDialogVisible.value = true; }
function resetCancelForm() { cancelTarget.value = null; cancelForm.reason = ""; cancelForm.reasonDetail = ""; }
async function submitCancel() {
  if (!cancelTarget.value) return;
  await executeWrite("session-cancel", { sessionId: cancelTarget.value.sessionId, ...cancelForm }, "场次已取消");
  cancelDialogVisible.value = false;
}

async function reviewEnrollment(row, approve) {
  try {
    await ElMessageBox.confirm(`确认${approve ? "通过" : "拒绝"}申请代次 ${row.attemptGeneration}？`, "审核报名", { type: approve ? "success" : "warning" });
    await executeWrite("enrollment-review", { enrollmentId: row.enrollmentId, expectedAttemptGeneration: row.attemptGeneration, approve }, "报名审核已完成");
  } catch (error) { if (error !== "cancel" && error !== "close") ElMessage.error(error.message || String(error)); }
}

function statusType(status) {
  if (["PUBLISHED", "OPEN", "CONFIRMED", "ENDED"].includes(status)) return "success";
  if (["IN_REVIEW", "PENDING", "SCHEDULED"].includes(status)) return "warning";
  if (["ARCHIVED", "CANCELED", "REJECTED"].includes(status)) return "danger";
  return "info";
}

defineExpose({ load });
onMounted(() => { syncPendingRecords(); load(); });
onBeforeUnmount(unsubscribePendingCommands);
</script>

<style scoped>
.activity-workbench { min-width: 0; }
.activity-inline-form :deep(.el-input), .activity-inline-form :deep(.el-select) { width: 180px; }
.activity-inline-form :deep(.el-date-editor) { width: 220px; }
.activity-workbench :deep(.el-card) { margin-bottom: 14px; }
.activity-workbench :deep(.el-form-item) { margin-bottom: 14px; }
.activity-pagination { justify-content: flex-end; margin-top: 14px; }
.pending-command-card { margin-bottom: 14px; }
.pending-command-card code { overflow-wrap: anywhere; }
</style>
