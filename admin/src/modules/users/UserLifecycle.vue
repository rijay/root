<template>
  <section class="workbench">
    <el-alert
      v-if="errorMessage"
      :closable="false"
      :title="errorMessage"
      class="workbench-alert"
      type="error"
    />

    <el-row :gutter="12" class="metric-row">
      <el-col v-for="metric in metricCards" :key="metric.key" :span="metricSpan">
        <el-card class="metric-card" shadow="never">
          <span>{{ metric.label }}</span>
          <strong>{{ metric.value }}</strong>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never">
      <template #header>
        <div class="toolbar-title">
          <span>用户生命周期</span>
          <el-space class="filter-space" wrap>
            <el-select v-model="selectedPresetId" clearable placeholder="常用筛选" @change="applySelectedPreset">
              <el-option v-for="preset in filterPresets" :key="preset.presetId" :label="presetOptionLabel(preset)" :value="preset.presetId">
                <span>{{ preset.title }}</span>
                <el-tag v-if="preset.scope === 'TEAM'" class="option-tag" effect="plain" size="small">团队</el-tag>
                <el-tag v-if="preset.pinned" class="option-tag" effect="plain" size="small" type="warning">置顶</el-tag>
              </el-option>
            </el-select>
            <el-input v-model="presetForm.title" clearable placeholder="筛选名称" @keyup.enter="saveCurrentPreset" />
            <el-checkbox v-model="presetForm.teamShared">团队共享</el-checkbox>
            <el-checkbox v-model="presetForm.pinned">置顶</el-checkbox>
            <el-input-number v-model="presetForm.sortOrder" :min="0" :max="999" />
            <el-button :loading="presetLoading.save" @click="saveCurrentPreset">保存筛选</el-button>
            <el-button :disabled="!selectedPresetId" :loading="presetLoading.copy" @click="copySelectedPreset">复制筛选</el-button>
            <el-button :disabled="!selectedPresetId || selectedPresetReadonly" :loading="presetLoading.delete" @click="deleteSelectedPreset">删除筛选</el-button>
            <el-input v-model="filters.keyword" clearable placeholder="搜索 root_user_id / unionid / openid" @keyup.enter="load" />
            <el-select v-model="filters.unionidStatus" clearable placeholder="UnionID">
              <el-option label="已打通" value="LINKED" />
              <el-option label="待补链" value="PENDING" />
            </el-select>
            <el-select v-model="filters.state" clearable placeholder="用户状态">
              <el-option label="未完成画像" value="UNREGISTERED" />
              <el-option label="待启动" value="REGISTERED_IDLE" />
              <el-option label="打卡中" value="CHECKIN_ACTIVE" />
              <el-option label="已完成" value="CHECKIN_COMPLETED" />
              <el-option label="日常记录" value="DAILY_USER" />
            </el-select>
            <el-input v-model="filters.campaignId" clearable placeholder="活动 ID" @keyup.enter="load" />
            <el-select v-model="filters.taskProgress" clearable placeholder="任务进度">
              <el-option label="未开始" value="NOT_STARTED" />
              <el-option label="进行中" value="IN_PROGRESS" />
              <el-option label="已完成" value="COMPLETED" />
              <el-option label="可结算" value="SETTLEMENT_READY" />
            </el-select>
            <el-select v-model="filters.consultationStatus" clearable placeholder="咨询状态">
              <el-option label="待跟进" value="PENDING" />
              <el-option label="已跟进" value="HANDLED" />
              <el-option label="仅记录" value="RECORDED" />
              <el-option label="无咨询" value="NONE" />
            </el-select>
            <el-select v-model="filters.settlementStatus" clearable placeholder="结算状态">
              <el-option label="可结算" value="SETTLEMENT_READY" />
              <el-option label="结算通过" value="QUALIFIED" />
              <el-option label="待复核" value="PENDING_REVIEW" />
              <el-option label="未结算" value="NOT_SETTLED" />
            </el-select>
            <el-select v-model="filters.rewardStatus" clearable placeholder="奖励状态">
              <el-option label="待处理" value="PENDING" />
              <el-option label="已发放" value="DELIVERED" />
              <el-option label="待复核" value="PENDING_REVIEW" />
              <el-option label="待发放" value="PENDING_DELIVERY" />
              <el-option label="无奖励" value="NONE" />
            </el-select>
            <el-select v-model="filters.openTasks" clearable placeholder="待办">
              <el-option label="有待办" value="HAS_OPEN_TASKS" />
              <el-option label="无待办" value="NO_OPEN_TASKS" />
            </el-select>
            <el-select v-model="filters.severity" clearable placeholder="严重度">
              <el-option label="高" value="HIGH" />
              <el-option label="中" value="MEDIUM" />
              <el-option label="低" value="LOW" />
            </el-select>
            <el-input v-model="filters.blockage" clearable placeholder="当前卡点" @keyup.enter="load" />
            <el-input-number v-model="filters.limit" :min="20" :max="200" />
            <el-button type="primary" @click="load">查询</el-button>
            <el-button @click="resetFilters">重置</el-button>
            <el-button :loading="exportLoading" @click="downloadCsv">导出 CSV</el-button>
            <el-button :loading="exportRecordLoading.create" @click="createLifecycleUserExportRecord">生成导出记录</el-button>
            <el-button :loading="exportRecordLoading.list" @click="openLifecycleUserExports">导出记录</el-button>
            <el-button :loading="advisorWorkbenchLoading" @click="openAdvisorWorkbench">顾问工作台</el-button>
          </el-space>
        </div>
      </template>

      <div class="batch-action-strip">
        <el-space wrap>
          <span class="table-meta">当前列表 {{ users.length }} 人 / 命中 {{ totalUsers }} 人</span>
          <span class="table-meta">可结算 {{ settlementReadyCount }} 人</span>
          <el-input v-model="batchSettlementForm.campaignId" clearable placeholder="活动 ID" />
          <el-input v-model="batchSettlementForm.requestId" clearable placeholder="request_id" />
          <span class="table-meta">筛选全量上限</span>
          <el-input-number v-model="batchSettlementForm.selectionLimit" :min="1" :max="1000" />
          <span class="table-meta">每批</span>
          <el-input-number v-model="batchSettlementForm.batchSize" :min="1" :max="100" />
          <el-checkbox v-model="batchSettlementForm.confirmRisk">已确认批量结算影响和奖励预算</el-checkbox>
          <el-button :loading="batchLoading.preview" @click="previewBatchSettlement">当前列表预览</el-button>
          <el-button
            :disabled="!canSettlementExecute"
            :loading="batchLoading.execute"
            :title="settlementExecuteTitle"
            type="primary"
            @click="executeBatchSettlement"
          >
            当前列表执行
          </el-button>
          <el-button :loading="batchLoading.filterPreview" @click="previewFilterBatchSettlement">筛选预览</el-button>
          <el-button
            :disabled="!canSettlementExecute"
            :loading="batchLoading.filterExecute"
            :title="settlementExecuteTitle"
            type="primary"
            @click="executeFilterBatchSettlement"
          >
            筛选执行
          </el-button>
          <el-button
            :disabled="!canSettlementExecute"
            :loading="jobLoading.create"
            :title="settlementExecuteTitle"
            @click="createFilterSettlementJob"
          >
            创建队列
          </el-button>
          <el-button :loading="jobLoading.list" @click="openSettlementJobs">查看队列</el-button>
        </el-space>
      </div>

      <el-table :data="users" height="560" @row-click="selectUser">
        <el-table-column prop="rootUserId" label="root_user_id" min-width="180" />
        <el-table-column label="用户" min-width="150">
          <template #default="{ row }">
            <div class="table-title">{{ row.nickname }}</div>
            <div class="table-meta">{{ row.phone || row.verifiedPhone || "未授权手机号" }}</div>
          </template>
        </el-table-column>
        <el-table-column label="UnionID" width="110">
          <template #default="{ row }">
            <el-tag :type="row.unionidStatus === 'LINKED' ? 'success' : 'warning'" effect="plain">
              {{ row.unionidStatus === "LINKED" ? "已打通" : "待补链" }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="任务进度" width="150">
          <template #default="{ row }">
            <el-progress :percentage="row.taskSummary?.progressPercent || 0" :stroke-width="8" />
          </template>
        </el-table-column>
        <el-table-column label="咨询" width="132">
          <template #default="{ row }">
            <el-tag :type="row.consultationSummary?.pendingCount ? 'warning' : 'info'" effect="plain">
              {{ row.consultationSummary?.pendingCount ? `待跟进 ${row.consultationSummary.pendingCount}` : "暂无待办" }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="筛选状态" min-width="150">
          <template #default="{ row }">
            <div class="table-meta">{{ row.taskProgressStatus }} / {{ row.consultationStatus }}</div>
            <div class="table-meta">{{ row.settlementStatus }} / {{ row.rewardStatus }}</div>
          </template>
        </el-table-column>
        <el-table-column label="结算" width="120">
          <template #default="{ row }">
            {{ row.latestSettlement?.status || "未结算" }}
          </template>
        </el-table-column>
        <el-table-column label="奖励" width="120">
          <template #default="{ row }">
            {{ row.rewardSummary?.latestRewardStatus || "暂无" }}
          </template>
        </el-table-column>
        <el-table-column prop="currentBlockage" label="当前卡点" min-width="160" />
        <el-table-column prop="latestLifecycleEvent" label="最新事件" min-width="160" />
      </el-table>
    </el-card>

    <el-drawer v-model="detailVisible" size="42%" title="生命周期详情">
      <template v-if="selectedUser">
        <el-descriptions :column="1" border>
          <el-descriptions-item label="root_user_id">{{ selectedUser.rootUserId }}</el-descriptions-item>
          <el-descriptions-item label="user_id">{{ selectedUser.userId }}</el-descriptions-item>
          <el-descriptions-item label="unionid">{{ selectedUser.unionid || "待微信开放平台认证后补链" }}</el-descriptions-item>
          <el-descriptions-item label="openid">{{ selectedUser.openidList.join(" / ") || "-" }}</el-descriptions-item>
          <el-descriptions-item label="活动">{{ selectedUser.taskSummary?.campaignId }}</el-descriptions-item>
          <el-descriptions-item label="必做任务">
            {{ selectedUser.taskSummary?.requiredCompletedTasks || 0 }}/{{ selectedUser.taskSummary?.requiredTasks || 0 }}
          </el-descriptions-item>
          <el-descriptions-item label="咨询跟进">
            {{ selectedUser.consultationSummary?.title || "暂无咨询记录" }}
            <span class="description-meta">
              {{ selectedUser.consultationSummary?.copy || "" }}
            </span>
          </el-descriptions-item>
          <el-descriptions-item label="新版问卷">
            {{ selectedUser.questionnaireSummary?.answerCount || 0 }} 份
            <span class="description-meta">
              最近 {{ selectedUser.questionnaireSummary?.latestQuestionnaireId || "-" }}
              {{ selectedUser.questionnaireSummary?.latestNeedsFollow ? "需要跟进" : "" }}
            </span>
          </el-descriptions-item>
          <el-descriptions-item label="最近结算">{{ selectedUser.latestSettlement?.status || "未结算" }}</el-descriptions-item>
          <el-descriptions-item label="奖励数量">{{ selectedUser.rewardSummary?.rewardCount || 0 }}</el-descriptions-item>
          <el-descriptions-item label="当前卡点">{{ selectedUser.currentBlockage || "-" }}</el-descriptions-item>
          <el-descriptions-item label="下一步">{{ selectedUser.nextAction || "-" }}</el-descriptions-item>
        </el-descriptions>
        <div class="wework-writeback-panel">
          <div class="section-title">新版问卷答卷</div>
          <el-table :data="selectedUser.questionnaireSummary?.answers || []" height="180" class="drawer-table">
            <el-table-column prop="questionnaireId" label="问卷" width="140" />
            <el-table-column prop="version" label="版本" width="80" />
            <el-table-column prop="submittedAt" label="提交时间" min-width="150" />
            <el-table-column label="跟进" width="80">
              <template #default="{ row }">{{ row.needsFollow ? "需要" : "否" }}</template>
            </el-table-column>
            <el-table-column prop="answerSummary" label="摘要" min-width="260" />
          </el-table>
        </div>
        <div class="wework-writeback-panel">
          <div class="section-title">咨询 SLA</div>
          <el-space wrap>
            <el-tag :type="slaTagType(selectedUser.consultationSummary?.latest?.slaStatus)" effect="plain">
              {{ selectedUser.consultationSummary?.latest?.slaStatusLabel || "暂无咨询 SLA" }}
            </el-tag>
            <span class="table-meta">
              到期 {{ selectedUser.consultationSummary?.latest?.slaDueAt || "-" }}
            </span>
            <span class="table-meta">
              超时 {{ selectedUser.consultationSummary?.latest?.slaOverdueMinutes || 0 }} 分钟
            </span>
            <span class="table-meta">
              顾问 {{ selectedUser.consultationSummary?.latest?.assignedAdvisorLabel || "未分配" }}
            </span>
            <el-button size="small" :loading="consultationSlaLoading" @click="loadConsultationSlaForSelected">
              刷新 SLA
            </el-button>
          </el-space>
          <el-alert
            v-if="selectedUser.consultationSummary?.latest?.slaStatus === 'OVERDUE'"
            class="drawer-table"
            :closable="false"
            type="warning"
            show-icon
            :title="`该咨询已超过 SLA ${selectedUser.consultationSummary?.latest?.slaOverdueMinutes || 0} 分钟`"
          />
          <el-table v-if="consultationSlaItems.length" :data="consultationSlaItems" height="180" class="drawer-table">
            <el-table-column prop="statusLabel" label="状态" width="100" />
            <el-table-column prop="assignedAdvisorName" label="顾问" min-width="120" />
            <el-table-column prop="overdueMinutes" label="超时分钟" width="110" />
            <el-table-column prop="dueAt" label="到期时间" min-width="170" />
            <el-table-column prop="nextAction" label="下一步" min-width="220" />
          </el-table>
        </div>
        <div class="wework-writeback-panel">
          <div class="section-title">顾问分配</div>
          <el-space wrap>
            <el-input v-model="advisorAssignmentForm.taskId" clearable placeholder="咨询待办 task_id" />
            <el-select v-model="advisorAssignmentForm.assignmentMode" placeholder="分配方式">
              <el-option label="人工指定" value="MANUAL" />
              <el-option label="自动分配" value="AUTO" />
            </el-select>
            <el-input v-model="advisorAssignmentForm.advisorId" clearable placeholder="顾问ID" />
            <el-input v-model="advisorAssignmentForm.advisorName" clearable placeholder="顾问姓名" />
            <el-input v-model="advisorAssignmentForm.advisorCandidates" clearable placeholder="自动候选 a:张三,b:李四" />
            <el-input v-model="advisorAssignmentForm.reason" clearable placeholder="分配原因" />
            <el-button
              type="primary"
              plain
              :disabled="!canReviewResolve || !advisorAssignmentForm.taskId"
              :loading="advisorAssignmentLoading"
              :title="reviewResolveTitle"
              @click="submitAdvisorAssignment"
            >
              分配
            </el-button>
          </el-space>
        </div>
        <div class="wework-writeback-panel">
          <div class="section-title">企微联系回写</div>
          <el-space wrap>
            <el-input v-model="weworkWritebackForm.taskId" clearable placeholder="咨询待办 task_id" />
            <el-input v-model="weworkWritebackForm.externalContactId" clearable placeholder="企微外部联系人ID" />
            <el-select v-model="weworkWritebackForm.adapterMode" placeholder="回写方式">
              <el-option label="人工记录" value="MANUAL" />
              <el-option label="企微 Adapter" value="WEWORK_CONTACT_WRITEBACK" />
            </el-select>
            <el-select v-model="weworkWritebackForm.status" placeholder="结果">
              <el-option label="已联系" value="DELIVERED" />
              <el-option label="联系失败" value="FAILED" />
            </el-select>
            <el-input v-model="weworkWritebackForm.note" clearable placeholder="跟进备注" />
            <el-button
              type="primary"
              :disabled="!canReviewResolve || !weworkWritebackForm.taskId"
              :loading="weworkWritebackLoading"
              :title="reviewResolveTitle"
              @click="submitWeworkWriteback"
            >
              写回
            </el-button>
          </el-space>
        </div>
      </template>
    </el-drawer>

    <el-drawer v-model="advisorWorkbenchVisible" size="62%" title="咨询顾问工作台">
      <el-space class="drawer-toolbar" wrap>
        <el-input v-model="advisorWorkbenchFilters.advisorId" clearable placeholder="顾问 ID 或 __UNASSIGNED__" />
        <el-select v-model="advisorWorkbenchFilters.status" clearable placeholder="SLA 状态">
          <el-option label="已超时" value="OVERDUE" />
          <el-option label="即将超时" value="DUE_SOON" />
          <el-option label="跟进中" value="OPEN" />
        </el-select>
        <el-select v-model="advisorWorkbenchFilters.advisorStatus" clearable placeholder="分配状态">
          <el-option label="已分配" value="ASSIGNED" />
          <el-option label="未分配" value="UNASSIGNED" />
        </el-select>
        <el-input-number v-model="advisorWorkbenchFilters.limit" :min="20" :max="300" />
        <el-button :loading="advisorWorkbenchLoading" @click="loadAdvisorWorkbench">刷新</el-button>
        <el-button :loading="consultationEscalationLoading" @click="loadConsultationEscalations">刷新升级</el-button>
        <el-button @click="resetAdvisorWorkbenchFilters">重置</el-button>
      </el-space>

      <el-row :gutter="8" class="advisor-card-row">
        <el-col v-for="card in advisorWorkbenchCards" :key="card.key" :span="4">
          <div class="advisor-card">
            <span>{{ card.label }}</span>
            <strong>{{ card.value }}</strong>
          </div>
        </el-col>
      </el-row>

      <div class="section-title advisor-section-title">超时升级</div>
      <el-row :gutter="8" class="advisor-card-row">
        <el-col v-for="card in consultationEscalationCards" :key="card.key" :span="4">
          <div class="advisor-card">
            <span>{{ card.label }}</span>
            <strong>{{ card.value }}</strong>
          </div>
        </el-col>
      </el-row>
      <el-table :data="consultationEscalationItems" height="220" class="drawer-table">
        <el-table-column label="升级" width="120">
          <template #default="{ row }">
            <el-tag :type="escalationTagType(row.escalationSeverity)" effect="plain">{{ row.escalationLabel }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="escalationOwnerRole" label="负责人" width="110" />
        <el-table-column prop="assignedAdvisorName" label="顾问" min-width="120" />
        <el-table-column prop="userLabel" label="用户" min-width="120" />
        <el-table-column prop="overdueMinutes" label="超时分钟" width="100" />
        <el-table-column prop="nextEscalationAt" label="下次升级" min-width="170" />
        <el-table-column prop="escalationAction" label="处理动作" min-width="260" />
      </el-table>

      <div class="section-title">顾问负载</div>
      <el-table :data="advisorWorkbenchAdvisors" height="240" class="drawer-table" @row-click="selectAdvisorWorkbenchAdvisor">
        <el-table-column prop="advisorName" label="顾问" min-width="140" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="advisorWorkbenchStatusType(row.status)" effect="plain">{{ advisorWorkbenchStatusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="openCount" label="待跟进" width="90" />
        <el-table-column prop="overdueCount" label="超时" width="80" />
        <el-table-column prop="dueSoonCount" label="将超时" width="90" />
        <el-table-column prop="maxOverdueMinutes" label="最大超时" width="100" />
        <el-table-column prop="nextAction" label="下一步" min-width="220" />
      </el-table>

      <div class="section-title advisor-section-title">待办明细</div>
      <el-table :data="advisorWorkbenchItems" height="320" class="drawer-table">
        <el-table-column prop="statusLabel" label="SLA" width="96" />
        <el-table-column prop="assignedAdvisorName" label="顾问" min-width="120" />
        <el-table-column prop="userLabel" label="用户" min-width="130" />
        <el-table-column prop="consultationType" label="主题" width="110" />
        <el-table-column prop="overdueMinutes" label="超时分钟" width="100" />
        <el-table-column prop="dueAt" label="到期时间" min-width="170" />
        <el-table-column prop="nextAction" label="下一步" min-width="240" />
      </el-table>
    </el-drawer>

    <el-drawer v-model="batchResultVisible" size="52%" :title="batchResultTitle">
      <template v-if="batchSettlementResult">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="来源">{{ batchResultSourceLabel }}</el-descriptions-item>
          <el-descriptions-item label="模式">{{ batchSettlementResult.mode }}</el-descriptions-item>
          <el-descriptions-item label="活动">{{ batchSettlementResult.campaignId || activeBatchCampaignId || "-" }}</el-descriptions-item>
          <el-descriptions-item label="总人数">{{ batchSettlementResult.summary?.total || 0 }}</el-descriptions-item>
          <el-descriptions-item label="可结算">{{ batchSettlementResult.summary?.qualified || 0 }}</el-descriptions-item>
          <el-descriptions-item label="奖励数量">{{ batchSettlementResult.summary?.rewardCount || 0 }}</el-descriptions-item>
          <el-descriptions-item label="已执行">{{ batchSettlementResult.summary?.executed || 0 }}</el-descriptions-item>
          <el-descriptions-item v-if="batchSelection" label="筛选命中">{{ batchSelection.total || 0 }}</el-descriptions-item>
          <el-descriptions-item v-if="batchSelection" label="选入人数">{{ batchSelection.selectedCount || 0 }}/{{ batchSelection.selectionLimit || 0 }}</el-descriptions-item>
          <el-descriptions-item v-if="batchSelection" label="截断">{{ batchSelection.truncated ? "是" : "否" }}</el-descriptions-item>
        </el-descriptions>
        <el-table :data="batchSettlementResult.items || []" height="420" class="drawer-table">
          <el-table-column prop="rootUserId" label="root_user_id" min-width="180" />
          <el-table-column prop="userLabel" label="用户" min-width="180" />
          <el-table-column prop="status" label="状态" width="120" />
          <el-table-column prop="missingCount" label="缺失" width="80" />
          <el-table-column prop="rewardCount" label="奖励" width="80" />
          <el-table-column label="执行" width="90">
            <template #default="{ row }">{{ row.executed ? "已执行" : "未执行" }}</template>
          </el-table-column>
          <el-table-column prop="message" label="说明" min-width="180" />
        </el-table>
      </template>
    </el-drawer>

    <el-drawer v-model="settlementJobDrawerVisible" size="62%" title="筛选结算队列">
      <el-space class="drawer-toolbar" wrap>
        <el-button :loading="jobLoading.list" @click="loadSettlementJobs">刷新</el-button>
        <el-button :loading="jobLoading.schedulerPreview" @click="previewSettlementScheduler">调度预览</el-button>
        <el-button
          type="primary"
          plain
          :disabled="!canSettlementExecute"
          :loading="jobLoading.schedulerExecute"
          @click="executeSettlementScheduler"
        >
          调度执行
        </el-button>
        <el-button :loading="jobLoading.cleanupPreview" @click="previewSettlementCleanup">清理预览</el-button>
        <el-button
          type="warning"
          plain
          :disabled="!canSettlementExecute"
          :loading="jobLoading.cleanupExecute"
          @click="executeSettlementCleanup"
        >
          超时清理
        </el-button>
        <span class="table-meta">队列用于按筛选快照分批执行结算</span>
      </el-space>
      <el-alert
        v-if="settlementSchedulerResult"
        class="drawer-table"
        :closable="false"
        type="info"
        show-icon
        :title="`调度${settlementSchedulerResult.dryRun ? '预览' : '执行'}：候选 ${settlementSchedulerResult.selectedCount || 0}/${settlementSchedulerResult.eligibleCount || 0}，执行 ${settlementSchedulerResult.executedCount || 0}，成功 ${settlementSchedulerResult.successCount || 0}，失败 ${settlementSchedulerResult.failedCount || 0}`"
      />
      <el-alert
        v-if="settlementCleanupResult"
        class="drawer-table"
        :closable="false"
        type="warning"
        show-icon
        :title="`清理${settlementCleanupResult.dryRun ? '预览' : '执行'}：候选 ${settlementCleanupResult.selectedCount || 0}/${settlementCleanupResult.eligibleCount || 0}，重置 ${settlementCleanupResult.resetCount || 0}，取消 ${settlementCleanupResult.cancelCount || 0}，记录 ${settlementCleanupResult.annotatedCount || 0}，失败 ${settlementCleanupResult.failedCount || 0}`"
      />
      <el-table :data="lifecycleSettlementJobs" height="360" class="drawer-table" @row-click="selectSettlementJob">
        <el-table-column prop="jobId" label="job_id" min-width="170" />
        <el-table-column label="状态" width="150">
          <template #default="{ row }">
            <el-tag :type="jobStatusType(row.status)" effect="plain">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="campaignId" label="活动" min-width="140" />
        <el-table-column label="进度" min-width="160">
          <template #default="{ row }">
            {{ row.summary?.processed || 0 }}/{{ row.summary?.selected || 0 }}
            <span class="table-meta">待 {{ row.summary?.pending || 0 }}</span>
          </template>
        </el-table-column>
        <el-table-column label="结果" min-width="150">
          <template #default="{ row }">
            <span>执行 {{ row.summary?.executed || 0 }}</span>
            <span class="table-meta">失败 {{ row.summary?.failed || 0 }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="batchSize" label="每批" width="80" />
        <el-table-column prop="updatedAt" label="更新时间" min-width="170" />
        <el-table-column label="动作" width="260">
          <template #default="{ row }">
            <el-button
              size="small"
              :disabled="!canSettlementExecute || !canRunSettlementJob(row)"
              :loading="jobActionBusy('run', row)"
              @click.stop="runSettlementJob(row)"
            >
              下一批
            </el-button>
            <el-button
              size="small"
              :disabled="!canSettlementExecute || !(row.summary?.failed > 0)"
              :loading="jobActionBusy('retry', row)"
              @click.stop="retrySettlementJob(row)"
            >
              重试失败
            </el-button>
            <el-button
              size="small"
              :disabled="!canSettlementExecute || !canCancelSettlementJob(row)"
              :loading="jobActionBusy('cancel', row)"
              @click.stop="cancelSettlementJob(row)"
            >
              取消
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-descriptions v-if="selectedSettlementJob" :column="2" border class="drawer-table">
        <el-descriptions-item label="job_id">{{ selectedSettlementJob.jobId }}</el-descriptions-item>
        <el-descriptions-item label="状态">{{ selectedSettlementJob.status }}</el-descriptions-item>
        <el-descriptions-item label="筛选命中">{{ selectedSettlementJob.selection?.total || 0 }}</el-descriptions-item>
        <el-descriptions-item label="选入">{{ selectedSettlementJob.selection?.selectedCount || 0 }}/{{ selectedSettlementJob.selection?.selectionLimit || 0 }}</el-descriptions-item>
        <el-descriptions-item label="执行次数">{{ selectedSettlementJob.summary?.runCount || 0 }}</el-descriptions-item>
        <el-descriptions-item label="奖励数量">{{ selectedSettlementJob.summary?.rewardCount || 0 }}</el-descriptions-item>
        <el-descriptions-item label="最近请求">{{ selectedSettlementJob.lastRun?.requestId || "-" }}</el-descriptions-item>
        <el-descriptions-item label="最近批次">{{ selectedSettlementJob.lastRun?.chunkRequestId || "-" }}</el-descriptions-item>
        <el-descriptions-item label="最近清理">{{ selectedSettlementJob.cleanup?.action || "-" }}</el-descriptions-item>
        <el-descriptions-item label="清理说明">{{ selectedSettlementJob.cleanup?.reason || "-" }}</el-descriptions-item>
        <el-descriptions-item label="错误">{{ selectedSettlementJob.errorMessage || "-" }}</el-descriptions-item>
      </el-descriptions>
    </el-drawer>

    <el-drawer v-model="lifecycleExportDrawerVisible" size="58%" title="生命周期导出记录">
      <el-space class="drawer-toolbar" wrap>
        <el-button :loading="exportRecordLoading.list" @click="loadLifecycleUserExports">刷新</el-button>
        <el-button :loading="exportRecordLoading.health" @click="loadLifecycleExportDeliveryHealth">刷新通道健康</el-button>
        <el-button :loading="exportRecordLoading.create" type="primary" plain @click="createLifecycleUserExportRecord">
          生成当前筛选导出
        </el-button>
        <el-button
          :disabled="!canDataExportApprove"
          :loading="exportRecordLoading.cleanupPreview"
          :title="dataExportApproveTitle"
          @click="previewLifecycleExportCleanup"
        >
          过期清理预览
        </el-button>
        <el-button
          type="warning"
          plain
          :disabled="!canDataExportApprove"
          :loading="exportRecordLoading.cleanupExecute"
          :title="dataExportApproveTitle"
          @click="executeLifecycleExportCleanup"
        >
          过期清理
        </el-button>
        <span class="table-meta">记录默认保留 7 天，字段默认脱敏，下载会写入审计</span>
      </el-space>
      <div v-if="lifecycleExportDeliveryHealth" class="delivery-health-panel">
        <el-alert
          :closable="false"
          show-icon
          :type="deliveryHealthAlertType(lifecycleExportDeliveryHealth.status)"
          :title="`${deliveryHealthStatusLabel(lifecycleExportDeliveryHealth.status)}：${lifecycleExportDeliveryHealth.message}`"
        />
        <div class="delivery-health-cards">
          <div v-for="item in deliveryHealthCards" :key="item.key" class="delivery-health-card">
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
          </div>
        </div>
        <el-table :data="lifecycleExportDeliveryHealth.channels || []" height="180" class="drawer-table" size="small">
          <el-table-column prop="channel" label="通道" min-width="130" />
          <el-table-column prop="requested" label="请求" width="80" />
          <el-table-column prop="delivered" label="成功" width="80" />
          <el-table-column label="待处理" width="100">
            <template #default="{ row }">{{ (row.failed || 0) + (row.retryScheduled || 0) + (row.deadLetter || 0) + (row.skipped || 0) }}</template>
          </el-table-column>
          <el-table-column prop="dueRetry" label="到期重试" width="100" />
          <el-table-column prop="successRate" label="成功率" width="90">
            <template #default="{ row }">{{ row.successRate || 0 }}%</template>
          </el-table-column>
          <el-table-column prop="latestFailureReason" label="最近失败原因" min-width="220" />
        </el-table>
        <el-table v-if="(lifecycleExportDeliveryHealth.failureReasons || []).length" :data="lifecycleExportDeliveryHealth.failureReasons || []" height="160" class="drawer-table" size="small">
          <el-table-column prop="reason" label="失败原因" min-width="260" />
          <el-table-column prop="count" label="次数" width="80" />
          <el-table-column prop="latestAt" label="最近时间" min-width="170" />
        </el-table>
      </div>
      <el-alert
        v-if="lifecycleExportResult"
        class="drawer-table"
        :closable="false"
        show-icon
        type="success"
        :title="`最近导出：${lifecycleExportResult.summary?.exportedCount || 0}/${lifecycleExportResult.summary?.total || 0} 人，${sensitivityLabel(lifecycleExportResult.summary?.sensitivity || lifecycleExportResult.sensitivity)}，文件 ${lifecycleExportResult.filename || '-'}`"
      />
      <el-alert
        v-if="lifecycleExportCleanupResult"
        class="drawer-table"
        :closable="false"
        show-icon
        type="warning"
        :title="`过期清理${lifecycleExportCleanupResult.dryRun ? '预览' : '执行'}：候选 ${lifecycleExportCleanupResult.selectedCount || 0}/${lifecycleExportCleanupResult.eligibleCount || 0}，移除 ${lifecycleExportCleanupResult.removedCount || 0}，删除对象 ${lifecycleExportCleanupResult.objectDeletedCount || 0}，跳过 ${lifecycleExportCleanupResult.objectSkippedCount || 0}，失败 ${lifecycleExportCleanupResult.objectFailedCount || 0}`"
      />
      <el-table :data="lifecycleUserExports" height="420" class="drawer-table">
        <el-table-column prop="exportId" label="export_id" min-width="180" />
        <el-table-column prop="filename" label="文件名" min-width="220" />
        <el-table-column label="人数" width="120">
          <template #default="{ row }">
            {{ row.summary?.exportedCount || 0 }}/{{ row.summary?.total || 0 }}
          </template>
        </el-table-column>
        <el-table-column label="截断" width="90">
          <template #default="{ row }">{{ row.summary?.truncated ? "是" : "否" }}</template>
        </el-table-column>
        <el-table-column label="字段策略" width="130">
          <template #default="{ row }">
            <el-tag :type="row.sensitivity === 'RAW' ? 'warning' : 'success'" effect="plain">
              {{ sensitivityLabel(row.sensitivity || row.summary?.sensitivity) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="审批" width="130">
          <template #default="{ row }">
            <el-tag :type="approvalTagType(row)" effect="plain">
              {{ approvalLabel(row) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="交付" width="130">
          <template #default="{ row }">
            <el-tag :type="deliveryTagType(row)" effect="plain">
              {{ deliveryLabel(row) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="downloadCount" label="下载" width="90" />
        <el-table-column prop="createdAt" label="创建时间" min-width="170" />
        <el-table-column prop="expiresAt" label="过期时间" min-width="170" />
        <el-table-column label="动作" width="320">
          <template #default="{ row }">
            <el-button
              size="small"
              :disabled="!canDownloadLifecycleExport(row)"
              :loading="exportRecordLoading.download === row.exportId"
              :title="downloadLifecycleExportTitle(row)"
              @click="downloadStoredLifecycleExport(row)"
            >
              下载
            </el-button>
            <el-button
              v-if="row.approvalRequired && row.approvalStatus === 'PENDING'"
              size="small"
              type="success"
              plain
              :disabled="!canDataExportApprove"
              :loading="exportRecordLoading.review === `${row.exportId}:APPROVED`"
              :title="dataExportApproveTitle"
              @click="reviewLifecycleExport(row, 'APPROVED')"
            >
              通过
            </el-button>
            <el-button
              v-if="row.approvalRequired && row.approvalStatus === 'PENDING'"
              size="small"
              type="danger"
              plain
              :disabled="!canDataExportApprove"
              :loading="exportRecordLoading.review === `${row.exportId}:REJECTED`"
              :title="dataExportApproveTitle"
              @click="reviewLifecycleExport(row, 'REJECTED')"
            >
              拒绝
            </el-button>
            <el-button
              size="small"
              plain
              :disabled="!canDeliverLifecycleExport(row)"
              :loading="exportRecordLoading.deliver === row.exportId"
              :title="deliveryLifecycleExportTitle(row)"
              @click="deliverLifecycleExportRecord(row)"
            >
              交付
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-drawer>
  </section>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { ADMIN_CAPABILITIES, useAdminAccess } from "../access";
import {
  assignConsultationAdvisor,
  cancelLifecycleSettlementJob,
  copyLifecycleFilterPreset,
  createLifecycleSettlementJob,
  createLifecycleUserExport,
  deleteLifecycleFilterPreset,
  deliverLifecycleUserExport,
  downloadLifecycleUserExportCsv,
  executeLifecycleFilterSettlementBatch,
  executeLifecycleSettlementBatch,
  exportLifecycleUsersCsv,
  fetchConsultationAdvisorWorkbench,
  fetchConsultationSla,
  fetchConsultationSlaEscalations,
  fetchLifecycleExportDeliveryHealth,
  fetchLifecycleUserExports,
  fetchLifecycleSettlementJobs,
  fetchLifecycleFilterPresets,
  fetchLifecycleUsers,
  previewLifecycleFilterSettlementBatch,
  previewLifecycleSettlementBatch,
  recordConsultationWeworkWriteback,
  reviewLifecycleUserExport,
  retryFailedLifecycleSettlementJob,
  runLifecycleSettlementCleanup,
  runLifecycleSettlementScheduler,
  runLifecycleSettlementJob,
  runLifecycleUserExportsCleanup,
  upsertLifecycleFilterPreset,
} from "./adminLifecycleApi";

const errorMessage = ref("");
const users = ref([]);
const metrics = ref({});
const totalUsers = ref(0);
const exportLoading = ref(false);
const lifecycleUserExports = ref([]);
const lifecycleExportDeliveryHealth = ref(null);
const lifecycleExportResult = ref(null);
const lifecycleExportCleanupResult = ref(null);
const consultationSla = ref(null);
const consultationSlaLoading = ref(false);
const advisorWorkbench = ref(null);
const advisorWorkbenchLoading = ref(false);
const advisorWorkbenchVisible = ref(false);
const consultationEscalations = ref(null);
const consultationEscalationLoading = ref(false);
const lifecycleExportDrawerVisible = ref(false);
const exportRecordLoading = reactive({
  list: false,
  create: false,
  download: "",
  review: "",
  deliver: "",
  health: false,
  cleanupPreview: false,
  cleanupExecute: false,
});
const filterPresets = ref([]);
const selectedPresetId = ref("");
const presetLoading = reactive({
  load: false,
  save: false,
  copy: false,
  delete: false,
});
const presetForm = reactive({
  title: "",
  teamShared: false,
  pinned: false,
  sortOrder: 100,
});
const selectedUser = ref(null);
const detailVisible = ref(false);
const advisorAssignmentLoading = ref(false);
const weworkWritebackLoading = ref(false);
const advisorAssignmentForm = reactive({
  taskId: "",
  assignmentMode: "MANUAL",
  advisorId: "",
  advisorName: "",
  advisorCandidates: "",
  reason: "",
});
const weworkWritebackForm = reactive({
  taskId: "",
  externalContactId: "",
  adapterMode: "MANUAL",
  status: "DELIVERED",
  note: "",
});
const batchSettlementResult = ref(null);
const batchResultVisible = ref(false);
const lifecycleSettlementJobs = ref([]);
const selectedSettlementJob = ref(null);
const settlementSchedulerResult = ref(null);
const settlementCleanupResult = ref(null);
const settlementJobDrawerVisible = ref(false);
const batchLoading = reactive({
  preview: false,
  execute: false,
  filterPreview: false,
  filterExecute: false,
});
const jobLoading = reactive({
  list: false,
  create: false,
  schedulerPreview: false,
  schedulerExecute: false,
  cleanupPreview: false,
  cleanupExecute: false,
  action: "",
});
const batchSettlementForm = reactive({
  campaignId: "",
  requestId: "",
  confirmRisk: false,
  selectionLimit: 500,
  batchSize: 20,
});
function defaultFilters() {
  return {
    keyword: "",
    unionidStatus: "",
    state: "",
    campaignId: "",
    taskProgress: "",
    consultationStatus: "",
    settlementStatus: "",
    rewardStatus: "",
    openTasks: "",
    severity: "",
    blockage: "",
    limit: 100,
  };
}

const filters = reactive(defaultFilters());
const advisorWorkbenchFilters = reactive({
  advisorId: "",
  status: "",
  advisorStatus: "",
  limit: 100,
});

const lifecycleFilterKeys = Object.keys(defaultFilters());

function filterSnapshot() {
  return lifecycleFilterKeys.reduce((result, key) => {
    const value = filters[key];
    if (value !== undefined && value !== null && String(value).trim()) result[key] = value;
    return result;
  }, {});
}

function selectedPreset() {
  return filterPresets.value.find((preset) => preset.presetId === selectedPresetId.value) || null;
}

const selectedPresetReadonly = computed(() => {
  const preset = selectedPreset();
  return Boolean(preset && preset.canModify === false);
});

function presetOptionLabel(preset) {
  const badges = [];
  if (preset.scope === "TEAM") badges.push("团队");
  if (preset.pinned) badges.push("置顶");
  return `${badges.length ? `${badges.join(" ")} · ` : ""}${preset.title}`;
}

async function loadPresets() {
  presetLoading.load = true;
  try {
    const result = await fetchLifecycleFilterPresets();
    filterPresets.value = result.presets || [];
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    presetLoading.load = false;
  }
}

function applySelectedPreset(presetId) {
  if (!presetId) return;
  const preset = selectedPreset();
  if (!preset) return;
  Object.assign(filters, defaultFilters(), preset.filters || {});
  presetForm.title = preset.title;
  presetForm.teamShared = preset.scope === "TEAM";
  presetForm.pinned = Boolean(preset.pinned);
  presetForm.sortOrder = Number(preset.sortOrder || 100);
  load();
}

async function saveCurrentPreset() {
  const title = presetForm.title.trim();
  if (!title) {
    ElMessage.warning("请先填写筛选名称");
    return;
  }
  if (selectedPresetReadonly.value) {
    ElMessage.warning("团队筛选只能由创建者修改，请清空常用筛选后另存");
    return;
  }
  presetLoading.save = true;
  errorMessage.value = "";
  try {
    const requestId = `lifecycle-filter-${Date.now().toString(36)}`;
    const result = await upsertLifecycleFilterPreset({
      presetId: selectedPresetId.value,
      title,
      scope: presetForm.teamShared ? "TEAM" : "PERSONAL",
      pinned: presetForm.pinned,
      sortOrder: presetForm.sortOrder,
      filters: filterSnapshot(),
      requestId,
      reason: "Element Plus Admin 保存生命周期常用筛选",
    }, requestId);
    filterPresets.value = result.presets || [];
    selectedPresetId.value = result.preset?.presetId || "";
    presetForm.title = result.preset?.title || title;
    presetForm.teamShared = result.preset?.scope === "TEAM";
    presetForm.pinned = Boolean(result.preset?.pinned);
    presetForm.sortOrder = Number(result.preset?.sortOrder || presetForm.sortOrder || 100);
    ElMessage.success("常用筛选已保存");
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    presetLoading.save = false;
  }
}

async function copySelectedPreset() {
  const source = selectedPreset();
  if (!source) return;
  presetLoading.copy = true;
  errorMessage.value = "";
  try {
    const requestId = `lifecycle-filter-copy-${Date.now().toString(36)}`;
    const result = await copyLifecycleFilterPreset({
      sourcePresetId: source.presetId,
      scope: "PERSONAL",
      pinned: false,
      sortOrder: 100,
      requestId,
      reason: "Element Plus Admin 复制生命周期常用筛选",
    }, requestId);
    filterPresets.value = result.presets || [];
    selectedPresetId.value = result.preset?.presetId || "";
    presetForm.title = result.preset?.title || "";
    presetForm.teamShared = result.preset?.scope === "TEAM";
    presetForm.pinned = Boolean(result.preset?.pinned);
    presetForm.sortOrder = Number(result.preset?.sortOrder || 100);
    Object.assign(filters, defaultFilters(), result.preset?.filters || {});
    ElMessage.success("常用筛选已复制");
    load();
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    presetLoading.copy = false;
  }
}

async function deleteSelectedPreset() {
  if (!selectedPresetId.value) return;
  if (selectedPresetReadonly.value) {
    ElMessage.warning("团队筛选只能由创建者删除");
    return;
  }
  presetLoading.delete = true;
  errorMessage.value = "";
  try {
    const requestId = `lifecycle-filter-delete-${Date.now().toString(36)}`;
    const result = await deleteLifecycleFilterPreset(selectedPresetId.value, requestId);
    filterPresets.value = result.presets || [];
    selectedPresetId.value = "";
    presetForm.title = "";
    presetForm.teamShared = false;
    presetForm.pinned = false;
    presetForm.sortOrder = 100;
    ElMessage.success("常用筛选已删除");
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    presetLoading.delete = false;
  }
}

const access = useAdminAccess();
const canSettlementExecute = computed(() => access.has(ADMIN_CAPABILITIES.SETTLEMENT_EXECUTE));
const settlementExecuteTitle = computed(() => access.reason(ADMIN_CAPABILITIES.SETTLEMENT_EXECUTE));
const canDataExportApprove = computed(() => access.has(ADMIN_CAPABILITIES.DATA_EXPORT_APPROVE));
const dataExportApproveTitle = computed(() => access.reason(ADMIN_CAPABILITIES.DATA_EXPORT_APPROVE));
const canReviewResolve = computed(() => access.has(ADMIN_CAPABILITIES.REVIEW_RESOLVE));
const reviewResolveTitle = computed(() => access.reason(ADMIN_CAPABILITIES.REVIEW_RESOLVE));

const metricCards = computed(() => [
  { key: "totalUsers", label: "用户数", value: metrics.value.totalUsers || 0 },
  { key: "unionidLinked", label: "UnionID已打通", value: metrics.value.unionidLinked || 0 },
  { key: "pendingUnionid", label: "待补链", value: metrics.value.pendingUnionid || 0 },
  { key: "settlementReady", label: "可结算", value: metrics.value.settlementReady || 0 },
  { key: "pendingConsultations", label: "待跟进咨询", value: metrics.value.pendingConsultations || 0 },
  { key: "overdueConsultations", label: "咨询超时", value: metrics.value.overdueConsultations || 0 },
  { key: "openTasks", label: "待办", value: metrics.value.openTasks || 0 },
  { key: "pendingRewards", label: "待发奖励", value: metrics.value.pendingRewards || 0 },
]);
const metricSpan = computed(() => (metricCards.value.length > 6 ? 3 : 4));
const consultationSlaItems = computed(() => consultationSla.value?.items || []);
const advisorWorkbenchAdvisors = computed(() => advisorWorkbench.value?.advisors || []);
const advisorWorkbenchItems = computed(() => advisorWorkbench.value?.items || []);
const consultationEscalationItems = computed(() => consultationEscalations.value?.items || []);
const advisorWorkbenchCards = computed(() => {
  const summary = advisorWorkbench.value?.summary || {};
  return [
    { key: "openCount", label: "待跟进", value: summary.openCount || 0 },
    { key: "overdueCount", label: "已超时", value: summary.overdueCount || 0 },
    { key: "dueSoonCount", label: "将超时", value: summary.dueSoonCount || 0 },
    { key: "activeAdvisorCount", label: "活跃顾问", value: summary.activeAdvisorCount || 0 },
    { key: "unassignedCount", label: "未分配", value: summary.unassignedCount || 0 },
    { key: "maxOverdueMinutes", label: "最大超时", value: summary.maxOverdueMinutes || 0 },
  ];
});
const consultationEscalationCards = computed(() => {
  const summary = consultationEscalations.value?.summary || {};
  return [
    { key: "overdueCount", label: "超时咨询", value: summary.overdueCount || 0 },
    { key: "escalatedCount", label: "已升级", value: summary.escalatedCount || 0 },
    { key: "level2Count", label: "L2", value: summary.level2Count || 0 },
    { key: "level3Count", label: "L3+", value: summary.level3Count || 0 },
    { key: "highestEscalationLevel", label: "最高等级", value: summary.highestEscalationLevel || 0 },
    { key: "maxOverdueMinutes", label: "最大超时", value: summary.maxOverdueMinutes || 0 },
  ];
});
const currentRootUserIds = computed(() => Array.from(new Set(users.value.map((row) => row.rootUserId).filter(Boolean))));
const settlementReadyCount = computed(() => users.value.filter((row) => row.taskSummary?.settlementReady || row.taskProgressStatus === "SETTLEMENT_READY").length);
const activeBatchCampaignId = computed(() => batchSettlementForm.campaignId || filters.campaignId || users.value[0]?.taskSummary?.campaignId || "");
const batchSelection = computed(() => batchSettlementResult.value?.selection || null);
const batchResultSourceLabel = computed(() => (batchSettlementResult.value?.source === "LIFECYCLE_FILTER" ? "筛选条件" : "当前列表"));
const batchResultTitle = computed(() => `${batchResultSourceLabel.value}批量结算`);

async function load() {
  errorMessage.value = "";
  try {
    const result = await fetchLifecycleUsers(filters);
    users.value = result.users || [];
    metrics.value = result.metrics || {};
    totalUsers.value = result.total || users.value.length;
    if (!batchSettlementForm.campaignId && filters.campaignId) batchSettlementForm.campaignId = filters.campaignId;
    if (selectedUser.value) {
      const refreshed = users.value.find((row) => row.rootUserId === selectedUser.value.rootUserId);
      if (refreshed) {
        selectedUser.value = refreshed;
        syncAdvisorAssignmentForm(refreshed);
        syncWeworkWritebackForm(refreshed);
        loadConsultationSlaForSelected(refreshed);
      }
    }
  } catch (error) {
    errorMessage.value = error.message;
  }
}

function syncWeworkWritebackForm(row) {
  const latest = row?.consultationSummary?.latest || null;
  weworkWritebackForm.taskId = latest?.followTaskId || "";
  weworkWritebackForm.externalContactId = latest?.externalContactId || "";
  weworkWritebackForm.adapterMode = weworkWritebackForm.adapterMode || "MANUAL";
  weworkWritebackForm.status = "DELIVERED";
  weworkWritebackForm.note = latest?.followNote || "";
}

function syncAdvisorAssignmentForm(row) {
  const latest = row?.consultationSummary?.latest || null;
  advisorAssignmentForm.taskId = latest?.followTaskId || "";
  advisorAssignmentForm.assignmentMode = advisorAssignmentForm.assignmentMode || "MANUAL";
  advisorAssignmentForm.advisorId = latest?.assignedAdvisorId || "";
  advisorAssignmentForm.advisorName = latest?.assignedAdvisorName || "";
  advisorAssignmentForm.reason = latest?.assignedAdvisorName ? "调整咨询顾问分配" : "分配咨询顾问";
}

function selectUser(row) {
  selectedUser.value = row;
  syncAdvisorAssignmentForm(row);
  syncWeworkWritebackForm(row);
  loadConsultationSlaForSelected(row);
  detailVisible.value = true;
}

function slaTagType(status) {
  if (status === "OVERDUE") return "danger";
  if (status === "DUE_SOON") return "warning";
  if (status === "OPEN") return "info";
  return "info";
}

async function loadConsultationSlaForSelected(row = selectedUser.value) {
  if (!row?.rootUserId) {
    consultationSla.value = null;
    return;
  }
  consultationSlaLoading.value = true;
  try {
    consultationSla.value = await fetchConsultationSla({ rootUserId: row.rootUserId, limit: 20 });
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    consultationSlaLoading.value = false;
  }
}

function advisorWorkbenchStatusLabel(status) {
  if (status === "ATTENTION") return "需处理";
  if (status === "WATCH") return "关注";
  if (status === "NORMAL") return "正常";
  return "空闲";
}

function advisorWorkbenchStatusType(status) {
  if (status === "ATTENTION") return "danger";
  if (status === "WATCH") return "warning";
  if (status === "NORMAL") return "success";
  return "info";
}

function escalationTagType(severity) {
  if (severity === "danger") return "danger";
  if (severity === "warning") return "warning";
  if (severity === "success") return "success";
  return "info";
}

function advisorWorkbenchQuery() {
  return {
    advisorId: advisorWorkbenchFilters.advisorId,
    advisorStatus: advisorWorkbenchFilters.advisorStatus,
    status: advisorWorkbenchFilters.status,
    limit: advisorWorkbenchFilters.limit,
  };
}

function consultationEscalationQuery() {
  return {
    advisorId: advisorWorkbenchFilters.advisorId,
    advisorStatus: advisorWorkbenchFilters.advisorStatus,
    campaignId: filters.campaignId,
    limit: advisorWorkbenchFilters.limit,
  };
}

async function loadAdvisorWorkbench() {
  advisorWorkbenchLoading.value = true;
  errorMessage.value = "";
  try {
    advisorWorkbench.value = await fetchConsultationAdvisorWorkbench(advisorWorkbenchQuery());
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    advisorWorkbenchLoading.value = false;
  }
}

async function loadConsultationEscalations() {
  consultationEscalationLoading.value = true;
  errorMessage.value = "";
  try {
    consultationEscalations.value = await fetchConsultationSlaEscalations(consultationEscalationQuery());
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    consultationEscalationLoading.value = false;
  }
}

function loadAdvisorWorkbenchBundle() {
  return Promise.all([loadAdvisorWorkbench(), loadConsultationEscalations()]);
}

function openAdvisorWorkbench() {
  advisorWorkbenchVisible.value = true;
  return loadAdvisorWorkbenchBundle();
}

function resetAdvisorWorkbenchFilters() {
  advisorWorkbenchFilters.advisorId = "";
  advisorWorkbenchFilters.status = "";
  advisorWorkbenchFilters.advisorStatus = "";
  advisorWorkbenchFilters.limit = 100;
  return loadAdvisorWorkbenchBundle();
}

function selectAdvisorWorkbenchAdvisor(row) {
  advisorWorkbenchFilters.advisorId = row.assigned ? row.advisorId : "__UNASSIGNED__";
  advisorWorkbenchFilters.advisorStatus = row.assigned ? "ASSIGNED" : "UNASSIGNED";
  return loadAdvisorWorkbenchBundle();
}

async function submitAdvisorAssignment() {
  if (!canReviewResolve.value) {
    ElMessage.warning(reviewResolveTitle.value || "当前角色缺少复核处理权限");
    return;
  }
  if (!advisorAssignmentForm.taskId) {
    ElMessage.warning("请先选择咨询待办");
    return;
  }
  advisorAssignmentLoading.value = true;
  errorMessage.value = "";
  try {
    const requestId = newRequestId("consultation-advisor-assignment");
    const payload = {
      taskId: advisorAssignmentForm.taskId,
      assignmentMode: advisorAssignmentForm.assignmentMode,
      advisorId: advisorAssignmentForm.advisorId.trim(),
      advisorName: advisorAssignmentForm.advisorName.trim(),
      advisors: advisorAssignmentForm.advisorCandidates.trim(),
      reason: advisorAssignmentForm.reason.trim(),
      requestId,
    };
    await assignConsultationAdvisor(payload, requestId);
    await load();
    if (advisorWorkbenchVisible.value) await loadAdvisorWorkbenchBundle();
    ElMessage.success("咨询顾问已分配");
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    advisorAssignmentLoading.value = false;
  }
}

async function submitWeworkWriteback() {
  if (!canReviewResolve.value) {
    ElMessage.warning(reviewResolveTitle.value || "当前角色缺少复核处理权限");
    return;
  }
  if (!weworkWritebackForm.taskId) {
    ElMessage.warning("请先选择咨询待办");
    return;
  }
  weworkWritebackLoading.value = true;
  errorMessage.value = "";
  try {
    const requestId = newRequestId("consultation-wework-writeback");
    const submittedStatus = weworkWritebackForm.status;
    await recordConsultationWeworkWriteback({
      taskId: weworkWritebackForm.taskId,
      externalContactId: weworkWritebackForm.externalContactId.trim(),
      adapterMode: weworkWritebackForm.adapterMode,
      status: submittedStatus,
      result: submittedStatus === "FAILED" ? "WEWORK_CONTACT_FAILED" : "WEWORK_CONTACTED",
      note: weworkWritebackForm.note.trim(),
      requestId,
    }, requestId);
    await load();
    if (advisorWorkbenchVisible.value) await loadAdvisorWorkbenchBundle();
    ElMessage.success(submittedStatus === "FAILED" ? "企微联系失败已记录" : "企微联系已写回");
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    weworkWritebackLoading.value = false;
  }
}

function resetFilters() {
  Object.assign(filters, defaultFilters());
  selectedPresetId.value = "";
  load();
}

function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function sensitivityLabel(value) {
  const normalized = String(value || "UNKNOWN").toUpperCase();
  if (normalized === "MASKED") return "已脱敏";
  if (normalized === "RAW") return "原文字段";
  return "未标记";
}

function approvalLabel(row) {
  if (!row?.approvalRequired) return "无需审批";
  const status = String(row.approvalStatus || "PENDING").toUpperCase();
  if (status === "APPROVED") return "已通过";
  if (status === "REJECTED") return "已拒绝";
  return "待审批";
}

function approvalTagType(row) {
  if (!row?.approvalRequired) return "info";
  const status = String(row.approvalStatus || "PENDING").toUpperCase();
  if (status === "APPROVED") return "success";
  if (status === "REJECTED") return "danger";
  return "warning";
}

function deliveryLabel(row) {
  const delivery = row?.delivery || {};
  const status = String(delivery.status || "NOT_REQUESTED").toUpperCase();
  if (status === "DELIVERED") return "已交付";
  if (status === "READY") return "待交付";
  if (status === "PENDING_APPROVAL") return "待审批";
  if (status === "RETRY_SCHEDULED") return "待重试";
  if (status === "DEAD_LETTER") return "死信";
  if (status === "FAILED") return "失败";
  if (status === "SKIPPED") return "已跳过";
  return "未请求";
}

function deliveryTagType(row) {
  const status = String(row?.delivery?.status || "NOT_REQUESTED").toUpperCase();
  if (status === "DELIVERED") return "success";
  if (status === "READY") return "warning";
  if (status === "PENDING_APPROVAL") return "warning";
  if (status === "RETRY_SCHEDULED") return "warning";
  if (status === "DEAD_LETTER") return "danger";
  if (status === "FAILED") return "danger";
  if (status === "SKIPPED") return "info";
  return "info";
}

function deliveryHealthStatusLabel(status) {
  const normalized = String(status || "").toUpperCase();
  if (normalized === "HEALTHY") return "通道健康";
  if (normalized === "WARNING") return "需要关注";
  if (normalized === "BLOCKED") return "交付阻塞";
  if (normalized === "PENDING") return "等待处理";
  return "暂无交付";
}

function deliveryHealthAlertType(status) {
  const normalized = String(status || "").toUpperCase();
  if (normalized === "HEALTHY") return "success";
  if (normalized === "BLOCKED") return "error";
  if (normalized === "WARNING") return "warning";
  return "info";
}

const deliveryHealthCards = computed(() => {
  const summary = lifecycleExportDeliveryHealth.value?.summary || {};
  return [
    { key: "requested", label: "交付请求", value: summary.requestedCount || 0 },
    { key: "delivered", label: "已成功", value: summary.deliveredCount || 0 },
    { key: "dueRetry", label: "到期重试", value: summary.dueRetryCount || 0 },
    { key: "retryScheduled", label: "排队重试", value: summary.retryScheduledCount || 0 },
    { key: "deadLetter", label: "死信", value: summary.deadLetterCount || 0 },
    { key: "successRate", label: "成功率", value: `${summary.successRate || 0}%` },
  ];
});

function canDownloadLifecycleExport(row) {
  if (!row?.approvalRequired) return true;
  return row.approvalStatus === "APPROVED";
}

function downloadLifecycleExportTitle(row) {
  return canDownloadLifecycleExport(row) ? "" : "导出记录需要审批通过后才能下载";
}

function canDeliverLifecycleExport(row) {
  if (!canDataExportApprove.value) return false;
  return canDownloadLifecycleExport(row);
}

function deliveryLifecycleExportTitle(row) {
  if (!canDataExportApprove.value) return dataExportApproveTitle.value;
  return canDeliverLifecycleExport(row) ? "生成内部下载链接交付记录" : "导出记录需要审批通过后才能交付";
}

async function downloadCsv() {
  exportLoading.value = true;
  errorMessage.value = "";
  try {
    const csv = await exportLifecycleUsersCsv(filters);
    downloadTextFile(`root-lifecycle-users-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    exportLoading.value = false;
  }
}

async function loadLifecycleUserExports() {
  exportRecordLoading.list = true;
  errorMessage.value = "";
  try {
    const result = await fetchLifecycleUserExports({ limit: 30 });
    lifecycleUserExports.value = result.exports || result || [];
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    exportRecordLoading.list = false;
  }
}

async function loadLifecycleExportDeliveryHealth() {
  exportRecordLoading.health = true;
  errorMessage.value = "";
  try {
    lifecycleExportDeliveryHealth.value = await fetchLifecycleExportDeliveryHealth({ issueLimit: 10 });
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    exportRecordLoading.health = false;
  }
}

function openLifecycleUserExports() {
  lifecycleExportDrawerVisible.value = true;
  return Promise.all([loadLifecycleUserExports(), loadLifecycleExportDeliveryHealth()]);
}

async function createLifecycleUserExportRecord() {
  exportRecordLoading.create = true;
  errorMessage.value = "";
  try {
    const requestId = newRequestId("lifecycle-users-export");
    const result = await createLifecycleUserExport({
      filters: filterSnapshot(),
      retentionDays: 7,
      requestId,
      reason: "Element Plus Admin 生成生命周期导出记录",
    }, requestId);
    lifecycleExportResult.value = result;
    lifecycleExportDrawerVisible.value = true;
    await loadLifecycleUserExports();
    await loadLifecycleExportDeliveryHealth();
    ElMessage.success("生命周期导出记录已生成");
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    exportRecordLoading.create = false;
  }
}

async function downloadStoredLifecycleExport(row) {
  if (!row?.exportId) return;
  if (!canDownloadLifecycleExport(row)) {
    ElMessage.warning("导出记录需要审批通过后才能下载");
    return;
  }
  exportRecordLoading.download = row.exportId;
  errorMessage.value = "";
  try {
    const result = await downloadLifecycleUserExportCsv(row.exportId);
    downloadTextFile(result.filename || row.filename || `root-lifecycle-users-${row.exportId}.csv`, result.csv);
    await loadLifecycleUserExports();
    await loadLifecycleExportDeliveryHealth();
    ElMessage.success("导出记录已下载");
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    exportRecordLoading.download = "";
  }
}

async function reviewLifecycleExport(row, decision) {
  if (!row?.exportId) return;
  if (!canDataExportApprove.value) {
    ElMessage.warning(dataExportApproveTitle.value);
    return;
  }
  exportRecordLoading.review = `${row.exportId}:${decision}`;
  errorMessage.value = "";
  try {
    const requestId = newRequestId("lifecycle-export-review");
    const result = await reviewLifecycleUserExport({
      exportId: row.exportId,
      decision,
      requestId,
      note: decision === "APPROVED" ? "Element Plus Admin 审批通过生命周期导出下载" : "Element Plus Admin 拒绝生命周期导出下载",
    }, requestId);
    lifecycleExportResult.value = result.exportRecord || result;
    await loadLifecycleUserExports();
    await loadLifecycleExportDeliveryHealth();
    ElMessage.success(decision === "APPROVED" ? "导出下载审批已通过" : "导出下载审批已拒绝");
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    exportRecordLoading.review = "";
  }
}

async function deliverLifecycleExportRecord(row) {
  if (!row?.exportId) return;
  if (!canDeliverLifecycleExport(row)) {
    ElMessage.warning(deliveryLifecycleExportTitle(row));
    return;
  }
  exportRecordLoading.deliver = row.exportId;
  errorMessage.value = "";
  try {
    const requestId = newRequestId("lifecycle-export-delivery");
    const result = await deliverLifecycleUserExport({
      exportId: row.exportId,
      deliveryEnabled: true,
      deliveryChannel: "INTERNAL_LINK",
      requestId,
      reason: "Element Plus Admin 交付生命周期导出记录",
    }, requestId);
    lifecycleExportResult.value = result.exportRecord || result;
    await loadLifecycleUserExports();
    await loadLifecycleExportDeliveryHealth();
    ElMessage.success(result.delivered ? "导出交付已记录" : "导出交付已处理");
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    exportRecordLoading.deliver = "";
  }
}

function lifecycleExportCleanupPayload(dryRun = true) {
  return {
    dryRun,
    limit: 50,
    objectCleanup: true,
    reason: dryRun ? "预览用户生命周期导出过期清理" : "执行用户生命周期导出过期清理",
  };
}

async function runLifecycleExportCleanup(dryRun = true) {
  if (!canDataExportApprove.value) {
    ElMessage.warning(dataExportApproveTitle.value || "当前角色缺少数据导出审批权限");
    return;
  }
  const key = dryRun ? "cleanupPreview" : "cleanupExecute";
  exportRecordLoading[key] = true;
  errorMessage.value = "";
  try {
    const requestId = dryRun ? "" : newRequestId("lifecycle-user-exports-cleanup");
    lifecycleExportCleanupResult.value = await runLifecycleUserExportsCleanup({
      ...lifecycleExportCleanupPayload(dryRun),
      requestId: requestId || undefined,
    }, requestId);
    await loadLifecycleUserExports();
    await loadLifecycleExportDeliveryHealth();
    ElMessage.success(dryRun ? "导出过期清理预览已生成" : "导出过期清理已执行");
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    exportRecordLoading[key] = false;
  }
}

function previewLifecycleExportCleanup() {
  return runLifecycleExportCleanup(true);
}

function executeLifecycleExportCleanup() {
  return runLifecycleExportCleanup(false);
}

function ensureBatchRootUserIds() {
  if (!currentRootUserIds.value.length) {
    ElMessage.warning("当前列表没有可批量结算的用户");
    return null;
  }
  return currentRootUserIds.value;
}

function ensureBatchRequestId() {
  if (!batchSettlementForm.requestId) {
    batchSettlementForm.requestId = `lifecycle-batch-${Date.now().toString(36)}`;
  }
  return batchSettlementForm.requestId;
}

function newRequestId(prefix, suffix = "") {
  return [prefix, suffix, Date.now().toString(36)].filter(Boolean).join("-");
}

function batchSettlementPayload() {
  return {
    rootUserIds: currentRootUserIds.value,
    campaignId: activeBatchCampaignId.value,
  };
}

function filterBatchPayload() {
  return {
    filters: filterSnapshot(),
    campaignId: activeBatchCampaignId.value,
    selectionLimit: batchSettlementForm.selectionLimit,
  };
}

async function runBatchAction(key, action, successMessage) {
  batchLoading[key] = true;
  errorMessage.value = "";
  try {
    await action();
    if (successMessage) ElMessage.success(successMessage);
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    batchLoading[key] = false;
  }
}

function previewBatchSettlement() {
  const rootUserIds = ensureBatchRootUserIds();
  if (!rootUserIds) return null;
  return runBatchAction("preview", async () => {
    batchSettlementResult.value = await previewLifecycleSettlementBatch({
      ...batchSettlementPayload(),
      rootUserIds,
    });
    batchResultVisible.value = true;
  }, "批量结算预览已生成");
}

function executeBatchSettlement() {
  const rootUserIds = ensureBatchRootUserIds();
  if (!rootUserIds) return null;
  if (!canSettlementExecute.value) {
    ElMessage.warning(settlementExecuteTitle.value || "当前角色缺少活动结算执行权限");
    return null;
  }
  return runBatchAction("execute", async () => {
    const requestId = ensureBatchRequestId();
    batchSettlementResult.value = await executeLifecycleSettlementBatch({
      ...batchSettlementPayload(),
      rootUserIds,
      requestId,
      confirmRisk: batchSettlementForm.confirmRisk,
      reason: "用户生命周期筛选结果批量结算",
    }, requestId);
    batchResultVisible.value = true;
    await load();
  }, "批量结算已执行");
}

function previewFilterBatchSettlement() {
  return runBatchAction("filterPreview", async () => {
    batchSettlementResult.value = await previewLifecycleFilterSettlementBatch(filterBatchPayload());
    batchResultVisible.value = true;
  }, "筛选批量结算预览已生成");
}

function executeFilterBatchSettlement() {
  if (!canSettlementExecute.value) {
    ElMessage.warning(settlementExecuteTitle.value || "当前角色缺少活动结算执行权限");
    return null;
  }
  return runBatchAction("filterExecute", async () => {
    const requestId = ensureBatchRequestId();
    batchSettlementResult.value = await executeLifecycleFilterSettlementBatch({
      ...filterBatchPayload(),
      requestId,
      confirmRisk: batchSettlementForm.confirmRisk,
      reason: "用户生命周期筛选全量批量结算",
    }, requestId);
    batchResultVisible.value = true;
    await load();
  }, "筛选批量结算已执行");
}

function jobStatusType(status) {
  if (status === "COMPLETED") return "success";
  if (status === "COMPLETED_WITH_ERRORS" || status === "FAILED") return "warning";
  if (status === "CANCELLED") return "info";
  return "primary";
}

function canRunSettlementJob(job) {
  return job && ["QUEUED", "RUNNING"].includes(job.status) && Number(job.summary?.pending || 0) > 0;
}

function canCancelSettlementJob(job) {
  return job && !["COMPLETED", "COMPLETED_WITH_ERRORS", "CANCELLED", "FAILED"].includes(job.status);
}

function jobActionBusy(action, job) {
  return jobLoading.action === `${action}:${job.jobId}`;
}

function selectSettlementJob(row) {
  selectedSettlementJob.value = row;
}

async function loadSettlementJobs() {
  jobLoading.list = true;
  errorMessage.value = "";
  try {
    const result = await fetchLifecycleSettlementJobs({ campaignId: activeBatchCampaignId.value, limit: 30 });
    lifecycleSettlementJobs.value = result.jobs || [];
    if (!selectedSettlementJob.value && lifecycleSettlementJobs.value.length) selectedSettlementJob.value = lifecycleSettlementJobs.value[0];
    if (selectedSettlementJob.value) {
      selectedSettlementJob.value = lifecycleSettlementJobs.value.find((job) => job.jobId === selectedSettlementJob.value.jobId) || lifecycleSettlementJobs.value[0] || null;
    }
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    jobLoading.list = false;
  }
}

function openSettlementJobs() {
  settlementJobDrawerVisible.value = true;
  return loadSettlementJobs();
}

function settlementSchedulerPayload(dryRun = true) {
  return {
    campaignId: activeBatchCampaignId.value || undefined,
    dryRun,
    batchSize: batchSettlementForm.batchSize || 20,
    jobLimit: 3,
    reason: dryRun ? "预览生命周期结算队列自动调度" : "执行生命周期结算队列自动调度",
  };
}

async function runSettlementScheduler(dryRun = true) {
  if (!canSettlementExecute.value) {
    ElMessage.warning(settlementExecuteTitle.value || "当前角色缺少活动结算执行权限");
    return;
  }
  const key = dryRun ? "schedulerPreview" : "schedulerExecute";
  jobLoading[key] = true;
  errorMessage.value = "";
  try {
    const requestId = dryRun ? "" : newRequestId("lifecycle-settlement-due");
    settlementSchedulerResult.value = await runLifecycleSettlementScheduler({
      ...settlementSchedulerPayload(dryRun),
      requestId: requestId || undefined,
    }, requestId);
    await loadSettlementJobs();
    if (!dryRun) await load();
    ElMessage.success(dryRun ? "调度预览已生成" : "调度批次已执行");
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    jobLoading[key] = false;
  }
}

function previewSettlementScheduler() {
  return runSettlementScheduler(true);
}

function executeSettlementScheduler() {
  return runSettlementScheduler(false);
}

function settlementCleanupPayload(dryRun = true) {
  return {
    campaignId: activeBatchCampaignId.value || undefined,
    dryRun,
    staleMinutes: 120,
    cancelAfterMinutes: 1440,
    allowCancel: false,
    jobLimit: 20,
    reason: dryRun ? "预览生命周期结算队列超时清理" : "执行生命周期结算队列超时清理",
  };
}

async function runSettlementCleanup(dryRun = true) {
  if (!canSettlementExecute.value) {
    ElMessage.warning(settlementExecuteTitle.value || "当前角色缺少活动结算执行权限");
    return;
  }
  const key = dryRun ? "cleanupPreview" : "cleanupExecute";
  jobLoading[key] = true;
  errorMessage.value = "";
  try {
    const requestId = dryRun ? "" : newRequestId("lifecycle-settlement-cleanup");
    settlementCleanupResult.value = await runLifecycleSettlementCleanup({
      ...settlementCleanupPayload(dryRun),
      requestId: requestId || undefined,
    }, requestId);
    await loadSettlementJobs();
    ElMessage.success(dryRun ? "清理预览已生成" : "超时清理已执行");
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    jobLoading[key] = false;
  }
}

function previewSettlementCleanup() {
  return runSettlementCleanup(true);
}

function executeSettlementCleanup() {
  return runSettlementCleanup(false);
}

function createFilterSettlementJob() {
  if (!canSettlementExecute.value) {
    ElMessage.warning(settlementExecuteTitle.value || "当前角色缺少活动结算执行权限");
    return null;
  }
  return runBatchAction("filterPreview", async () => {
    jobLoading.create = true;
    try {
      const requestId = newRequestId("lifecycle-job-create");
      const result = await createLifecycleSettlementJob({
        ...filterBatchPayload(),
        batchSize: batchSettlementForm.batchSize,
        requestId,
        confirmRisk: batchSettlementForm.confirmRisk,
        reason: "用户生命周期筛选结算队列",
      }, requestId);
      selectedSettlementJob.value = result.job;
      settlementJobDrawerVisible.value = true;
      await loadSettlementJobs();
      ElMessage.success("筛选结算队列已创建");
    } finally {
      jobLoading.create = false;
    }
  });
}

async function runJobAction(action, job, handler, successMessage) {
  if (!canSettlementExecute.value) {
    ElMessage.warning(settlementExecuteTitle.value || "当前角色缺少活动结算执行权限");
    return;
  }
  jobLoading.action = `${action}:${job.jobId}`;
  errorMessage.value = "";
  try {
    await handler();
    await loadSettlementJobs();
    if (successMessage) ElMessage.success(successMessage);
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    jobLoading.action = "";
  }
}

function runSettlementJob(job) {
  if (!canRunSettlementJob(job)) return null;
  return runJobAction("run", job, async () => {
    const requestId = newRequestId("lifecycle-job-run", job.jobId);
    const result = await runLifecycleSettlementJob({
      jobId: job.jobId,
      requestId,
      batchSize: batchSettlementForm.batchSize || job.batchSize,
      reason: "执行生命周期结算队列下一批",
    }, requestId);
    selectedSettlementJob.value = result.job;
    await load();
  }, "队列批次已执行");
}

function cancelSettlementJob(job) {
  if (!canCancelSettlementJob(job)) return null;
  return runJobAction("cancel", job, async () => {
    const requestId = newRequestId("lifecycle-job-cancel", job.jobId);
    const result = await cancelLifecycleSettlementJob({
      jobId: job.jobId,
      requestId,
      reason: "取消生命周期结算队列",
    }, requestId);
    selectedSettlementJob.value = result.job;
  }, "队列已取消");
}

function retrySettlementJob(job) {
  if (!(job.summary?.failed > 0)) return null;
  return runJobAction("retry", job, async () => {
    const requestId = newRequestId("lifecycle-job-retry", job.jobId);
    const result = await retryFailedLifecycleSettlementJob({
      jobId: job.jobId,
      requestId,
      reason: "重试生命周期结算队列失败项",
    }, requestId);
    selectedSettlementJob.value = result.job;
  }, "失败项已放回队列");
}

onMounted(() => {
  loadPresets();
  load();
});

defineExpose({
  applySelectedPreset,
  copySelectedPreset,
  createLifecycleUserExportRecord,
  deleteSelectedPreset,
  downloadCsv,
  downloadStoredLifecycleExport,
  cancelSettlementJob,
  createFilterSettlementJob,
  executeBatchSettlement,
  executeLifecycleExportCleanup,
  loadLifecycleExportDeliveryHealth,
  executeSettlementCleanup,
  executeSettlementScheduler,
  executeFilterBatchSettlement,
  loadAdvisorWorkbench,
  load,
  loadLifecycleUserExports,
  loadSettlementJobs,
  openAdvisorWorkbench,
  openLifecycleUserExports,
  previewBatchSettlement,
  previewLifecycleExportCleanup,
  previewSettlementCleanup,
  previewSettlementScheduler,
  previewFilterBatchSettlement,
  retrySettlementJob,
  runSettlementJob,
  saveCurrentPreset,
  submitAdvisorAssignment,
  submitWeworkWriteback,
});
</script>

<style scoped>
.filter-space {
  justify-content: flex-end;
}

.filter-space :deep(.el-input),
.filter-space :deep(.el-select) {
  width: 180px;
}

.filter-space :deep(.el-input-number) {
  width: 118px;
}

.batch-action-strip {
  border-bottom: 1px solid var(--el-border-color-lighter);
  padding: 0 0 14px;
}

.batch-action-strip :deep(.el-input) {
  width: 180px;
}

.batch-action-strip :deep(.el-input-number) {
  width: 132px;
}

.drawer-table {
  margin-top: 16px;
}

.drawer-toolbar {
  margin-bottom: 12px;
}

.wework-writeback-panel {
  margin-top: 16px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  padding: 12px;
}

.wework-writeback-panel :deep(.el-input),
.wework-writeback-panel :deep(.el-select) {
  width: 180px;
}

.section-title {
  margin-bottom: 10px;
  color: #17201a;
  font-weight: 700;
}

.delivery-health-panel {
  display: grid;
  gap: 12px;
  margin: 10px 0 14px;
}

.delivery-health-cards {
  display: grid;
  grid-template-columns: repeat(6, minmax(96px, 1fr));
  gap: 8px;
}

.delivery-health-card {
  min-height: 68px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: #fffdf8;
  padding: 10px;
}

.delivery-health-card span {
  display: block;
  color: #6f766d;
  font-size: 12px;
}

.delivery-health-card strong {
  display: block;
  margin-top: 8px;
  color: #17201a;
  font-size: 20px;
  line-height: 1;
}

.advisor-card-row {
  margin: 8px 0 14px;
}

.advisor-card {
  min-height: 64px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: #f9fbf7;
  padding: 10px;
}

.advisor-card span {
  display: block;
  color: #6f766d;
  font-size: 12px;
}

.advisor-card strong {
  display: block;
  margin-top: 8px;
  color: #17201a;
  font-size: 20px;
  line-height: 1;
}

.advisor-section-title {
  margin-top: 16px;
}

.option-tag {
  margin-left: 6px;
}
</style>
