<template>
  <section class="workbench release-workbench">
    <el-alert
      v-if="errorMessage"
      :closable="false"
      :title="errorMessage"
      class="workbench-alert"
      type="error"
    />

    <el-card shadow="never">
      <template #header>
        <div class="toolbar-title">
          <span>发布校准</span>
          <el-space wrap>
            <el-select v-model="target" class="target-select" @change="load">
              <el-option label="production" value="production" />
              <el-option label="gray" value="gray" />
            </el-select>
            <el-button :loading="loading" type="primary" @click="load">刷新</el-button>
          </el-space>
        </div>
      </template>

      <div class="release-summary-grid">
        <div v-for="item in summaryCards" :key="item.key" class="release-summary-tile">
          <span>{{ item.label }}</span>
          <strong>{{ item.value }}</strong>
        </div>
      </div>
    </el-card>

    <el-card shadow="never">
      <template #header>
        <div class="toolbar-title">
          <span>外部动作 Adapter 校准</span>
          <el-tag v-if="actionAdapterCalibrationGate" :type="statusType(actionAdapterCalibrationGate.status)" effect="plain">
            {{ actionAdapterCalibrationGate.status }}
          </el-tag>
        </div>
      </template>

      <el-empty v-if="!actionAdapterCalibrationGate" description="暂无动作 Adapter 校准证据" />
      <template v-else>
        <div class="release-summary-grid action-adapter-summary-grid">
          <div v-for="item in actionAdapterCalibrationSummaryCards" :key="item.key" class="release-summary-tile">
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
          </div>
        </div>
        <el-row :gutter="16">
          <el-col :span="14">
            <div class="evidence-panel">
              <div class="evidence-panel-title">动作校准项</div>
              <el-table :data="actionAdapterCalibrationActions" height="260">
                <el-table-column prop="label" label="动作" min-width="180" />
                <el-table-column prop="adapterType" label="Adapter" min-width="150" />
                <el-table-column prop="group" label="分组" width="110" />
                <el-table-column label="状态" width="120">
                  <template #default="{ row }">
                    <el-tag :type="statusType(row.status)" effect="plain">{{ row.status }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="blockers" label="阻塞" width="90" />
                <el-table-column prop="warnings" label="提醒" width="90" />
              </el-table>
            </div>
          </el-col>
          <el-col :span="10">
            <div class="evidence-panel">
              <div class="evidence-panel-title">检查结果</div>
              <el-table :data="actionAdapterCalibrationIssues" height="260">
                <el-table-column prop="type" label="类型" width="90" />
                <el-table-column prop="action" label="动作" width="140" />
                <el-table-column prop="message" label="事项" min-width="240" />
              </el-table>
            </div>
          </el-col>
        </el-row>
      </template>
    </el-card>

    <el-card shadow="never">
      <template #header>
        <div class="toolbar-title">
          <span>生产证据收口</span>
          <el-tag v-if="productionEvidenceIntake" :type="statusType(productionEvidenceIntake.status)" effect="plain">
            {{ productionEvidenceIntake.status }}
          </el-tag>
        </div>
      </template>

      <el-empty v-if="!productionEvidenceIntake" description="暂无生产证据收口记录" />
      <template v-else>
        <div class="release-summary-grid production-evidence-summary-grid">
          <div v-for="item in productionEvidenceSummaryCards" :key="item.key" class="release-summary-tile">
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
          </div>
        </div>
        <el-row :gutter="16">
          <el-col :span="15">
            <div class="evidence-panel">
              <div class="evidence-panel-title">外部证据项</div>
              <el-table :data="productionEvidenceItems" height="300">
                <el-table-column prop="backlogId" label="编号" width="85" />
                <el-table-column prop="groupLabel" label="范围" width="110" />
                <el-table-column prop="label" label="事项" min-width="240" />
                <el-table-column label="状态" width="120">
                  <template #default="{ row }">
                    <el-tag :type="statusType(row.status)" effect="plain">{{ row.status }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="ownerRole" label="负责人" width="120" />
                <el-table-column prop="source" label="来源" min-width="180" />
              </el-table>
            </div>
          </el-col>
          <el-col :span="9">
            <div class="evidence-panel">
              <div class="evidence-panel-title">下一步动作</div>
              <el-table :data="productionEvidenceIssues" height="300">
                <el-table-column prop="type" label="类型" width="90" />
                <el-table-column prop="message" label="事项" min-width="260" />
              </el-table>
            </div>
          </el-col>
        </el-row>
      </template>
    </el-card>

    <el-card shadow="never">
      <template #header>
        <div class="toolbar-title">
          <span>Root 会员中心购买跳转</span>
          <el-space wrap>
            <el-tag v-if="rootMemberCenterGate" :type="statusType(rootMemberCenterGate.status)" effect="plain">
              {{ rootMemberCenterGate.status }}
            </el-tag>
            <el-select v-model="rootJumpProofForm.productId" class="root-jump-proof-product-select" placeholder="商品">
              <el-option
                v-for="item in rootMemberCenterProducts"
                :key="item.productId"
                :label="item.title || item.productId"
                :value="item.productId"
              />
            </el-select>
            <el-select v-model="rootJumpProofForm.status" class="root-jump-proof-status-select">
              <el-option label="VERIFIED" value="VERIFIED" />
              <el-option label="REJECTED" value="REJECTED" />
            </el-select>
            <el-input v-model="rootJumpProofForm.evidenceRef" class="root-jump-proof-ref-input" clearable placeholder="证据引用" />
            <el-input v-model="rootJumpProofForm.note" class="root-jump-proof-note-input" clearable placeholder="备注" />
            <el-button
              :disabled="!selectedRootMemberCenterProduct"
              :loading="rootJumpProofLoading"
              type="primary"
              @click="submitRootJumpProof"
            >
              记录跳转证明
            </el-button>
          </el-space>
        </div>
      </template>

      <el-empty v-if="!rootMemberCenterGate" description="暂无购买跳转证据" />
      <template v-else>
        <div class="release-summary-grid root-member-center-summary-grid">
          <div v-for="item in rootMemberCenterSummaryCards" :key="item.key" class="release-summary-tile">
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
          </div>
        </div>
        <el-row :gutter="16">
          <el-col :span="14">
            <div class="evidence-panel">
              <div class="evidence-panel-title">商品跳转检查</div>
              <el-table :data="rootMemberCenterProducts" height="260">
                <el-table-column prop="productId" label="商品" min-width="160" />
                <el-table-column prop="title" label="标题" min-width="180" />
                <el-table-column label="状态" width="120">
                  <template #default="{ row }">
                    <el-tag :type="statusType(row.status)" effect="plain">{{ row.status }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="appId" width="110">
                  <template #default="{ row }">
                    {{ row.appIdConfigured ? "已配置" : "缺失" }}
                  </template>
                </el-table-column>
                <el-table-column prop="appIdSource" label="appId 来源" min-width="150" />
                <el-table-column label="路径" width="100">
                  <template #default="{ row }">
                    {{ row.pathConfigured ? "已配置" : "缺失" }}
                  </template>
                </el-table-column>
                <el-table-column prop="pathSource" label="路径来源" min-width="140" />
                <el-table-column label="证明" width="120">
                  <template #default="{ row }">
                    <el-tag :type="statusType(row.proofStatus)" effect="plain">{{ row.proofStatus }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="proofRecordedAt" label="证明时间" min-width="180" />
              </el-table>
            </div>
          </el-col>
          <el-col :span="10">
            <div class="evidence-panel">
              <div class="evidence-panel-title">阻塞与动作</div>
              <el-table :data="rootMemberCenterIssues" height="260">
                <el-table-column prop="type" label="类型" width="90" />
                <el-table-column prop="message" label="事项" min-width="240" />
              </el-table>
            </div>
          </el-col>
        </el-row>
      </template>
    </el-card>

    <el-card shadow="never">
      <template #header>
        <div class="toolbar-title">
          <span>发布证据包</span>
          <el-space wrap>
            <el-tag v-if="releaseEvidencePack" :type="statusType(releaseEvidencePack.status)" effect="plain">
              {{ releaseEvidencePack.status }}
            </el-tag>
            <el-input v-model="archiveNote" class="archive-note-input" clearable placeholder="留档备注" />
            <el-button :disabled="!releaseEvidencePack" :loading="archiveLoading" type="primary" @click="archiveEvidence">
              留档
            </el-button>
            <el-button :disabled="!releaseEvidencePack" @click="downloadEvidenceJson">下载 JSON</el-button>
          </el-space>
        </div>
      </template>

      <el-empty v-if="!releaseEvidencePack" description="暂无证据包" />
      <template v-else>
        <div class="release-summary-grid evidence-summary-grid">
          <div v-for="item in evidenceSummaryCards" :key="item.key" class="release-summary-tile">
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
          </div>
        </div>

        <el-row :gutter="16" class="evidence-pack-row">
          <el-col :span="12">
            <div class="evidence-panel">
              <div class="evidence-panel-title">阻塞与提醒</div>
              <el-table :data="evidenceIssues" height="220">
                <el-table-column prop="type" label="类型" width="90" />
                <el-table-column prop="message" label="事项" min-width="260" />
              </el-table>
            </div>
          </el-col>
          <el-col :span="12">
            <div class="evidence-panel">
              <div class="evidence-panel-title">留证命令</div>
              <el-table :data="evidenceCommands" height="220">
                <el-table-column prop="command" label="命令" min-width="360" />
              </el-table>
            </div>
          </el-col>
        </el-row>

        <div class="evidence-panel evidence-archive-panel">
          <div class="evidence-panel-title">最近留档</div>
          <el-empty v-if="!evidenceArchives.length" description="暂无留档" />
          <el-table v-else :data="evidenceArchives" height="220">
            <el-table-column prop="archivedAt" label="留档时间" width="180" />
            <el-table-column prop="target" label="目标" width="110" />
            <el-table-column label="状态" width="110">
              <template #default="{ row }">
                <el-tag :type="statusType(row.status)" effect="plain">{{ row.status }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="operatorId" label="操作人" width="130" />
            <el-table-column prop="note" label="备注" min-width="220" />
            <el-table-column label="操作" width="110" fixed="right">
              <template #default="{ row }">
                <el-button
                  :loading="archiveDownloadLoading === row.archiveId"
                  link
                  type="primary"
                  @click="downloadArchivedEvidence(row)"
                >
                  下载
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </template>
    </el-card>

    <el-card shadow="never">
      <template #header>
        <div class="toolbar-title">
          <span>发布签字</span>
          <el-space wrap>
            <el-select v-model="signoffForm.role" class="signoff-role-select">
              <el-option label="产品" value="PRODUCT" />
              <el-option label="运营" value="OPERATIONS" />
              <el-option label="研发" value="ENGINEERING" />
            </el-select>
            <el-select v-model="signoffForm.status" class="signoff-status-select">
              <el-option label="APPROVED" value="APPROVED" />
              <el-option label="REJECTED" value="REJECTED" />
            </el-select>
            <el-select v-model="signoffForm.archiveId" class="signoff-archive-select" placeholder="选择留档">
              <el-option
                v-for="archive in evidenceArchives"
                :key="archive.archiveId"
                :label="`${archive.archivedAt || archive.archiveId} / ${archive.status}`"
                :value="archive.archiveId"
              />
            </el-select>
            <el-input v-model="signoffForm.note" class="signoff-note-input" clearable placeholder="签字备注" />
            <el-button
              :disabled="!evidenceArchives.length"
              :loading="signoffLoading"
              type="primary"
              @click="submitSignoff"
            >
              记录签字
            </el-button>
          </el-space>
        </div>
      </template>

      <el-alert
        v-if="signoffGate"
        :closable="false"
        :title="signoffGate.message || '发布签字状态待确认'"
        :type="signoffAlertType"
        class="workbench-alert"
        show-icon
      />
      <div v-if="signoffGate" class="release-summary-grid signoff-summary-grid">
        <div v-for="item in signoffSummaryCards" :key="item.key" class="release-summary-tile">
          <span>{{ item.label }}</span>
          <strong>{{ item.value }}</strong>
        </div>
      </div>
      <el-table :data="releaseSignoffs" height="220">
        <el-table-column prop="roleLabel" label="角色" width="100" />
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" effect="plain">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="archiveId" label="留档" min-width="170" />
        <el-table-column prop="operatorId" label="操作人" width="130" />
        <el-table-column prop="signedAt" label="签字时间" width="180" />
        <el-table-column prop="note" label="备注" min-width="240" />
      </el-table>
    </el-card>

    <el-card shadow="never">
      <template #header>
        <div class="toolbar-title">
          <span>Admin 迁移 Gate</span>
          <el-space wrap>
            <el-tag v-if="adminTransitionGate" :type="statusType(adminTransitionGate.status)" effect="plain">
              {{ adminTransitionGate.status }}
            </el-tag>
            <el-select v-model="adminLegacyDecisionForm.status" class="admin-legacy-decision-status-select">
              <el-option label="APPROVED" value="APPROVED" />
              <el-option label="REJECTED" value="REJECTED" />
            </el-select>
            <el-input v-model="adminLegacyDecisionForm.evidenceRef" class="admin-legacy-decision-ref-input" clearable placeholder="证据引用" />
            <el-input v-model="adminLegacyDecisionForm.rollbackRef" class="admin-legacy-decision-ref-input" clearable placeholder="回滚引用" />
            <el-input v-model="adminLegacyDecisionForm.note" class="admin-legacy-decision-note-input" clearable placeholder="备注" />
            <el-button :loading="adminLegacyDecisionLoading" type="primary" @click="submitAdminLegacyDecision">
              记录下线决策
            </el-button>
          </el-space>
        </div>
      </template>

      <el-empty v-if="!adminTransitionGate" description="暂无 Admin 迁移证据" />
      <template v-else>
        <div class="release-summary-grid admin-transition-summary-grid">
          <div v-for="item in adminTransitionSummaryCards" :key="item.key" class="release-summary-tile">
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
          </div>
        </div>
        <el-row :gutter="16">
          <el-col :span="12">
            <div class="evidence-panel">
              <div class="evidence-panel-title">模块覆盖</div>
              <el-table :data="adminTransitionModules" height="220">
                <el-table-column prop="label" label="模块" min-width="150" />
                <el-table-column label="状态" width="120">
                  <template #default="{ row }">
                    <el-tag :type="statusType(row.status)" effect="plain">{{ row.status }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="file" label="文件" min-width="260" />
              </el-table>
            </div>
          </el-col>
          <el-col :span="12">
            <div class="evidence-panel">
              <div class="evidence-panel-title">阻塞与提醒</div>
              <el-table :data="adminTransitionIssues" height="220">
                <el-table-column prop="type" label="类型" width="90" />
                <el-table-column prop="message" label="事项" min-width="260" />
              </el-table>
            </div>
          </el-col>
        </el-row>
      </template>
    </el-card>

    <el-card shadow="never">
      <template #header>
        <div class="toolbar-title">
          <span>生产切换 Gate</span>
          <el-space wrap>
            <el-tag v-if="productionCutoverGate" :type="statusType(productionCutoverGate.status)" effect="plain">
              {{ productionCutoverGate.status }}
            </el-tag>
            <el-select v-model="cutoverProofForm.itemId" class="cutover-proof-item-select" placeholder="证明项">
              <el-option
                v-for="item in productionCutoverItems"
                :key="item.id"
                :label="item.label"
                :value="item.id"
              />
            </el-select>
            <el-select v-model="cutoverProofForm.status" class="cutover-proof-status-select">
              <el-option label="VERIFIED" value="VERIFIED" />
              <el-option label="REJECTED" value="REJECTED" />
            </el-select>
            <el-input v-model="cutoverProofForm.evidenceRef" class="cutover-proof-ref-input" clearable placeholder="证据引用（VERIFIED 必填）" />
            <el-input v-model="cutoverProofForm.note" class="cutover-proof-note-input" clearable placeholder="备注" />
            <el-button
              :disabled="cutoverProofSubmissionDisabled"
              :loading="cutoverProofLoading"
              type="primary"
              @click="submitCutoverProof"
            >
              记录证明
            </el-button>
          </el-space>
        </div>
      </template>

      <el-empty v-if="!productionCutoverGate" description="暂无生产切换证据" />
      <template v-else>
        <div class="release-summary-grid production-cutover-summary-grid">
          <div v-for="item in productionCutoverSummaryCards" :key="item.key" class="release-summary-tile">
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
          </div>
        </div>
        <el-row :gutter="16">
          <el-col :span="14">
            <div class="evidence-panel">
              <div class="evidence-panel-title">生产证明项</div>
              <el-table :data="productionCutoverItems" height="260">
                <el-table-column prop="groupLabel" label="范围" width="110" />
                <el-table-column prop="label" label="检查项" min-width="190" />
                <el-table-column label="状态" width="120">
                  <template #default="{ row }">
                    <el-tag :type="statusType(row.status)" effect="plain">{{ row.status }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="ownerRole" label="负责人" width="120" />
                <el-table-column label="证明范围" width="110">
                  <template #default="{ row }">
                    {{ row.proofScope === "RELEASE" ? "候选版本" : "运行环境" }}
                  </template>
                </el-table-column>
                <el-table-column prop="proofSource" label="来源" width="90" />
                <el-table-column label="绑定版本" min-width="170">
                  <template #default="{ row }">
                    {{ row.proofRecord?.releaseVersion ? `${row.proofRecord.releaseVersion} / ${row.proofRecord.releaseId}` : "-" }}
                  </template>
                </el-table-column>
                <el-table-column prop="proofEnv" label="证明变量" min-width="260" />
                <el-table-column label="最新记录" min-width="190">
                  <template #default="{ row }">
                    {{ row.proofRecord?.recordedAt || "-" }}
                  </template>
                </el-table-column>
              </el-table>
            </div>
          </el-col>
          <el-col :span="10">
            <div class="evidence-panel">
              <div class="evidence-panel-title">阻塞与提醒</div>
              <el-table :data="productionCutoverIssues" height="260">
                <el-table-column prop="type" label="类型" width="90" />
                <el-table-column prop="message" label="事项" min-width="260" />
              </el-table>
            </div>
          </el-col>
        </el-row>
      </template>
    </el-card>

    <el-card shadow="never">
      <template #header>
        <div class="toolbar-title">
          <span>CloudBase Store 决策</span>
          <el-tag v-if="cloudbaseStoreGate" :type="statusType(cloudbaseStoreGate.status)" effect="plain">
            {{ cloudbaseStoreGate.status }}
          </el-tag>
        </div>
      </template>

      <el-empty v-if="!cloudbaseStoreGate" description="暂无 CloudBase Store 决策" />
      <template v-else>
        <div class="release-summary-grid cloudbase-store-summary-grid">
          <div v-for="item in cloudbaseStoreSummaryCards" :key="item.key" class="release-summary-tile">
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
          </div>
        </div>
        <el-row :gutter="16">
          <el-col :span="14">
            <div class="evidence-panel">
              <div class="evidence-panel-title">决策检查</div>
              <el-table :data="cloudbaseStoreChecks" height="240">
                <el-table-column prop="label" label="检查项" min-width="150" />
                <el-table-column label="状态" width="120">
                  <template #default="{ row }">
                    <el-tag :type="statusType(row.status)" effect="plain">{{ row.status }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="message" label="说明" min-width="280" />
              </el-table>
            </div>
          </el-col>
          <el-col :span="10">
            <div class="evidence-panel">
              <div class="evidence-panel-title">阻塞与动作</div>
              <el-table :data="cloudbaseStoreIssues" height="240">
                <el-table-column prop="type" label="类型" width="90" />
                <el-table-column prop="message" label="事项" min-width="240" />
              </el-table>
            </div>
          </el-col>
        </el-row>
      </template>
    </el-card>

    <el-row :gutter="16">
      <el-col :span="10">
        <el-card shadow="never">
          <template #header>CloudBase 身份透传</template>
          <el-form :model="probeForm" label-position="top">
            <el-form-item label="小程序">
              <el-select v-model="probeForm.appCode">
                <el-option label="MYROOT" value="MYROOT" />
                <el-option label="ROOT_MEMBER_CENTER" value="ROOT_MEMBER_CENTER" />
                <el-option label="YOUZAN_ROOT" value="YOUZAN_ROOT" />
              </el-select>
            </el-form-item>
            <el-form-item label="openid header">
              <el-input v-model="probeForm.openid" clearable placeholder="x-wx-openid" />
            </el-form-item>
            <el-form-item label="unionid header">
              <el-input v-model="probeForm.unionid" clearable placeholder="x-wx-unionid" />
            </el-form-item>
            <el-space wrap>
              <el-button :loading="probeLoading" type="primary" @click="runProbe">运行探针</el-button>
              <el-button @click="clearProbe">清空</el-button>
            </el-space>
          </el-form>
        </el-card>
      </el-col>

      <el-col :span="14">
        <el-card shadow="never">
          <template #header>
            <div class="toolbar-title">
              <span>探针结果</span>
              <el-tag v-if="probeResult" :type="statusType(probeResult.status)" effect="plain">
                {{ probeResult.status }}
              </el-tag>
            </div>
          </template>

          <el-empty v-if="!probeResult" description="暂无探针结果" />
          <template v-else>
            <el-descriptions :column="2" border>
              <el-descriptions-item label="appCode">{{ probeResult.appCode }}</el-descriptions-item>
              <el-descriptions-item label="source">{{ probeResult.source }}</el-descriptions-item>
              <el-descriptions-item label="openid">{{ probeResult.openidPreview || "-" }}</el-descriptions-item>
              <el-descriptions-item label="unionid">{{ probeResult.unionidPreview || "-" }}</el-descriptions-item>
              <el-descriptions-item label="union 主键">{{ probeResult.readyForUnionPrimaryKey ? "READY" : "PENDING" }}</el-descriptions-item>
              <el-descriptions-item label="appid">{{ probeResult.appidPreview || "-" }}</el-descriptions-item>
            </el-descriptions>
            <el-table :data="probeResult.checks || []" class="release-table" height="220">
              <el-table-column prop="label" label="检查" min-width="170" />
              <el-table-column label="状态" width="110">
                <template #default="{ row }">
                  <el-tag :type="statusType(row.status)" effect="plain">{{ row.status }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="message" label="结果" min-width="260" />
            </el-table>
          </template>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="16">
      <el-col :span="12">
        <el-card shadow="never">
          <template #header>上线闸口</template>
          <el-table :data="readinessChecks" height="360">
            <el-table-column prop="label" label="检查项" min-width="170" />
            <el-table-column label="状态" width="110">
              <template #default="{ row }">
                <el-tag :type="statusType(row.status)" effect="plain">{{ row.status }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="message" label="说明" min-width="260" />
          </el-table>
        </el-card>
      </el-col>

      <el-col :span="12">
        <el-card shadow="never">
          <template #header>发布阻塞</template>
          <el-empty v-if="!releaseBlockers.length" description="暂无阻塞项" />
          <el-table v-else :data="releaseBlockers" height="360">
            <el-table-column prop="scope" label="范围" width="130" />
            <el-table-column prop="message" label="事项" min-width="260" />
            <el-table-column prop="owner" label="负责人" width="120" />
          </el-table>
        </el-card>
      </el-col>
    </el-row>
  </section>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import {
  archiveReleaseEvidencePack,
  fetchActionAdapterCalibration,
  fetchCloudbaseIdentityProbe,
  fetchLaunchReadiness,
  fetchReleaseEvidenceArchive,
  fetchReleaseEvidencePack,
  fetchReleaseRecord,
  recordAdminLegacyDeprecationDecision,
  recordProductionCutoverProof,
  recordRootMemberCenterJumpProof,
  signReleaseRecord,
} from "./adminReleaseApi";

const target = ref("production");
const loading = ref(false);
const archiveLoading = ref(false);
const archiveDownloadLoading = ref("");
const signoffLoading = ref(false);
const cutoverProofLoading = ref(false);
const rootJumpProofLoading = ref(false);
const adminLegacyDecisionLoading = ref(false);
const probeLoading = ref(false);
const errorMessage = ref("");
const archiveNote = ref("");
const releaseRecord = ref(null);
const releaseEvidenceBundle = ref(null);
const actionAdapterCalibration = ref(null);
const launchReadiness = ref(null);
const probeResult = ref(null);
const probeForm = reactive({
  appCode: "MYROOT",
  openid: "",
  unionid: "",
});
const signoffForm = reactive({
  role: "PRODUCT",
  status: "APPROVED",
  archiveId: "",
  note: "",
});
const cutoverProofForm = reactive({
  itemId: "",
  status: "VERIFIED",
  evidenceRef: "",
  note: "",
});
const rootJumpProofForm = reactive({
  productId: "",
  status: "VERIFIED",
  evidenceRef: "",
  note: "",
});
const adminLegacyDecisionForm = reactive({
  status: "APPROVED",
  evidenceRef: "",
  rollbackRef: "",
  note: "",
});

const releaseEvidencePack = computed(() => releaseEvidenceBundle.value?.pack || null);
const evidenceArchives = computed(() => releaseEvidenceBundle.value?.archives || []);
const releaseSignoffs = computed(() => releaseRecord.value?.signoffs || []);
const signoffGate = computed(() => releaseRecord.value?.signoffGate || null);
const adminTransitionGate = computed(() => releaseRecord.value?.evidence?.adminTransitionReadiness || null);
const adminLegacyDeprecationDecision = computed(() => adminTransitionGate.value?.legacyDeprecationDecision || null);
const productionEvidenceIntake = computed(() => releaseRecord.value?.evidence?.productionEvidenceIntake || releaseEvidencePack.value?.evidence?.productionEvidenceIntake || null);
const productionCutoverGate = computed(() => releaseRecord.value?.evidence?.productionCutoverReadiness || null);
const cutoverProofSubmissionDisabled = computed(() => {
  if (!productionCutoverItems.value.length || !cutoverProofForm.itemId) return true;
  if (cutoverProofForm.status === "VERIFIED") return !cutoverProofForm.evidenceRef.trim();
  return !cutoverProofForm.evidenceRef.trim() && !cutoverProofForm.note.trim();
});
const cloudbaseStoreGate = computed(() => releaseRecord.value?.evidence?.cloudbaseStoreReadiness || null);
const rootMemberCenterGate = computed(() => releaseRecord.value?.evidence?.rootMemberCenterReadiness || null);
const actionAdapterCalibrationGate = computed(() => {
  return actionAdapterCalibration.value || releaseRecord.value?.evidence?.actionAdapterCalibration || null;
});

const summaryCards = computed(() => {
  const readiness = launchReadiness.value || {};
  const release = releaseRecord.value || {};
  const envMatrix = release.evidence?.productionEnvMatrix || {};
  return [
    { key: "release", label: "发布记录", value: release.status || "-" },
    { key: "evidence", label: "证据包", value: releaseEvidencePack.value?.status || "-" },
    { key: "readiness", label: "上线闸口", value: readiness.status || "-" },
    { key: "env", label: "环境矩阵", value: envMatrix.status || "-" },
    { key: "signoff", label: "签字 Gate", value: signoffGate.value?.status || "-" },
    { key: "actionAdapter", label: "动作 Adapter", value: actionAdapterCalibrationGate.value?.status || "-" },
    { key: "evidenceIntake", label: "证据收口", value: productionEvidenceIntake.value?.status || "-" },
    { key: "admin", label: "Admin 迁移", value: adminTransitionGate.value?.status || "-" },
    { key: "cutover", label: "生产切换", value: productionCutoverGate.value?.status || "-" },
    { key: "cloudbaseStore", label: "CloudBase Store", value: cloudbaseStoreGate.value?.status || "-" },
    { key: "rootMemberCenter", label: "购买跳转", value: rootMemberCenterGate.value?.status || "-" },
    { key: "identity", label: "身份探针", value: probeResult.value?.status || "-" },
  ];
});

const readinessChecks = computed(() => launchReadiness.value?.checks || []);

const evidenceSummaryCards = computed(() => {
  const pack = releaseEvidencePack.value || {};
  const summary = pack.summary || {};
  return [
    { key: "blockers", label: "阻塞", value: summary.blockerCount ?? "-" },
    { key: "warnings", label: "提醒", value: summary.warningCount ?? "-" },
    { key: "jobs", label: "Job", value: summary.jobCount ?? "-" },
    { key: "missingEnv", label: "缺失变量", value: summary.missingEnvCount ?? "-" },
    { key: "signoff", label: "签字", value: summary.signoffGateStatus || "-" },
    { key: "actionAdapter", label: "动作 Adapter", value: summary.actionAdapterCalibrationStatus || "-" },
    { key: "evidenceIntake", label: "证据收口", value: summary.productionEvidenceIntakeStatus || "-" },
    { key: "admin", label: "Admin", value: summary.adminTransitionStatus || "-" },
    { key: "cutover", label: "切换", value: summary.productionCutoverStatus || "-" },
    { key: "cloudbaseStore", label: "CloudBase", value: summary.cloudbaseStoreStatus || "-" },
    { key: "rootMemberCenter", label: "购买跳转", value: summary.rootMemberCenterStatus || "-" },
  ];
});

const signoffSummaryCards = computed(() => {
  const summary = signoffGate.value?.summary || {};
  return [
    { key: "status", label: "Gate", value: signoffGate.value?.status || "-" },
    { key: "approved", label: "已通过", value: summary.approvedCount ?? 0 },
    { key: "pending", label: "待签", value: summary.pendingCount ?? 0 },
    { key: "rejected", label: "已拒绝", value: summary.rejectedCount ?? 0 },
  ];
});

const signoffAlertType = computed(() => {
  const type = statusType(signoffGate.value?.status);
  if (type === "danger") return "error";
  return type;
});

const adminTransitionSummaryCards = computed(() => {
  const summary = adminTransitionGate.value?.summary || {};
  return [
    { key: "status", label: "Gate", value: adminTransitionGate.value?.status || "-" },
    { key: "modules", label: "模块", value: `${summary.readyModuleCount ?? 0}/${summary.requiredModuleCount ?? 0}` },
    { key: "bundle", label: "部署包", value: summary.bundledDistReady ? "READY" : "PENDING" },
    { key: "legacy", label: "旧后台", value: summary.legacyFallbackAvailable ? "保留" : "已移除" },
    { key: "approval", label: "下线批准", value: summary.deprecationApproved ? "YES" : "NO" },
    { key: "decision", label: "下线决策", value: adminLegacyDeprecationDecision.value?.status || "PENDING" },
    { key: "source", label: "决策来源", value: adminLegacyDeprecationDecision.value?.source || "NONE" },
  ];
});

const adminTransitionModules = computed(() => adminTransitionGate.value?.moduleCoverage || []);

const adminTransitionIssues = computed(() => {
  const gate = adminTransitionGate.value || {};
  const blockers = (gate.blockers || []).map((message) => ({ type: "BLOCKED", message }));
  const warnings = (gate.warnings || []).map((message) => ({ type: "REVIEW", message }));
  const decision = adminLegacyDeprecationDecision.value;
  const decisionRows = decision ? [{
    type: "DECISION",
    message: `旧后台下线决策：${decision.status || "PENDING"} / ${decision.source || "NONE"}`,
  }] : [];
  return blockers.concat(warnings, decisionRows);
});

const actionAdapterCalibrationSummaryCards = computed(() => {
  const summary = actionAdapterCalibrationGate.value?.summary || {};
  return [
    { key: "status", label: "Gate", value: actionAdapterCalibrationGate.value?.status || "-" },
    { key: "ready", label: "已就绪", value: `${summary.readyActionCount ?? 0}/${summary.totalActionCount ?? 0}` },
    { key: "passed", label: "通过检查", value: `${summary.passed ?? 0}/${summary.total ?? 0}` },
    { key: "blockers", label: "阻塞", value: summary.blockers ?? 0 },
    { key: "warnings", label: "提醒", value: summary.warnings ?? 0 },
  ];
});

const actionAdapterCalibrationActions = computed(() => actionAdapterCalibrationGate.value?.actions || []);

const actionAdapterCalibrationIssues = computed(() => {
  return actionAdapterCalibrationActions.value.flatMap((action) => {
    return (action.checks || [])
      .filter((check) => check.status !== "PASS")
      .map((check) => ({
        type: check.status === "BLOCKER" ? "BLOCKED" : "REVIEW",
        action: action.label || action.id,
        message: check.message || check.label || check.id,
      }));
  });
});

const productionEvidenceSummaryCards = computed(() => {
  const summary = productionEvidenceIntake.value?.summary || {};
  return [
    { key: "status", label: "状态", value: productionEvidenceIntake.value?.status || "-" },
    { key: "ready", label: "已就绪", value: `${summary.readyCount ?? 0}/${summary.total ?? 0}` },
    { key: "blocked", label: "阻塞", value: summary.blockerCount ?? 0 },
    { key: "review", label: "待确认", value: summary.warningCount ?? 0 },
  ];
});

const productionEvidenceItems = computed(() => productionEvidenceIntake.value?.items || []);

const productionEvidenceIssues = computed(() => {
  return productionEvidenceItems.value
    .filter((item) => item.status !== "READY")
    .map((item) => ({
      type: item.status === "BLOCKED" ? "BLOCKED" : "REVIEW",
      message: `${item.backlogId || item.id} ${item.label}: ${item.nextAction || ""}`,
    }));
});

const productionCutoverSummaryCards = computed(() => {
  const summary = productionCutoverGate.value?.summary || {};
  return [
    { key: "status", label: "Gate", value: productionCutoverGate.value?.status || "-" },
    { key: "proof", label: "已证明", value: `${summary.readyProofCount ?? 0}/${summary.requiredProofCount ?? 0}` },
    { key: "release", label: "版本证明", value: `${summary.releaseBoundReadyCount ?? 0}/${summary.releaseScopedProofCount ?? 0}` },
    { key: "ready", label: "已就绪", value: summary.readyCount ?? 0 },
    { key: "blocked", label: "阻塞", value: summary.blockerCount ?? 0 },
    { key: "warning", label: "提醒", value: summary.warningCount ?? 0 },
  ];
});

const productionCutoverItems = computed(() => productionCutoverGate.value?.items || []);

const productionCutoverIssues = computed(() => {
  const gate = productionCutoverGate.value || {};
  const blockers = (gate.blockers || []).map((message) => ({ type: "BLOCKED", message }));
  const warnings = (gate.warnings || []).map((message) => ({ type: "REVIEW", message }));
  return blockers.concat(warnings);
});

const cloudbaseStoreSummaryCards = computed(() => {
  const summary = cloudbaseStoreGate.value?.summary || {};
  return [
    { key: "status", label: "Gate", value: cloudbaseStoreGate.value?.status || "-" },
    { key: "decision", label: "决策", value: cloudbaseStoreGate.value?.selectedDecisionLabel || "-" },
    { key: "adapter", label: "Adapter", value: cloudbaseStoreGate.value?.currentStoreAdapterKind || "-" },
    { key: "cloudbase", label: "环境", value: summary.cloudbaseEnvReady ? "READY" : "PENDING" },
    { key: "continuity", label: "备份回滚", value: summary.continuityReady ? "READY" : "PENDING" },
  ];
});

const cloudbaseStoreChecks = computed(() => cloudbaseStoreGate.value?.checks || []);

const cloudbaseStoreIssues = computed(() => {
  const gate = cloudbaseStoreGate.value || {};
  const blockers = (gate.blockers || []).map((message) => ({ type: "BLOCKED", message }));
  const warnings = (gate.warnings || []).map((message) => ({ type: "REVIEW", message }));
  const actions = (gate.nextActions || []).map((message) => ({ type: "ACTION", message }));
  return blockers.concat(warnings, actions);
});

const rootMemberCenterSummaryCards = computed(() => {
  const summary = rootMemberCenterGate.value?.summary || {};
  return [
    { key: "status", label: "Gate", value: rootMemberCenterGate.value?.status || "-" },
    { key: "appid", label: "appId", value: rootMemberCenterGate.value?.appId ? "已配置" : "缺失" },
    { key: "envVersion", label: "环境", value: rootMemberCenterGate.value?.envVersion || "-" },
    { key: "products", label: "活跃商品", value: summary.activeProductCount ?? 0 },
    { key: "readyProducts", label: "可跳转", value: `${summary.readyProductCount ?? 0}/${summary.activeProductCount ?? 0}` },
    { key: "proofs", label: "跳转证明", value: `${summary.verifiedProofCount ?? 0}/${summary.activeProductCount ?? 0}` },
    { key: "missing", label: "缺配置", value: (summary.missingAppIdCount ?? 0) + (summary.missingPathCount ?? 0) },
  ];
});

const rootMemberCenterProducts = computed(() => rootMemberCenterGate.value?.products || []);
const selectedRootMemberCenterProduct = computed(() => {
  return rootMemberCenterProducts.value.find((item) => item.productId === rootJumpProofForm.productId) || null;
});

const rootMemberCenterIssues = computed(() => {
  const gate = rootMemberCenterGate.value || {};
  const blockers = (gate.blockers || []).map((message) => ({ type: "BLOCKED", message }));
  const warnings = (gate.warnings || []).map((message) => ({ type: "REVIEW", message }));
  const actions = (gate.nextActions || []).map((message) => ({ type: "ACTION", message }));
  return blockers.concat(warnings, actions);
});

const evidenceIssues = computed(() => {
  const pack = releaseEvidencePack.value || {};
  const blockers = (pack.blockers || []).map((message) => ({ type: "BLOCKED", message }));
  const warnings = (pack.warnings || []).map((message) => ({ type: "REVIEW", message }));
  return blockers.concat(warnings).slice(0, 30);
});

const evidenceCommands = computed(() => {
  return (releaseEvidencePack.value?.evidence?.commands || []).map((command) => ({ command }));
});

const releaseBlockers = computed(() => {
  const blockers = releaseRecord.value?.mustFixBeforeRelease || releaseRecord.value?.checklist?.mustFixBeforeRelease || [];
  return blockers.map((item) => {
    if (typeof item === "string") return { scope: "release", message: item, owner: "" };
    return {
      scope: item.scope || item.group || item.id || "release",
      message: item.message || item.label || item.name || JSON.stringify(item),
      owner: item.owner || item.ownerRole || "",
    };
  });
});

function statusType(status) {
  if (["READY", "PASS", "OK", "APPROVED"].includes(status)) return "success";
  if (["NEEDS_REVIEW", "WARNING", "UNIONID_PENDING", "OPTIONAL"].includes(status)) return "warning";
  if (["BLOCKED", "BLOCKER", "FAIL", "REJECTED"].includes(status)) return "danger";
  return "info";
}

function syncSignoffArchive(archives = []) {
  if (!archives.some((archive) => archive.archiveId === signoffForm.archiveId)) {
    signoffForm.archiveId = archives[0]?.archiveId || "";
  }
}

function syncCutoverProofItem(items = []) {
  if (!items.some((item) => item.id === cutoverProofForm.itemId)) {
    cutoverProofForm.itemId = items[0]?.id || "";
  }
}

function syncRootJumpProofProduct(products = []) {
  if (!products.some((item) => item.productId === rootJumpProofForm.productId)) {
    rootJumpProofForm.productId = products[0]?.productId || "";
  }
}

async function load() {
  loading.value = true;
  errorMessage.value = "";
  try {
    const [release, readiness, evidenceBundle, actionCalibration] = await Promise.all([
      fetchReleaseRecord(target.value),
      fetchLaunchReadiness(target.value),
      fetchReleaseEvidencePack(target.value),
      fetchActionAdapterCalibration(target.value),
    ]);
    releaseRecord.value = release;
    launchReadiness.value = readiness;
    releaseEvidenceBundle.value = evidenceBundle;
    actionAdapterCalibration.value = actionCalibration;
    syncSignoffArchive(evidenceBundle.archives || []);
    syncCutoverProofItem(release.evidence?.productionCutoverReadiness?.items || []);
    syncRootJumpProofProduct(release.evidence?.rootMemberCenterReadiness?.products || []);
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    loading.value = false;
  }
}

async function runProbe() {
  probeLoading.value = true;
  errorMessage.value = "";
  try {
    probeResult.value = await fetchCloudbaseIdentityProbe({
      appCode: probeForm.appCode,
      openid: probeForm.openid.trim(),
      unionid: probeForm.unionid.trim(),
    });
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    probeLoading.value = false;
  }
}

function clearProbe() {
  probeForm.openid = "";
  probeForm.unionid = "";
  probeResult.value = null;
}

function newRequestId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function downloadJsonFile(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function archiveEvidence() {
  if (!releaseEvidencePack.value) return;
  archiveLoading.value = true;
  errorMessage.value = "";
  const requestId = newRequestId("release-evidence-archive");
  try {
    await archiveReleaseEvidencePack({
      target: target.value,
      baseUrl: window.location.origin,
      strict: true,
      note: archiveNote.value.trim(),
      requestId,
    }, requestId);
    archiveNote.value = "";
    await load();
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    archiveLoading.value = false;
  }
}

async function downloadArchivedEvidence(row) {
  if (!row?.archiveId) return;
  archiveDownloadLoading.value = row.archiveId;
  errorMessage.value = "";
  try {
    const archived = await fetchReleaseEvidenceArchive(row.archiveId);
    downloadJsonFile(archived, `root-release-evidence-archive-${row.archiveId}.json`);
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    archiveDownloadLoading.value = "";
  }
}

async function submitSignoff() {
  if (!signoffForm.archiveId) return;
  signoffLoading.value = true;
  errorMessage.value = "";
  const requestId = newRequestId("release-signoff");
  try {
    await signReleaseRecord({
      target: target.value,
      role: signoffForm.role,
      status: signoffForm.status,
      archiveId: signoffForm.archiveId,
      note: signoffForm.note.trim(),
      requestId,
    }, requestId);
    signoffForm.note = "";
    await load();
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    signoffLoading.value = false;
  }
}

async function submitCutoverProof() {
  if (cutoverProofSubmissionDisabled.value) return;
  cutoverProofLoading.value = true;
  errorMessage.value = "";
  const requestId = newRequestId("production-cutover-proof");
  try {
    await recordProductionCutoverProof({
      target: target.value,
      itemId: cutoverProofForm.itemId,
      status: cutoverProofForm.status,
      evidenceRef: cutoverProofForm.evidenceRef.trim(),
      note: cutoverProofForm.note.trim(),
      requestId,
    }, requestId);
    cutoverProofForm.evidenceRef = "";
    cutoverProofForm.note = "";
    await load();
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    cutoverProofLoading.value = false;
  }
}

async function submitRootJumpProof() {
  const product = selectedRootMemberCenterProduct.value;
  if (!product) return;
  rootJumpProofLoading.value = true;
  errorMessage.value = "";
  const requestId = newRequestId("root-member-center-jump-proof");
  try {
    await recordRootMemberCenterJumpProof({
      target: target.value,
      productId: product.productId,
      productTitle: product.title,
      status: rootJumpProofForm.status,
      appId: product.appId || rootMemberCenterGate.value?.appId || "",
      path: product.path || rootMemberCenterGate.value?.defaultPath || "",
      evidenceRef: rootJumpProofForm.evidenceRef.trim(),
      note: rootJumpProofForm.note.trim(),
      requestId,
    }, requestId);
    rootJumpProofForm.evidenceRef = "";
    rootJumpProofForm.note = "";
    await load();
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    rootJumpProofLoading.value = false;
  }
}

async function submitAdminLegacyDecision() {
  adminLegacyDecisionLoading.value = true;
  errorMessage.value = "";
  const requestId = newRequestId("admin-legacy-deprecation-decision");
  try {
    await recordAdminLegacyDeprecationDecision({
      target: target.value,
      status: adminLegacyDecisionForm.status,
      evidenceRef: adminLegacyDecisionForm.evidenceRef.trim(),
      rollbackRef: adminLegacyDecisionForm.rollbackRef.trim(),
      note: adminLegacyDecisionForm.note.trim(),
      requestId,
    }, requestId);
    adminLegacyDecisionForm.evidenceRef = "";
    adminLegacyDecisionForm.rollbackRef = "";
    adminLegacyDecisionForm.note = "";
    await load();
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    adminLegacyDecisionLoading.value = false;
  }
}

function downloadEvidenceJson() {
  if (!releaseEvidenceBundle.value) return;
  downloadJsonFile(releaseEvidenceBundle.value, `root-release-evidence-${target.value}.json`);
}

onMounted(load);

defineExpose({ load });
</script>

<style scoped>
.release-workbench {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.target-select {
  width: 140px;
}

.archive-note-input {
  width: 220px;
}

.signoff-role-select,
.signoff-status-select {
  width: 130px;
}

.signoff-archive-select {
  width: 260px;
}

.signoff-note-input {
  width: 220px;
}

.cutover-proof-item-select {
  width: 220px;
}

.cutover-proof-status-select {
  width: 130px;
}

.root-jump-proof-product-select {
  width: 220px;
}

.root-jump-proof-status-select {
  width: 130px;
}

.admin-legacy-decision-status-select {
  width: 130px;
}

.cutover-proof-ref-input,
.cutover-proof-note-input,
.root-jump-proof-ref-input,
.root-jump-proof-note-input,
.admin-legacy-decision-ref-input,
.admin-legacy-decision-note-input {
  width: 180px;
}

.release-table {
  margin-top: 14px;
}

.release-summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
}

.evidence-summary-grid {
  margin-bottom: 14px;
}

.signoff-summary-grid {
  margin-bottom: 14px;
}

.admin-transition-summary-grid {
  margin-bottom: 14px;
}

.production-evidence-summary-grid {
  margin-bottom: 14px;
}

.production-cutover-summary-grid {
  margin-bottom: 14px;
}

.root-member-center-summary-grid {
  margin-bottom: 14px;
}

.evidence-pack-row {
  margin-top: 2px;
}

.evidence-panel {
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  padding: 12px;
}

.evidence-archive-panel {
  margin-top: 14px;
}

.evidence-panel-title {
  margin-bottom: 10px;
  color: var(--el-text-color-primary);
  font-size: 14px;
  font-weight: 600;
}

.release-summary-tile {
  display: grid;
  gap: 8px;
  min-height: 78px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  background: var(--el-fill-color-blank);
  padding: 14px;
}

.release-summary-tile span {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.release-summary-tile strong {
  color: var(--el-text-color-primary);
  font-size: 24px;
  line-height: 1;
}
</style>
