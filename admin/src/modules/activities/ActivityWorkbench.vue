<template>
  <section class="workbench activity-workbench">
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

    <el-row :gutter="12" class="activity-summary">
      <el-col :span="8"><el-card shadow="never"><span>活动版本</span><strong>{{ activityPagination.total }}</strong></el-card></el-col>
      <el-col :span="8"><el-card shadow="never"><span>近期场次</span><strong>{{ sessionPagination.total }}</strong></el-card></el-col>
      <el-col :span="8"><el-card shadow="never"><span>待处理报名</span><strong>{{ pendingEnrollmentCount }}</strong></el-card></el-col>
    </el-row>

    <el-tabs v-model="activeTab" class="workbench-tabs">
      <el-tab-pane label="活动管理" name="activities">
        <el-card shadow="never">
          <template #header>
            <div class="activity-page-heading">
              <div><strong>活动管理</strong><p>维护活动内容、发布状态和场次安排</p></div>
              <el-button :disabled="!canContentWrite" type="primary" @click="openNewDraft">新建活动</el-button>
            </div>
          </template>
          <div class="activity-filter-bar">
            <el-input v-model="activityFilters.search" clearable placeholder="搜索活动标题或 ID" @keyup.enter="refreshActivities" />
            <el-select v-model="activityFilters.status" clearable placeholder="全部状态">
              <el-option v-for="status in definitionStates" :key="status" :label="statusLabel(status)" :value="status" />
            </el-select>
            <el-button :loading="activitiesLoading" @click="refreshActivities">查询</el-button>
          </div>
          <el-table v-loading="activitiesLoading" :data="activities" empty-text="暂无活动">
            <el-table-column label="活动" min-width="260">
              <template #default="{ row }">
                <div class="table-title">{{ row.title || row.activityId }}</div>
                <div class="table-meta">{{ row.summary || `${row.activityId} / v${row.version}` }}</div>
              </template>
            </el-table-column>
            <el-table-column label="地点" min-width="140"><template #default="{ row }">{{ [row.city, row.venueSummary].filter(Boolean).join(' · ') || '—' }}</template></el-table-column>
            <el-table-column label="状态" width="112"><template #default="{ row }"><el-tag :type="statusType(row.status)" effect="plain">{{ statusLabel(row.status) }}</el-tag></template></el-table-column>
            <el-table-column label="可见范围" width="110"><template #default="{ row }">{{ row.visibility === 'PUBLIC' ? '公开' : '会员' }}</template></el-table-column>
            <el-table-column label="更新时间" min-width="170"><template #default="{ row }">{{ formatDateTime(row.updatedAt) }}</template></el-table-column>
            <el-table-column label="操作" min-width="300" fixed="right" align="right">
              <template #default="{ row }">
                <el-space wrap>
                  <el-button v-if="row.status === 'DRAFT'" link type="primary" @click="editDraft(row)">编辑</el-button>
                  <el-button v-if="row.status === 'DRAFT'" :disabled="!canContentWrite" link type="primary" @click="submitForReview(row)">提交审核</el-button>
                  <el-button v-if="row.status === 'IN_REVIEW'" :disabled="!canContentWrite" link @click="returnForChanges(row)">退回</el-button>
                  <el-button v-if="row.status === 'IN_REVIEW'" :disabled="!canPublish" link type="success" @click="openPublish(row)">发布</el-button>
                  <el-button v-if="row.status === 'PUBLISHED'" :disabled="!canPublish" link type="warning" @click="withdraw(row)">下架</el-button>
                  <el-button v-if="row.status === 'UNPUBLISHED'" :disabled="!canPublish" link type="danger" @click="archive(row)">归档</el-button>
                </el-space>
              </template>
            </el-table-column>
          </el-table>
          <el-pagination v-if="activityPagination.total > activityPagination.pageSize" class="activity-pagination" :current-page="activityPagination.page" :page-size="activityPagination.pageSize" :total="activityPagination.total" layout="total, prev, pager, next" @current-change="changeActivityPage" />
        </el-card>

        <el-card shadow="never">
          <template #header>
            <div class="activity-page-heading">
              <div><strong>场次安排</strong><p>设置报名时间、人数和现场安排</p></div>
              <el-button :disabled="!canSessionControl" type="primary" plain @click="sessionDrawerVisible = true">新建场次</el-button>
            </div>
          </template>
          <div class="activity-filter-bar">
            <el-input v-model="sessionFilters.activityVersionId" clearable placeholder="活动版本 ID" @keyup.enter="refreshSessions" />
            <el-select v-model="sessionFilters.status" clearable placeholder="全部状态"><el-option v-for="status in sessionStates" :key="status" :label="statusLabel(status)" :value="status" /></el-select>
            <el-button :loading="sessionsLoading" @click="refreshSessions">查询</el-button>
          </div>
          <el-table v-loading="sessionsLoading" :data="sessions" empty-text="暂无场次">
            <el-table-column label="活动" min-width="220"><template #default="{ row }"><div class="table-title">{{ row.activityTitle || row.activityVersionId }}</div><div class="table-meta">{{ row.sessionId }}</div></template></el-table-column>
            <el-table-column label="开始时间" min-width="170"><template #default="{ row }">{{ formatDateTime(row.sessionStartAt) }}</template></el-table-column>
            <el-table-column label="状态" width="110"><template #default="{ row }"><el-tag :type="statusType(row.status)" effect="plain">{{ statusLabel(row.status) }}</el-tag></template></el-table-column>
            <el-table-column label="报名人数" width="110"><template #default="{ row }">{{ row.confirmedCount || 0 }} / {{ row.capacity }}</template></el-table-column>
            <el-table-column label="确认方式" width="100"><template #default="{ row }">{{ row.approvalMode === 'AUTO' ? '自动' : '人工' }}</template></el-table-column>
            <el-table-column label="操作" width="230" fixed="right" align="right"><template #default="{ row }"><el-space><el-button v-if="nextSessionState(row.status)" :disabled="!canSessionControl" link type="primary" @click="advanceSession(row)">转为{{ statusLabel(nextSessionState(row.status)) }}</el-button><el-button v-if="!['CANCELED', 'ENDED'].includes(row.status)" :disabled="!canSessionControl" link type="danger" @click="openCancel(row)">取消</el-button></el-space></template></el-table-column>
          </el-table>
          <el-pagination v-if="sessionPagination.total > sessionPagination.pageSize" class="activity-pagination" :current-page="sessionPagination.page" :page-size="sessionPagination.pageSize" :total="sessionPagination.total" layout="total, prev, pager, next" @current-change="changeSessionPage" />
        </el-card>
      </el-tab-pane>

      <el-tab-pane :disabled="!canEnrollmentReview" label="报名管理" name="enrollments">
        <el-card shadow="never">
          <template #header>
            <div class="activity-page-heading">
              <div><strong>报名管理</strong><p>查看报名状态并处理需要人工确认的申请</p></div>
            </div>
          </template>
          <div class="activity-filter-bar activity-filter-bar--wide">
            <el-input v-model="enrollmentFilters.activityId" clearable placeholder="活动 ID" @keyup.enter="refreshEnrollments" />
            <el-input v-model="enrollmentFilters.sessionId" clearable placeholder="场次 ID" @keyup.enter="refreshEnrollments" />
            <el-select v-model="enrollmentFilters.status" clearable placeholder="全部状态"><el-option v-for="status in enrollmentStates" :key="status" :label="statusLabel(status)" :value="status" /></el-select>
            <el-button :loading="enrollmentsLoading" @click="refreshEnrollments">查询</el-button>
          </div>
          <el-table v-loading="enrollmentsLoading" :data="enrollments" empty-text="暂无报名记录">
            <el-table-column label="活动" min-width="220"><template #default="{ row }"><div class="table-title">{{ row.activityTitle || row.activityId }}</div><div class="table-meta">{{ row.sessionId }}</div></template></el-table-column>
            <el-table-column label="会员" min-width="190"><template #default="{ row }"><div>{{ row.memberNickname || 'Root用户' }}</div><div class="table-meta">{{ row.memberContact || row.rootUserId }}</div></template></el-table-column>
            <el-table-column label="活动时间" min-width="170"><template #default="{ row }">{{ formatDateTime(row.sessionStartAt) }}</template></el-table-column>
            <el-table-column label="状态" width="110"><template #default="{ row }"><el-tag :type="statusType(row.status)" effect="plain">{{ statusLabel(row.status) }}</el-tag></template></el-table-column>
            <el-table-column label="更新时间" min-width="170"><template #default="{ row }">{{ formatDateTime(row.updatedAt) }}</template></el-table-column>
            <el-table-column label="操作" width="150" fixed="right" align="right">
              <template #default="{ row }">
                <el-space v-if="row.status === 'PENDING'">
                  <el-button :disabled="!canEnrollmentReview" link type="success" @click="reviewEnrollment(row, true)">通过</el-button>
                  <el-button :disabled="!canEnrollmentReview" link type="danger" @click="reviewEnrollment(row, false)">拒绝</el-button>
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

    <el-drawer v-model="draftDrawerVisible" :title="draftForm.activityVersionId ? '编辑活动' : '新建活动'" size="720px" @closed="resetDraft">
      <el-form label-position="top" :model="draftForm" class="activity-drawer-form">
        <el-row :gutter="12"><el-col :span="16"><el-form-item label="活动 ID"><el-input v-model="draftForm.activityId" /></el-form-item></el-col><el-col :span="8"><el-form-item label="版本"><el-input-number v-model="draftForm.version" :min="1" /></el-form-item></el-col></el-row>
        <el-form-item label="标题"><el-input v-model="draftForm.title" /></el-form-item>
        <el-form-item label="摘要"><el-input v-model="draftForm.summary" :rows="2" type="textarea" /></el-form-item>
        <el-row :gutter="12"><el-col :span="12"><el-form-item label="城市"><el-input v-model="draftForm.city" /></el-form-item></el-col><el-col :span="12"><el-form-item label="场地"><el-input v-model="draftForm.venueSummary" /></el-form-item></el-col></el-row>
        <el-row :gutter="12"><el-col :span="12"><el-form-item label="活动类型"><el-input v-model="draftForm.activityType" /></el-form-item></el-col><el-col :span="12"><el-form-item label="主办方"><el-input v-model="draftForm.organizer" /></el-form-item></el-col></el-row>
        <el-form-item label="活动目标"><el-input v-model="draftForm.objective" :rows="3" type="textarea" /></el-form-item>
        <el-form-item label="适合人群"><el-input v-model="draftForm.audience" :rows="3" type="textarea" /></el-form-item>
        <el-form-item label="活动流程"><el-input v-model="draftForm.agenda" :rows="4" type="textarea" /></el-form-item>
        <el-row :gutter="12"><el-col :span="12"><el-form-item label="费用说明"><el-input v-model="draftForm.feeDescription" /></el-form-item></el-col><el-col :span="12"><el-form-item label="用户可见联系人"><el-input v-model="draftForm.contactDisplay" /></el-form-item></el-col></el-row>
        <el-form-item label="携带物品"><el-input v-model="draftForm.bringItems" :rows="2" type="textarea" /></el-form-item>
        <el-form-item label="取消规则"><el-input v-model="draftForm.cancelPolicy" :rows="2" type="textarea" /></el-form-item>
        <el-form-item label="报名隐私说明"><el-input v-model="draftForm.privacyNoticeText" :rows="2" type="textarea" /></el-form-item>
        <el-form-item label="现场摄影说明"><el-input v-model="draftForm.photographyNoticeText" :rows="2" type="textarea" /></el-form-item>
        <el-form-item label="主视觉素材引用"><el-input v-model="draftForm.heroAssetRef" placeholder="asset://..." /></el-form-item>
        <el-collapse class="activity-advanced-fields"><el-collapse-item title="内容引用与可见范围" name="references">
          <el-row :gutter="12"><el-col :span="12"><el-form-item label="详情版本"><el-input v-model="draftForm.detailVersion" /></el-form-item></el-col><el-col :span="12"><el-form-item label="可见范围"><el-select v-model="draftForm.visibility" style="width:100%"><el-option label="公开" value="PUBLIC" /><el-option label="会员" value="MEMBER" /></el-select></el-form-item></el-col></el-row>
          <el-form-item v-if="draftForm.visibility === 'MEMBER'" label="会员要求"><el-input v-model="draftForm.memberRequirement" /></el-form-item>
          <el-form-item label="隐私告知引用"><el-input v-model="draftForm.privacyNoticeRef" /></el-form-item>
          <el-form-item label="摄影告知引用"><el-input v-model="draftForm.photographyNoticeRef" /></el-form-item>
          <el-form-item label="内容审批引用"><el-input v-model="draftForm.contentApprovalRef" /></el-form-item>
          <el-form-item label="联系负责人引用"><el-input v-model="draftForm.contactOwnerSignerRef" /></el-form-item>
        </el-collapse-item></el-collapse>
      </el-form>
      <template #footer><div class="drawer-footer"><span v-if="!canContentWrite" class="description-meta">{{ access.reason(ADMIN_CAPABILITIES.ACTIVITY_CONTENT_WRITE) }}</span><el-button @click="draftDrawerVisible = false">取消</el-button><el-button :disabled="!canContentWrite" :loading="writeLoading" type="primary" @click="submitDraft">保存草稿</el-button></div></template>
    </el-drawer>

    <el-drawer v-model="sessionDrawerVisible" title="新建场次" size="620px">
      <el-form label-position="top" :model="sessionForm" class="activity-drawer-form">
        <el-form-item label="活动版本"><el-input v-model="sessionForm.activityVersionId" placeholder="活动版本 ID" /></el-form-item>
        <el-row :gutter="12"><el-col :span="12"><el-form-item label="人数上限"><el-input-number v-model="sessionForm.capacity" :min="1" /></el-form-item></el-col><el-col :span="12"><el-form-item label="报名确认"><el-select v-model="sessionForm.approvalMode" style="width:100%"><el-option label="自动确认" value="AUTO" /><el-option label="人工确认" value="MANUAL" /></el-select></el-form-item></el-col></el-row>
        <el-form-item label="报名开始"><el-date-picker v-model="sessionForm.registrationOpenAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ssZ" style="width:100%" /></el-form-item>
        <el-form-item label="报名截止"><el-date-picker v-model="sessionForm.registrationCloseAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ssZ" style="width:100%" /></el-form-item>
        <el-form-item label="取消截止"><el-date-picker v-model="sessionForm.cancelCloseAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ssZ" style="width:100%" /></el-form-item>
        <el-form-item v-if="sessionForm.approvalMode === 'MANUAL'" label="审核截止"><el-date-picker v-model="sessionForm.reviewDeadline" type="datetime" value-format="YYYY-MM-DDTHH:mm:ssZ" style="width:100%" /></el-form-item>
        <el-form-item label="活动开始"><el-date-picker v-model="sessionForm.sessionStartAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ssZ" style="width:100%" /></el-form-item>
        <el-form-item label="活动结束"><el-date-picker v-model="sessionForm.sessionEndAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ssZ" style="width:100%" /></el-form-item>
        <el-checkbox v-model="sessionForm.allowReapply">取消后允许重新报名</el-checkbox>
      </el-form>
      <template #footer><div class="drawer-footer"><el-button @click="sessionDrawerVisible = false">取消</el-button><el-button :disabled="!canSessionControl" :loading="writeLoading" type="primary" @click="submitSession">创建场次</el-button></div></template>
    </el-drawer>

    <el-dialog v-model="publishDialogVisible" title="发布活动" width="620px" @closed="resetPublishGate">
      <el-alert :closable="false" class="workbench-alert" title="当前正式素材授权尚未接入，发布前请核对以下内容引用。" type="warning" show-icon />
      <el-form label-position="top" :model="publishForm">
        <el-form-item label="受控审批引用"><el-input v-model="publishForm.controlledApprovalRef" disabled /><span class="description-meta">值来自草稿 contentApprovalRef，不允许在发布时改写。</span></el-form-item>
        <el-form-item v-for="item in digestFields" :key="item.key" :label="item.label"><el-input v-model="publishForm[item.key]" placeholder="64 位 SHA-256" /></el-form-item>
        <el-checkbox v-model="publishGateAcknowledged">我确认当前活动内容和素材引用已完成内部核对。</el-checkbox>
      </el-form>
      <template #footer>
        <el-button @click="publishDialogVisible = false">取消</el-button>
        <el-button :disabled="!publishGateReady" :loading="writeLoading" type="primary" @click="submitPublish">确认发布</el-button>
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
const draftDrawerVisible = ref(false);
const sessionDrawerVisible = ref(false);
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
const enrollmentFilters = reactive({ activityId: "", sessionId: "", status: "PENDING", page: 1, pageSize: 20 });
const activityPagination = reactive({ page: 1, pageSize: 20, total: 0 });
const sessionPagination = reactive({ page: 1, pageSize: 20, total: 0 });
const enrollmentPagination = reactive({ page: 1, pageSize: 20, total: 0 });

const canContentWrite = computed(() => access.has(ADMIN_CAPABILITIES.ACTIVITY_CONTENT_WRITE));
const canPublish = computed(() => access.has(ADMIN_CAPABILITIES.ACTIVITY_PUBLISH));
const canSessionControl = computed(() => access.has(ADMIN_CAPABILITIES.ACTIVITY_SESSION_CONTROL));
const canEnrollmentReview = computed(() => access.has(ADMIN_CAPABILITIES.ACTIVITY_ENROLLMENT_REVIEW));
const pendingEnrollmentCount = computed(() => (
  enrollmentFilters.status === "PENDING"
    ? enrollmentPagination.total
    : enrollments.value.filter((row) => row.status === "PENDING").length
));

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
function openNewDraft() {
  resetDraft();
  draftDrawerVisible.value = true;
}
function editDraft(row) {
  Object.assign(draftForm, emptyDraft(), row, { source: "OPS_BACKEND" });
  draftDrawerVisible.value = true;
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

function statusLabel(status) {
  return ({
    DRAFT: "草稿", IN_REVIEW: "审核中", PUBLISHED: "已发布", UNPUBLISHED: "已下架", ARCHIVED: "已归档",
    SCHEDULED: "待开放", OPEN: "报名中", CLOSED: "报名结束", CANCELED: "已取消", ENDED: "已结束",
    PENDING: "待确认", CONFIRMED: "已确认", REJECTED: "已拒绝",
  })[status] || status || "—";
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date).replaceAll("/", "-");
}

defineExpose({ load });
onMounted(() => { syncPendingRecords(); load(); });
onBeforeUnmount(unsubscribePendingCommands);
</script>

<style scoped>
.activity-workbench { min-width: 0; overflow: hidden; }
.activity-workbench .workbench-tabs { min-width: 0; }
.activity-workbench :deep(.el-tabs__content),
.activity-workbench :deep(.el-tab-pane),
.activity-workbench :deep(.el-card),
.activity-workbench :deep(.el-card__body) { min-width: 0; }
.activity-workbench :deep(.el-table) { width: 100%; }
.activity-workbench :deep(.el-card) { margin-bottom: 14px; }
.activity-workbench :deep(.el-form-item) { margin-bottom: 14px; }
.activity-pagination { justify-content: flex-end; margin-top: 14px; }
.pending-command-card { margin-bottom: 14px; }
.pending-command-card code { overflow-wrap: anywhere; }
.activity-summary :deep(.el-card__body) { display: flex; align-items: center; justify-content: space-between; min-height: 86px; }
.activity-summary span { color: var(--root-muted); font-size: 14px; }
.activity-summary strong { color: var(--root-ink); font-size: 30px; font-weight: 600; }
.activity-page-heading { display: flex; align-items: center; justify-content: space-between; gap: 24px; }
.activity-page-heading strong { color: var(--root-ink); font-size: 17px; }
.activity-page-heading p { margin: 6px 0 0; color: var(--root-muted); font-size: 13px; }
.activity-filter-bar { display: grid; grid-template-columns: minmax(260px, 1fr) 156px auto; gap: 10px; margin-bottom: 16px; }
.activity-filter-bar--wide { grid-template-columns: minmax(180px, .8fr) minmax(240px, 1fr) 156px auto; }
.activity-drawer-form { padding: 0 4px 24px; }
.activity-advanced-fields { margin-top: 8px; }
.drawer-footer { display: flex; align-items: center; justify-content: flex-end; gap: 10px; width: 100%; }
.drawer-footer .description-meta { margin: 0 auto 0 0; }
</style>
