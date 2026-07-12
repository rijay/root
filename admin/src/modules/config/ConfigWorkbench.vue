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
      <el-col v-for="metric in metricCards" :key="metric.key" :span="4">
        <el-card class="metric-card" shadow="never">
          <span>{{ metric.label }}</span>
          <strong>{{ metric.value }}</strong>
        </el-card>
      </el-col>
    </el-row>

    <el-tabs v-model="activeTab" class="workbench-tabs">
      <el-tab-pane label="活动配置" name="campaigns">
        <el-row :gutter="16">
          <el-col :span="8">
            <el-card shadow="never">
              <template #header>活动信息</template>
              <el-form label-position="top">
                <el-form-item label="活动 ID">
                  <el-input v-model="campaignForm.campaignId" placeholder="ROOT_7D_RESET" />
                </el-form-item>
                <el-form-item label="活动标题">
                  <el-input v-model="campaignForm.title" placeholder="ROOT 7 日身体重启计划" />
                </el-form-item>
                <el-form-item label="状态">
                  <el-select v-model="campaignForm.status">
                    <el-option label="启用" value="ACTIVE" />
                    <el-option label="草稿" value="DRAFT" />
                    <el-option label="归档" value="ARCHIVED" />
                  </el-select>
                </el-form-item>
                <el-form-item label="周期天数">
                  <el-input-number v-model="campaignForm.durationDays" :min="1" :max="90" />
                </el-form-item>
                <el-button
                  :disabled="!canConfigWrite"
                  :loading="saving.campaign"
                  :title="capabilityTitle(ADMIN_CAPABILITIES.CONFIG_WRITE)"
                  type="primary"
                  @click="submitCampaign"
                >
                  保存活动
                </el-button>
              </el-form>
            </el-card>
          </el-col>
          <el-col :span="16">
            <el-card shadow="never">
              <template #header>活动列表</template>
              <el-table :data="workbench.campaigns" height="420">
                <el-table-column prop="campaignId" label="活动 ID" min-width="160" />
                <el-table-column prop="title" label="标题" min-width="180" />
                <el-table-column prop="status" label="状态" width="100" />
                <el-table-column prop="participantCount" label="参与" width="80" />
                <el-table-column prop="taskCount" label="任务" width="80" />
                <el-table-column prop="ruleVersionCount" label="规则" width="80" />
              </el-table>
            </el-card>
          </el-col>
        </el-row>
      </el-tab-pane>

      <el-tab-pane label="任务配置" name="tasks">
        <el-row :gutter="16">
          <el-col :span="8">
            <el-card shadow="never">
              <template #header>任务定义</template>
              <el-form label-position="top">
                <el-form-item label="活动 ID">
                  <el-input v-model="taskForm.campaignId" placeholder="ROOT_7D_RESET" />
                </el-form-item>
                <el-form-item label="任务类型">
                  <el-select v-model="taskForm.taskType">
                    <el-option label="打卡" value="CHECKIN" />
                    <el-option label="问卷" value="QUESTIONNAIRE" />
                    <el-option label="分享" value="SHARE" />
                    <el-option label="咨询" value="CONSULTATION" />
                    <el-option label="购买" value="PURCHASE" />
                  </el-select>
                </el-form-item>
                <el-form-item label="任务标题">
                  <el-input v-model="taskForm.title" placeholder="完成 7 天身体记录" />
                </el-form-item>
                <el-form-item label="目标次数">
                  <el-input-number v-model="taskForm.targetCount" :min="1" :max="90" />
                </el-form-item>
                <el-form-item>
                  <el-checkbox v-model="taskForm.required">作为结算必做任务</el-checkbox>
                </el-form-item>
                <el-button
                  :disabled="!canConfigWrite"
                  :loading="saving.task"
                  :title="capabilityTitle(ADMIN_CAPABILITIES.CONFIG_WRITE)"
                  type="primary"
                  @click="submitTask"
                >
                  保存任务
                </el-button>
              </el-form>
            </el-card>
          </el-col>
          <el-col :span="16">
            <el-card shadow="never">
              <template #header>任务列表</template>
              <el-table :data="workbench.taskDefinitions" height="420">
                <el-table-column prop="campaignId" label="活动 ID" min-width="150" />
                <el-table-column prop="taskType" label="类型" width="120" />
                <el-table-column prop="title" label="标题" min-width="180" />
                <el-table-column label="目标" width="90">
                  <template #default="{ row }">{{ row.config?.targetCount || 1 }}</template>
                </el-table-column>
                <el-table-column label="必做" width="90">
                  <template #default="{ row }">{{ row.required ? "是" : "否" }}</template>
                </el-table-column>
              </el-table>
            </el-card>
          </el-col>
        </el-row>
      </el-tab-pane>

      <el-tab-pane label="商品镜像" name="products">
        <el-row :gutter="16">
          <el-col :span="8">
            <el-card shadow="never">
              <template #header>商品维护</template>
              <el-form label-position="top">
                <el-form-item label="有赞商品 ID">
                  <el-input v-model="productForm.youzanProductId" placeholder="ROOT_PREBIOTIC_TRIAL" />
                </el-form-item>
                <el-form-item label="商品标题">
                  <el-input v-model="productForm.title" placeholder="ROOT 益生菌试饮装" />
                </el-form-item>
                <el-form-item label="价格文案">
                  <el-input v-model="productForm.priceText" placeholder="以 Root 会员中心为准" />
                </el-form-item>
                <el-form-item label="活动 ID">
                  <el-input v-model="productForm.campaignId" placeholder="ROOT_7D_RESET" />
                </el-form-item>
                <el-form-item label="Root 会员中心路径">
                  <el-input v-model="productForm.youzanPath" placeholder="pages/goods/detail?id=..." />
                </el-form-item>
                <el-button
                  :disabled="!canConfigWrite"
                  :loading="saving.product"
                  :title="capabilityTitle(ADMIN_CAPABILITIES.CONFIG_WRITE)"
                  type="primary"
                  @click="submitProduct"
                >
                  保存商品
                </el-button>
              </el-form>
            </el-card>
          </el-col>
          <el-col :span="16">
            <el-card shadow="never">
              <template #header>商品列表</template>
              <el-table :data="workbench.products" height="420">
                <el-table-column prop="productId" label="商品 ID" min-width="180" />
                <el-table-column prop="title" label="标题" min-width="180" />
                <el-table-column prop="priceText" label="价格" min-width="120" />
                <el-table-column prop="relationCount" label="活动关联" width="100" />
                <el-table-column prop="skuCount" label="SKU" width="80" />
              </el-table>
            </el-card>
          </el-col>
        </el-row>
        <el-row :gutter="16" class="batch-row">
          <el-col :span="8">
            <el-card shadow="never">
              <template #header>有赞商品同步</template>
              <el-form label-position="top">
                <el-form-item label="活动 ID">
                  <el-input v-model="productSyncForm.campaignId" placeholder="ROOT_7D_RESET" />
                </el-form-item>
                <el-form-item label="每次拉取">
                  <el-input-number v-model="productSyncForm.limit" :min="1" :max="100" />
                </el-form-item>
                <el-form-item label="游标">
                  <el-input v-model="productSyncForm.cursor" placeholder="next_cursor" />
                </el-form-item>
                <el-form-item label="request_id">
                  <el-input v-model="productSyncForm.requestId" placeholder="admin-product-sync-..." />
                </el-form-item>
                <el-form-item label="样本 JSON">
                  <el-input
                    v-model="productSyncForm.productsText"
                    :rows="8"
                    placeholder='[{"youzanProductId":"ROOT_PRODUCT","title":"ROOT 商品"}]'
                    type="textarea"
                  />
                </el-form-item>
                <el-form-item>
                  <el-checkbox v-model="productSyncForm.confirmRisk">已确认同步会覆盖同 ID 商品快照</el-checkbox>
                </el-form-item>
                <el-space wrap>
                  <el-button
                    :disabled="!canConfigWrite"
                    :loading="saving.productSyncPreview"
                    :title="capabilityTitle(ADMIN_CAPABILITIES.CONFIG_WRITE)"
                    @click="submitProductSyncPreview"
                  >
                    预览同步
                  </el-button>
                  <el-button
                    :disabled="!canConfigWrite"
                    :loading="saving.productSyncExecute"
                    :title="capabilityTitle(ADMIN_CAPABILITIES.CONFIG_WRITE)"
                    type="primary"
                    @click="submitProductSyncExecute"
                  >
                    确认同步
                  </el-button>
                </el-space>
              </el-form>
            </el-card>
          </el-col>
          <el-col :span="16">
            <el-card shadow="never">
              <template #header>
                <div class="toolbar-title">
                  <span>同步结果</span>
                  <span v-if="productSyncResult" class="table-meta">
                    共 {{ productSyncResult.total || productSyncResult.importedCount || 0 }} 个，可导入 {{ productSyncResult.importableCount || productSyncResult.importedCount || 0 }} 个
                  </span>
                </div>
              </template>
              <el-table :data="productSyncResult?.rows || productSyncResult?.products || []" height="360">
                <el-table-column prop="productId" label="商品 ID" min-width="180" />
                <el-table-column prop="title" label="标题" min-width="180" />
                <el-table-column prop="status" label="状态" width="100" />
                <el-table-column prop="skuCount" label="SKU" width="80" />
                <el-table-column label="可导入" width="90">
                  <template #default="{ row }">{{ row.importable === false ? "否" : "是" }}</template>
                </el-table-column>
              </el-table>
            </el-card>
          </el-col>
        </el-row>
      </el-tab-pane>

      <el-tab-pane label="结算规则" name="rules">
        <el-row :gutter="16">
          <el-col :span="10">
            <el-card shadow="never">
              <template #header>规则发布</template>
              <el-form label-position="top">
                <el-form-item label="活动 ID">
                  <el-input v-model="ruleForm.campaignId" />
                </el-form-item>
                <el-form-item label="版本号">
                  <el-input v-model="ruleForm.version" />
                </el-form-item>
                  <div class="rule-builder-panel">
                    <div class="toolbar-title">
                    <span>规则拖拽编辑器</span>
                    <span class="table-meta">{{ ruleBuilderSummary }}</span>
                  </div>
                  <el-form-item label="根节点关系">
                    <el-radio-group v-model="ruleTree.logic" size="small">
                      <el-radio-button label="AND">全部满足</el-radio-button>
                      <el-radio-button label="OR">任一满足</el-radio-button>
                    </el-radio-group>
                  </el-form-item>
                  <div class="rule-tree-toolbar">
                    <el-button size="small" @click="addRootCondition">新增条件</el-button>
                    <el-button size="small" @click="addRootGroup">新增分组</el-button>
                    <el-button size="small" @click="resetRuleTree">恢复默认</el-button>
                  </div>
                  <div class="rule-tree-editor">
                    <div
                      v-for="(node, index) in ruleTree.nodes"
                      :key="node.id"
                      class="rule-tree-node"
                      :class="{ 'rule-tree-node--disabled': !node.enabled }"
                    >
                      <template v-if="node.kind === 'group'">
                        <div
                          class="rule-tree-node-header rule-tree-node-header--group"
                          draggable="true"
                          @dragstart="startRuleDrag('root', index)"
                          @dragover.prevent
                          @drop="dropRuleNode('root', index)"
                        >
                          <span class="drag-handle">拖拽</span>
                          <el-switch v-model="node.enabled" size="small" />
                          <el-input v-model="node.label" placeholder="分组名称" size="small" />
                          <el-radio-group v-model="node.logic" size="small">
                            <el-radio-button label="AND">全部</el-radio-button>
                            <el-radio-button label="OR">任一</el-radio-button>
                          </el-radio-group>
                          <el-button size="small" @click="addGroupCondition(node)">加子条件</el-button>
                          <el-button size="small" :disabled="index === 0" @click="moveRuleNode(ruleTree.nodes, index, -1)">上移</el-button>
                          <el-button size="small" :disabled="index === ruleTree.nodes.length - 1" @click="moveRuleNode(ruleTree.nodes, index, 1)">下移</el-button>
                          <el-button size="small" type="danger" plain @click="removeRuleNode(ruleTree.nodes, index)">删除</el-button>
                        </div>
                        <div class="rule-tree-children">
                          <div
                            v-for="(child, childIndex) in node.children"
                            :key="child.id"
                            class="rule-condition-row rule-condition-row--child"
                            :class="{ 'rule-tree-node--disabled': !child.enabled }"
                            draggable="true"
                            @dragstart.stop="startRuleDrag(node.id, childIndex)"
                            @dragover.prevent
                            @drop.stop="dropRuleNode(node.id, childIndex)"
                          >
                            <span class="drag-handle">拖拽</span>
                            <el-switch v-model="child.enabled" size="small" />
                            <el-select v-model="child.conditionType" size="small" @change="changeRuleConditionType(child)">
                              <el-option v-for="option in ruleConditionOptions" :key="option.value" :label="option.label" :value="option.value" />
                            </el-select>
                            <el-input-number
                              v-if="conditionUsesCount(child)"
                              v-model="child.minCount"
                              :min="1"
                              :max="90"
                              size="small"
                            />
                            <el-input
                              v-if="child.conditionType === 'QUESTIONNAIRE_COMPLETED'"
                              v-model="child.questionnaireType"
                              placeholder="问卷类型"
                              size="small"
                            />
                            <el-input
                              v-if="child.conditionType === 'PURCHASE_COMPLETED'"
                              v-model="child.youzanProductId"
                              placeholder="商品 ID，可留空"
                              size="small"
                            />
                            <el-input v-model="child.label" placeholder="展示文案" size="small" />
                            <el-button size="small" :disabled="childIndex === 0" @click="moveRuleNode(node.children, childIndex, -1)">上移</el-button>
                            <el-button size="small" :disabled="childIndex === node.children.length - 1" @click="moveRuleNode(node.children, childIndex, 1)">下移</el-button>
                            <el-button size="small" type="danger" plain @click="removeRuleNode(node.children, childIndex)">删除</el-button>
                          </div>
                        </div>
                      </template>
                      <div
                        v-else
                        class="rule-condition-row"
                        draggable="true"
                        @dragstart="startRuleDrag('root', index)"
                        @dragover.prevent
                        @drop="dropRuleNode('root', index)"
                      >
                        <span class="drag-handle">拖拽</span>
                        <el-switch v-model="node.enabled" size="small" />
                        <el-select v-model="node.conditionType" size="small" @change="changeRuleConditionType(node)">
                          <el-option v-for="option in ruleConditionOptions" :key="option.value" :label="option.label" :value="option.value" />
                        </el-select>
                        <el-input-number
                          v-if="conditionUsesCount(node)"
                          v-model="node.minCount"
                          :min="1"
                          :max="90"
                          size="small"
                        />
                        <el-input
                          v-if="node.conditionType === 'QUESTIONNAIRE_COMPLETED'"
                          v-model="node.questionnaireType"
                          placeholder="问卷类型"
                          size="small"
                        />
                        <el-input
                          v-if="node.conditionType === 'PURCHASE_COMPLETED'"
                          v-model="node.youzanProductId"
                          placeholder="商品 ID，可留空"
                          size="small"
                        />
                        <el-input v-model="node.label" placeholder="展示文案" size="small" />
                        <el-button size="small" :disabled="index === 0" @click="moveRuleNode(ruleTree.nodes, index, -1)">上移</el-button>
                        <el-button size="small" :disabled="index === ruleTree.nodes.length - 1" @click="moveRuleNode(ruleTree.nodes, index, 1)">下移</el-button>
                        <el-button size="small" type="danger" plain @click="removeRuleNode(ruleTree.nodes, index)">删除</el-button>
                      </div>
                    </div>
                  </div>
                  <div class="rule-builder-grid rule-builder-grid--rewards">
                    <span class="rule-builder-label">奖励上限</span>
                    <el-input-number v-model="ruleBuilder.rewardStockLimit" :min="0" :max="10000" size="small" />
                    <span class="rule-builder-label">免单抽取</span>
                    <el-input-number v-model="ruleBuilder.freeOrderChancePercent" :min="0" :max="100" size="small" />
                  </div>
                  <div class="rule-builder-rewards">
                    <el-checkbox v-model="ruleBuilder.couponReward">有赞券</el-checkbox>
                    <el-checkbox v-model="ruleBuilder.freeOrderReward">免单机会</el-checkbox>
                    <el-checkbox v-model="ruleBuilder.pointsReward">积分</el-checkbox>
                    <el-checkbox v-model="ruleBuilder.tagReward">标签</el-checkbox>
                  </div>
                  <el-button size="small" @click="applyRuleBuilder">生成规则 JSON</el-button>
                </div>
                <el-form-item label="规则 JSON">
                  <el-input v-model="ruleForm.payloadText" :rows="18" type="textarea" />
                </el-form-item>
                <el-space>
                  <el-button @click="insertRuleTemplate">插入模板</el-button>
                  <el-button
                    :disabled="!canConfigWrite"
                    :loading="saving.rule"
                    :title="capabilityTitle(ADMIN_CAPABILITIES.CONFIG_WRITE)"
                    type="primary"
                    @click="submitRule"
                  >
                    发布规则
                  </el-button>
                </el-space>
              </el-form>
            </el-card>
          </el-col>
          <el-col :span="14">
            <el-card shadow="never">
              <template #header>规则版本</template>
              <el-table :data="workbench.ruleVersions" height="520">
                <el-table-column prop="campaignId" label="活动 ID" min-width="150" />
                <el-table-column prop="version" label="版本" width="120" />
                <el-table-column prop="status" label="状态" width="110" />
                <el-table-column prop="conditionCount" label="条件" width="90" />
                <el-table-column prop="rewardCount" label="奖励" width="90" />
              </el-table>
            </el-card>
          </el-col>
        </el-row>
      </el-tab-pane>

      <el-tab-pane label="结算预览" name="settlement">
        <el-row :gutter="16">
          <el-col :span="8">
            <el-card shadow="never">
              <template #header>单人预览</template>
              <el-form label-position="top">
                <el-form-item label="root_user_id">
                  <el-input v-model="settlementForm.rootUserId" />
                </el-form-item>
                <el-form-item label="活动 ID">
                  <el-input v-model="settlementForm.campaignId" />
                </el-form-item>
                <el-button :loading="saving.settlement" type="primary" @click="submitSettlementPreview">预览结算</el-button>
              </el-form>
              <pre v-if="settlementPreview" class="preview-json">{{ settlementPreview }}</pre>
            </el-card>
          </el-col>
          <el-col :span="16">
            <el-card shadow="never">
              <template #header>最近结算</template>
              <el-table :data="workbench.settlements" height="420">
                <el-table-column prop="settlementRecordId" label="记录 ID" min-width="180" />
                <el-table-column prop="userLabel" label="用户" min-width="160" />
                <el-table-column prop="status" label="状态" width="110" />
                <el-table-column prop="rewardCount" label="奖励" width="90" />
                <el-table-column prop="missingCount" label="缺失" width="90" />
              </el-table>
            </el-card>
          </el-col>
        </el-row>
        <el-row :gutter="16" class="batch-row">
          <el-col :span="8">
            <el-card shadow="never">
              <template #header>批量结算</template>
              <el-form label-position="top">
                <el-form-item label="root_user_id 列表">
                  <el-input
                    v-model="batchSettlementForm.rootUserIdsText"
                    :rows="8"
                    placeholder="每行一个 root_user_id，也可用逗号分隔"
                    type="textarea"
                  />
                </el-form-item>
                <el-form-item label="活动 ID">
                  <el-input v-model="batchSettlementForm.campaignId" />
                </el-form-item>
                <el-form-item label="request_id">
                  <el-input v-model="batchSettlementForm.requestId" />
                </el-form-item>
                <el-form-item>
                  <el-checkbox v-model="batchSettlementForm.confirmRisk">已确认批量结算影响和奖励预算</el-checkbox>
                </el-form-item>
                <el-space wrap>
                  <el-button :loading="saving.batchPreview" @click="submitBatchPreview">批量预览</el-button>
                  <el-button
                    :disabled="!canSettlementExecute"
                    :loading="saving.batchExecute"
                    :title="capabilityTitle(ADMIN_CAPABILITIES.SETTLEMENT_EXECUTE)"
                    type="primary"
                    @click="submitBatchExecute"
                  >
                    确认执行
                  </el-button>
                </el-space>
              </el-form>
            </el-card>
          </el-col>
          <el-col :span="16">
            <el-card shadow="never">
              <template #header>
                <div class="toolbar-title">
                  <span>批量结果</span>
                  <span v-if="batchSettlementResult" class="table-meta">
                    共 {{ batchSettlementResult.summary?.total || 0 }} 人，可结算 {{ batchSettlementResult.summary?.qualified || 0 }} 人，执行 {{ batchSettlementResult.summary?.executed || 0 }} 人
                  </span>
                </div>
              </template>
              <el-table :data="batchSettlementResult?.items || []" height="360">
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
            </el-card>
          </el-col>
        </el-row>
      </el-tab-pane>

      <el-tab-pane label="奖励复核" name="reviews">
        <el-row :gutter="16">
          <el-col :span="12">
            <el-card shadow="never">
              <template #header>
                <div class="toolbar-title">
                  <span>人工复核</span>
                  <span class="table-meta">已选 {{ selectedReviewIds.length }} 条</span>
                </div>
              </template>
              <el-form class="batch-review-form" label-position="top">
                <el-space wrap>
                  <el-select v-model="batchReviewForm.decision">
                    <el-option label="通过" value="APPROVED" />
                    <el-option label="拒绝" value="REJECTED" />
                  </el-select>
                  <el-input v-model="batchReviewForm.requestId" placeholder="request_id" />
                  <el-input v-model="batchReviewForm.publicNote" placeholder="用户可见备注" />
                  <el-checkbox v-model="batchReviewForm.confirmRisk">已确认批量复核结果</el-checkbox>
                  <el-button
                    :disabled="!canReviewResolve"
                    :loading="saving.batchReview"
                    :title="capabilityTitle(ADMIN_CAPABILITIES.REVIEW_RESOLVE)"
                    type="primary"
                    @click="submitBatchReview"
                  >
                    批量处理
                  </el-button>
                </el-space>
              </el-form>
              <el-table :data="workbench.manualReviews" height="460" @selection-change="handleReviewSelection">
                <el-table-column type="selection" width="48" :selectable="canSelectReview" />
                <el-table-column prop="reviewItemId" label="复核 ID" min-width="180" />
                <el-table-column prop="userLabel" label="用户" min-width="150" />
                <el-table-column prop="rewardTitle" label="奖励" min-width="150" />
                <el-table-column prop="status" label="状态" width="90" />
                <el-table-column prop="expectedResolutionAt" label="预计处理" min-width="170" />
                <el-table-column prop="publicNote" label="用户备注" min-width="180" />
                <el-table-column label="解释模板" min-width="260">
                  <template #default="{ row }">
                    <div class="review-explainer">
                      <strong>{{ row.explanationTitle || row.reviewType }}</strong>
                      <span>{{ row.pendingReason || row.statusCopy }}</span>
                      <small v-if="row.operatorGuidance">运营：{{ row.operatorGuidance }}</small>
                      <small v-if="row.nextAction">用户下一步：{{ row.nextAction }}</small>
                    </div>
                  </template>
                </el-table-column>
                <el-table-column label="操作" width="180">
                  <template #default="{ row }">
                    <el-space v-if="row.status === 'OPEN'">
                      <el-button
                        :disabled="!canReviewResolve"
                        :title="capabilityTitle(ADMIN_CAPABILITIES.REVIEW_RESOLVE)"
                        size="small"
                        type="primary"
                        @click="handleReview(row.reviewItemId, 'APPROVED')"
                      >
                        通过
                      </el-button>
                      <el-button
                        :disabled="!canReviewResolve"
                        :title="capabilityTitle(ADMIN_CAPABILITIES.REVIEW_RESOLVE)"
                        size="small"
                        @click="handleReview(row.reviewItemId, 'REJECTED')"
                      >
                        拒绝
                      </el-button>
                    </el-space>
                    <span v-else>{{ row.resolution || "已处理" }}</span>
                  </template>
                </el-table-column>
              </el-table>
            </el-card>
          </el-col>
          <el-col :span="12">
            <el-card shadow="never">
              <template #header>奖励队列</template>
              <el-table :data="workbench.rewardGrants" height="250">
                <el-table-column prop="rewardGrantId" label="奖励 ID" min-width="180" />
                <el-table-column prop="userLabel" label="用户" min-width="150" />
                <el-table-column prop="title" label="奖励" min-width="150" />
                <el-table-column prop="rewardType" label="类型" width="120" />
                <el-table-column label="企微标签" min-width="160">
                  <template #default="{ row }">
                    <span>{{ displayWeworkTag(row) }}</span>
                  </template>
                </el-table-column>
                <el-table-column prop="status" label="状态" width="110" />
                <el-table-column prop="externalStatus" label="外部状态" width="120" />
                <el-table-column prop="externalStatusCheckedAt" label="最近查询" min-width="170" />
              </el-table>
              <el-divider />
              <div class="delivery-toolbar">
                <el-space wrap>
                  <span class="table-title">发放任务</span>
                  <span class="table-meta">发放 {{ selectedDeliveryJobIds.length }} 条 / 企微 {{ selectedWeworkTagJobIds.length }} 条 / 查券 {{ selectedStatusJobIds.length }} 条</span>
                  <el-select v-model="deliveryForm.deliveryMode">
                    <el-option label="人工确认" value="MANUAL" />
                    <el-option label="自动 Adapter" value="AUTO" />
                  </el-select>
                  <el-input v-model="deliveryForm.requestId" placeholder="request_id" />
                  <el-input v-model="deliveryForm.externalRef" placeholder="外部凭证/券码" />
                  <el-input v-model="deliveryForm.externalContactId" placeholder="企微外部联系人ID" />
                  <el-input v-model="deliveryForm.tagId" placeholder="企微标签ID" />
                  <el-input v-model="deliveryForm.tagName" placeholder="企微标签名" />
                  <el-checkbox v-model="deliveryForm.confirmRisk">已确认发放结果</el-checkbox>
                  <el-button
                    :disabled="!canRewardDeliveryWrite"
                    :loading="saving.rewardDelivery"
                    :title="capabilityTitle(ADMIN_CAPABILITIES.REWARD_DELIVERY_WRITE)"
                    type="primary"
                    @click="submitRewardDelivery('DELIVERED')"
                  >
                    确认发放
                  </el-button>
                  <el-button
                    :disabled="!canRewardDeliveryWrite"
                    :loading="saving.rewardDelivery"
                    :title="capabilityTitle(ADMIN_CAPABILITIES.REWARD_DELIVERY_WRITE)"
                    @click="submitRewardDelivery('FAILED')"
                  >
                    标记失败
                  </el-button>
                </el-space>
              </div>
              <div class="delivery-toolbar">
                <el-space wrap>
                  <span class="table-title">券状态查询</span>
                  <el-select v-model="statusQueryForm.deliveryMode">
                    <el-option label="人工回写" value="MANUAL" />
                    <el-option label="自动 Adapter" value="AUTO" />
                  </el-select>
                  <el-select v-model="statusQueryForm.externalStatus" :disabled="statusQueryForm.deliveryMode === 'AUTO'">
                    <el-option label="已发出 ISSUED" value="ISSUED" />
                    <el-option label="已使用 USED" value="USED" />
                    <el-option label="已过期 EXPIRED" value="EXPIRED" />
                    <el-option label="已取消 CANCELLED" value="CANCELLED" />
                  </el-select>
                  <el-input v-model="statusQueryForm.requestId" placeholder="request_id" />
                  <el-input v-model="statusQueryForm.externalRef" placeholder="券码/外部凭证" />
                  <el-input v-model="statusQueryForm.statusMessage" placeholder="备注" />
                  <el-button
                    :disabled="!canRewardDeliveryWrite"
                    :loading="saving.statusQuery"
                    :title="capabilityTitle(ADMIN_CAPABILITIES.REWARD_DELIVERY_WRITE)"
                    type="primary"
                    @click="submitRewardStatusQuery"
                  >
                    查询/回写状态
                  </el-button>
                </el-space>
              </div>
              <el-table :data="workbench.deliveryJobs" height="220" @selection-change="handleDeliverySelection">
                <el-table-column type="selection" width="48" :selectable="canSelectDeliveryRow" />
                <el-table-column prop="deliveryJobId" label="任务 ID" min-width="180" />
                <el-table-column prop="adapterType" label="Adapter" width="140" />
                <el-table-column prop="status" label="状态" width="110" />
                <el-table-column prop="attemptCount" label="次数" width="70" />
                <el-table-column prop="externalRef" label="凭证" min-width="120" />
                <el-table-column prop="externalStatus" label="券状态" width="120" />
                <el-table-column prop="externalStatusCheckedAt" label="查询时间" min-width="170" />
                <el-table-column label="企微标签" min-width="170">
                  <template #default="{ row }">
                    <span>{{ displayWeworkTag(row) }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="外部联系人" min-width="170">
                  <template #default="{ row }">
                    <span>{{ displayWeworkContact(row) }}</span>
                  </template>
                </el-table-column>
                <el-table-column prop="lastError" label="失败原因" min-width="160" />
                <el-table-column label="操作" width="120">
                  <template #default="{ row }">
                    <el-button
                      v-if="row.adapterType === 'WEWORK_TAG'"
                      size="small"
                      @click.stop="fillWeworkTagForm(row)"
                    >
                      填入标签
                    </el-button>
                  </template>
                </el-table-column>
              </el-table>
            </el-card>
            <el-card class="template-card" shadow="never">
              <template #header>
                <div class="toolbar-title">
                  <span>复核解释模板校准</span>
                  <span class="table-meta">{{ workbench.manualReviewExplanationTemplates.status || "READY" }}</span>
                </div>
              </template>
              <el-alert
                v-if="templateIssues.length"
                :closable="false"
                :title="templateIssueSummary"
                :type="templateIssueType"
                class="workbench-alert"
              />
              <el-table :data="workbench.manualReviewExplanationTemplates.templates || []" height="240">
                <el-table-column prop="templateKey" label="模板" min-width="150" />
                <el-table-column label="来源" width="80">
                  <template #default="{ row }">{{ row.configured ? "已配置" : "默认" }}</template>
                </el-table-column>
                <el-table-column prop="title" label="标题" min-width="130" />
                <el-table-column prop="pendingReason" label="用户解释" min-width="220" />
                <el-table-column label="所需证据" min-width="180">
                  <template #default="{ row }">{{ joinText(row.evidenceRequired) }}</template>
                </el-table-column>
                <el-table-column prop="operatorGuidance" label="运营指引" min-width="220" />
              </el-table>
            </el-card>
          </el-col>
        </el-row>
      </el-tab-pane>
    </el-tabs>
  </section>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import {
  ADMIN_CAPABILITIES,
  useAdminAccess,
} from "../access";
import {
  executeProductSync,
  fetchConfigWorkbench,
  executeRewardDelivery,
  executeSettlementBatch,
  previewProductSync,
  previewSettlementBatch,
  previewSettlement,
  publishRuleVersion,
  queryRewardDeliveryStatus,
  resolveManualReview,
  resolveManualReviewBatch,
  saveCampaign,
  saveProduct,
  saveTaskDefinition,
} from "./adminConfigApi";

const defaultCampaignId = "ROOT_7D_RESET";
const activeTab = ref("campaigns");
const errorMessage = ref("");
const settlementPreview = ref("");
const saving = reactive({
  campaign: false,
  task: false,
  product: false,
  productSyncPreview: false,
  productSyncExecute: false,
  rule: false,
  settlement: false,
  batchPreview: false,
  batchExecute: false,
  review: false,
  batchReview: false,
  rewardDelivery: false,
  statusQuery: false,
});
const workbench = reactive({
  metrics: {},
  campaigns: [],
  taskDefinitions: [],
  products: [],
  ruleVersions: [],
  settlements: [],
  rewardGrants: [],
  deliveryJobs: [],
  manualReviews: [],
  manualReviewExplanationTemplates: {
    status: "READY",
    errors: [],
    warnings: [],
    templates: [],
  },
});
const campaignForm = reactive({
  campaignId: defaultCampaignId,
  title: "ROOT 7 日身体重启计划",
  status: "ACTIVE",
  durationDays: 7,
});
const taskForm = reactive({
  campaignId: defaultCampaignId,
  taskType: "CHECKIN",
  title: "完成 7 天身体记录",
  targetCount: 7,
  required: true,
});
const productForm = reactive({
  youzanProductId: "",
  title: "",
  priceText: "以 Root 会员中心为准",
  campaignId: defaultCampaignId,
  youzanPath: "",
});
const productSyncForm = reactive({
  campaignId: defaultCampaignId,
  limit: 50,
  cursor: "",
  requestId: "",
  confirmRisk: false,
  productsText: "",
});
const productSyncResult = ref(null);
const ruleForm = reactive({
  campaignId: defaultCampaignId,
  version: "1",
  payloadText: "",
});
const ruleBuilder = reactive({
  logic: "AND",
  checkinEnabled: true,
  checkinCount: 7,
  questionnaireEnabled: true,
  questionnaireType: "DAY8_SUMMARY",
  shareEnabled: false,
  shareCount: 1,
  consultationEnabled: false,
  purchaseEnabled: false,
  youzanProductId: "",
  couponReward: true,
  freeOrderReward: true,
  freeOrderChancePercent: 100,
  pointsReward: false,
  tagReward: false,
  rewardStockLimit: 0,
});
const ruleConditionOptions = [
  { label: "打卡天数", value: "TASK_COUNT" },
  { label: "连续打卡", value: "TASK_STREAK" },
  { label: "阶段问卷", value: "QUESTIONNAIRE_COMPLETED" },
  { label: "分享次数", value: "SHARE_COUNT" },
  { label: "完成咨询", value: "CONSULTATION_REQUIRED" },
  { label: "购买商品", value: "PURCHASE_COMPLETED" },
];
let ruleNodeCounter = 0;
const ruleTreeDragPath = ref("");
const ruleTree = reactive({
  logic: "AND",
  nodes: [
    createRuleCondition("TASK_COUNT"),
    createRuleCondition("QUESTIONNAIRE_COMPLETED"),
  ],
});
const settlementForm = reactive({
  rootUserId: "",
  campaignId: defaultCampaignId,
});
const batchSettlementForm = reactive({
  rootUserIdsText: "",
  campaignId: defaultCampaignId,
  requestId: "",
  confirmRisk: false,
});
const batchSettlementResult = ref(null);
const selectedReviewIds = ref([]);
const selectedDeliveryJobIds = ref([]);
const selectedWeworkTagJobIds = ref([]);
const selectedStatusJobIds = ref([]);
const batchReviewForm = reactive({
  decision: "APPROVED",
  requestId: "",
  publicNote: "",
  confirmRisk: false,
});
const deliveryForm = reactive({
  deliveryMode: "MANUAL",
  requestId: "",
  externalRef: "",
  externalContactId: "",
  tagId: "",
  tagName: "",
  confirmRisk: false,
});
const statusQueryForm = reactive({
  deliveryMode: "MANUAL",
  requestId: "",
  externalStatus: "USED",
  externalRef: "",
  statusMessage: "",
});
const access = useAdminAccess();
const canConfigWrite = computed(() => access.has(ADMIN_CAPABILITIES.CONFIG_WRITE));
const canReviewResolve = computed(() => access.has(ADMIN_CAPABILITIES.REVIEW_RESOLVE));
const canRewardDeliveryWrite = computed(() => access.has(ADMIN_CAPABILITIES.REWARD_DELIVERY_WRITE));
const canSettlementExecute = computed(() => access.has(ADMIN_CAPABILITIES.SETTLEMENT_EXECUTE));

function capabilityTitle(capability) {
  return access.reason(capability);
}

function requireCapability(capability) {
  if (access.has(capability)) return true;
  ElMessage.warning(access.reason(capability));
  return false;
}

const metricCards = computed(() => [
  { key: "activeCampaigns", label: "启用活动", value: workbench.metrics.activeCampaigns || 0 },
  { key: "activeTaskDefinitions", label: "启用任务", value: workbench.metrics.activeTaskDefinitions || 0 },
  { key: "publishedRuleVersions", label: "已发布规则", value: workbench.metrics.publishedRuleVersions || 0 },
  { key: "pendingDeliveryJobs", label: "待发放", value: workbench.metrics.pendingDeliveryJobs || 0 },
  { key: "openManualReviews", label: "待复核", value: workbench.metrics.openManualReviews || 0 },
  { key: "recentSettlements", label: "近期结算", value: workbench.metrics.recentSettlements || 0 },
]);

const templateIssues = computed(() => [
  ...(workbench.manualReviewExplanationTemplates.errors || []),
  ...(workbench.manualReviewExplanationTemplates.warnings || []),
]);

const templateIssueType = computed(() => (workbench.manualReviewExplanationTemplates.errors || []).length ? "error" : "warning");

const templateIssueSummary = computed(() => {
  const first = templateIssues.value[0];
  if (!first) return "";
  const total = templateIssues.value.length;
  return `${first.templateKey || "-"} / ${first.field || "-"}：${first.message}${total > 1 ? `，另有 ${total - 1} 条` : ""}`;
});

function nextRuleNodeId() {
  ruleNodeCounter += 1;
  return `rule-node-${ruleNodeCounter}`;
}

function createRuleCondition(conditionType = "TASK_COUNT") {
  const node = {
    id: nextRuleNodeId(),
    kind: "condition",
    enabled: true,
    conditionType,
    taskType: "",
    minCount: 1,
    uniqueBy: "",
    questionnaireType: "",
    youzanProductId: "",
    label: "",
  };
  applyConditionDefaults(node, conditionType);
  return node;
}

function createRuleGroup() {
  return {
    id: nextRuleNodeId(),
    kind: "group",
    enabled: true,
    logic: "OR",
    label: "完成任一互动",
    children: [
      createRuleCondition("QUESTIONNAIRE_COMPLETED"),
      createRuleCondition("SHARE_COUNT"),
    ],
  };
}

function applyConditionDefaults(node, conditionType = node.conditionType) {
  const defaults = {
    TASK_COUNT: { taskType: "CHECKIN", minCount: campaignForm.durationDays || 7, uniqueBy: "taskDate", label: `完成 ${campaignForm.durationDays || 7} 天打卡` },
    TASK_STREAK: { taskType: "CHECKIN", minCount: 7, uniqueBy: "", label: "连续完成 7 天打卡" },
    QUESTIONNAIRE_COMPLETED: { taskType: "", minCount: 1, uniqueBy: "", questionnaireType: "DAY8_SUMMARY", label: "完成阶段问卷" },
    SHARE_COUNT: { taskType: "SHARE", minCount: 1, uniqueBy: "eventId", label: "完成 1 次分享" },
    CONSULTATION_REQUIRED: { taskType: "", minCount: 1, uniqueBy: "", label: "完成一次咨询" },
    PURCHASE_COMPLETED: { taskType: "", minCount: 1, uniqueBy: "", youzanProductId: "", label: "完成任一商品购买" },
  };
  Object.assign(node, defaults[conditionType] || defaults.TASK_COUNT, { conditionType });
}

function changeRuleConditionType(node) {
  applyConditionDefaults(node, node.conditionType);
}

function conditionUsesCount(node) {
  return ["TASK_COUNT", "TASK_STREAK", "SHARE_COUNT"].includes(node.conditionType);
}

function addRootCondition() {
  ruleTree.nodes.push(createRuleCondition("TASK_COUNT"));
}

function addRootGroup() {
  ruleTree.nodes.push(createRuleGroup());
}

function addGroupCondition(group) {
  if (!Array.isArray(group.children)) group.children = [];
  group.children.push(createRuleCondition("TASK_COUNT"));
}

function resetRuleTree() {
  ruleTree.logic = "AND";
  ruleTree.nodes.splice(0, ruleTree.nodes.length, createRuleCondition("TASK_COUNT"), createRuleCondition("QUESTIONNAIRE_COMPLETED"));
}

function removeRuleNode(list, index) {
  list.splice(index, 1);
}

function moveRuleNode(list, index, direction) {
  const target = index + direction;
  if (target < 0 || target >= list.length) return;
  const [node] = list.splice(index, 1);
  list.splice(target, 0, node);
}

function ruleDragPath(parentId, index) {
  return `${parentId}:${index}`;
}

function parseRuleDragPath(value) {
  const [parentId, indexText] = String(value || "").split(":");
  return { parentId, index: Number(indexText) };
}

function ruleListForParent(parentId) {
  if (parentId === "root") return ruleTree.nodes;
  const group = ruleTree.nodes.find((node) => node.kind === "group" && node.id === parentId);
  return group && Array.isArray(group.children) ? group.children : null;
}

function startRuleDrag(parentId, index) {
  ruleTreeDragPath.value = ruleDragPath(parentId, index);
}

function dropRuleNode(parentId, index) {
  const source = parseRuleDragPath(ruleTreeDragPath.value);
  if (!source.parentId || source.parentId !== parentId || source.index === index) return;
  const list = ruleListForParent(parentId);
  if (!list || source.index < 0 || source.index >= list.length) return;
  const [node] = list.splice(source.index, 1);
  const insertIndex = source.index < index ? index - 1 : index;
  list.splice(insertIndex, 0, node);
  ruleTreeDragPath.value = "";
}

const ruleBuilderSummary = computed(() => {
  const conditionCount = conditionLeafCount(ruleTree.nodes);
  const rewardCount = builderRewards().length;
  return `${ruleTree.logic} · ${conditionCount} 条件 · ${rewardCount} 奖励`;
});

function assignWorkbench(data = {}) {
  Object.assign(workbench, {
    metrics: data.metrics || {},
    campaigns: data.campaigns || [],
    taskDefinitions: data.taskDefinitions || [],
    products: data.products || [],
    ruleVersions: data.ruleVersions || [],
    settlements: data.settlements || [],
    rewardGrants: data.rewardGrants || [],
    deliveryJobs: data.deliveryJobs || [],
    manualReviews: data.manualReviews || [],
    manualReviewExplanationTemplates: data.manualReviewExplanationTemplates || {
      status: "READY",
      errors: [],
      warnings: [],
      templates: [],
    },
  });
}

async function load() {
  errorMessage.value = "";
  try {
    assignWorkbench(await fetchConfigWorkbench());
  } catch (error) {
    errorMessage.value = error.message;
  }
}

function ruleTemplate() {
  return {
    conditions: [
      { conditionType: "TASK_COUNT", taskType: "CHECKIN", minCount: campaignForm.durationDays || 7, uniqueBy: "taskDate", label: `完成 ${campaignForm.durationDays || 7} 天打卡` },
      { conditionType: "QUESTIONNAIRE_COMPLETED", questionnaireType: "DAY8_SUMMARY", label: "完成收尾问卷" },
    ],
    rewards: [
      { rewardType: "YOUZAN_COUPON", rewardKey: "completion_coupon", title: "达标返券", description: "完成活动条件后生成待发放优惠券记录。", payload: { couponScene: "ROOT_COMPLETION" } },
      { rewardType: "FREE_ORDER_CHANCE", rewardKey: "free_order_review", title: "免单机会", description: "进入人工复核，运营确认后处理。", reviewReason: "免单机会需要运营确认" },
    ],
  };
}

function insertRuleTemplate() {
  ruleForm.payloadText = JSON.stringify(ruleTemplate(), null, 2);
}

function conditionLeafCount(nodes = []) {
  return nodes.reduce((sum, node) => {
    if (!node || node.enabled === false) return sum;
    if (node.kind === "group") return sum + conditionLeafCount(node.children || []);
    return sum + 1;
  }, 0);
}

function conditionLabel(node, fallback) {
  return trimText(node.label) || fallback;
}

function conditionPayload(node) {
  if (!node || node.enabled === false) return null;
  if (node.kind === "group") {
    const children = (node.children || []).map(conditionPayload).filter(Boolean);
    if (!children.length) return null;
    return {
      logic: node.logic === "OR" ? "OR" : "AND",
      label: conditionLabel(node, node.logic === "OR" ? "完成任一互动" : "满足全部条件"),
      conditions: children,
    };
  }
  if (node.conditionType === "TASK_STREAK") {
    return {
      conditionType: "TASK_STREAK",
      taskType: "CHECKIN",
      minStreak: Number(node.minCount || 1),
      label: conditionLabel(node, `连续完成 ${Number(node.minCount || 1)} 天打卡`),
    };
  }
  if (node.conditionType === "QUESTIONNAIRE_COMPLETED") {
    return {
      conditionType: "QUESTIONNAIRE_COMPLETED",
      questionnaireType: trimText(node.questionnaireType) || "DAY8_SUMMARY",
      label: conditionLabel(node, "完成阶段问卷"),
    };
  }
  if (node.conditionType === "SHARE_COUNT") {
    return {
      conditionType: "SHARE_COUNT",
      taskType: "SHARE",
      minCount: Number(node.minCount || 1),
      uniqueBy: "eventId",
      label: conditionLabel(node, `完成 ${Number(node.minCount || 1)} 次分享`),
    };
  }
  if (node.conditionType === "CONSULTATION_REQUIRED") {
    return {
      conditionType: "CONSULTATION_REQUIRED",
      label: conditionLabel(node, "完成一次咨询"),
    };
  }
  if (node.conditionType === "PURCHASE_COMPLETED") {
    const productId = trimText(node.youzanProductId);
    return {
      conditionType: "PURCHASE_COMPLETED",
      youzanProductId: productId,
      label: conditionLabel(node, productId ? "完成指定商品购买" : "完成任一商品购买"),
    };
  }
  return {
    conditionType: "TASK_COUNT",
    taskType: "CHECKIN",
    minCount: Number(node.minCount || 1),
    uniqueBy: trimText(node.uniqueBy) || "taskDate",
    label: conditionLabel(node, `完成 ${Number(node.minCount || 1)} 天打卡`),
  };
}

function builderConditions() {
  return ruleTree.nodes.map(conditionPayload).filter(Boolean);
}

function builderRewards() {
  const rewards = [];
  const withQuota = (reward) => {
    if (!ruleBuilder.rewardStockLimit) return reward;
    return {
      ...reward,
      stockLimit: ruleBuilder.rewardStockLimit,
      quotaKey: `${ruleForm.campaignId || defaultCampaignId}:${reward.rewardKey}`,
    };
  };
  if (ruleBuilder.couponReward) {
    rewards.push(withQuota({
      rewardType: "YOUZAN_COUPON",
      rewardKey: "completion_coupon",
      title: "达标返券",
      description: "完成活动条件后生成待发放优惠券记录。",
      payload: { couponScene: "ROOT_COMPLETION" },
    }));
  }
  if (ruleBuilder.freeOrderReward) {
    const reward = {
      rewardType: "FREE_ORDER_CHANCE",
      rewardKey: "free_order_review",
      title: "免单机会",
      description: "进入人工复核，运营确认后处理。",
      reviewReason: "免单机会需要运营确认",
    };
    if (ruleBuilder.freeOrderChancePercent < 100) {
      reward.chanceRate = ruleBuilder.freeOrderChancePercent / 100;
    }
    rewards.push(withQuota(reward));
  }
  if (ruleBuilder.pointsReward) {
    rewards.push(withQuota({
      rewardType: "POINTS",
      rewardKey: "activity_points",
      title: "活动积分",
      description: "完成活动条件后生成积分承诺记录。",
    }));
  }
  if (ruleBuilder.tagReward) {
    rewards.push(withQuota({
      rewardType: "TAG",
      rewardKey: "activity_completed",
      title: "完成人群标签",
      description: "完成活动条件后进入对应运营人群。",
      payload: { tagKey: "activity_completed" },
    }));
  }
  return rewards;
}

function builderConditionsPayload() {
  const conditions = builderConditions();
  if (ruleTree.logic === "OR") {
    return {
      logic: "OR",
      label: "完成任一互动",
      conditions,
    };
  }
  return conditions;
}

function applyRuleBuilder() {
  const conditions = builderConditions();
  const rewards = builderRewards();
  if (!conditions.length) {
    ElMessage.warning("至少选择一个条件");
    return;
  }
  if (!rewards.length) {
    ElMessage.warning("至少选择一个奖励");
    return;
  }
  ruleForm.payloadText = JSON.stringify({
    conditions: builderConditionsPayload(),
    rewards,
  }, null, 2);
}

async function runSaving(key, action, successText) {
  saving[key] = true;
  try {
    await action();
    ElMessage.success(successText);
    await load();
  } catch (error) {
    ElMessage.error(error.message);
  } finally {
    saving[key] = false;
  }
}

function submitCampaign() {
  if (!requireCapability(ADMIN_CAPABILITIES.CONFIG_WRITE)) return null;
  return runSaving("campaign", () => saveCampaign({
    campaignId: campaignForm.campaignId,
    title: campaignForm.title,
    status: campaignForm.status,
    config: {
      durationDays: campaignForm.durationDays,
      allowNoOrderParticipation: true,
    },
  }), "活动已保存");
}

function submitTask() {
  if (!requireCapability(ADMIN_CAPABILITIES.CONFIG_WRITE)) return null;
  return runSaving("task", () => saveTaskDefinition({
    campaignId: taskForm.campaignId,
    taskType: taskForm.taskType,
    title: taskForm.title,
    required: taskForm.required,
    config: {
      targetCount: taskForm.targetCount,
      uniqueBy: taskForm.taskType === "CHECKIN" ? "taskDate" : "eventId",
    },
  }), "任务已保存");
}

function submitProduct() {
  if (!requireCapability(ADMIN_CAPABILITIES.CONFIG_WRITE)) return null;
  return runSaving("product", () => saveProduct({
    youzanProductId: productForm.youzanProductId,
    title: productForm.title,
    priceText: productForm.priceText,
    campaignId: productForm.campaignId,
    youzanPath: productForm.youzanPath,
    skus: [{ skuId: `${productForm.youzanProductId || "ROOT_PRODUCT"}_DEFAULT`, skuName: "默认规格", stockStatus: "UNKNOWN" }],
  }), "商品已保存");
}

function parsedProductSyncSource() {
  const raw = productSyncForm.productsText.trim();
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return { products: parsed };
  return parsed && typeof parsed === "object" ? parsed : {};
}

function productSyncPayload() {
  return {
    ...parsedProductSyncSource(),
    campaignId: productSyncForm.campaignId,
    limit: productSyncForm.limit,
    cursor: productSyncForm.cursor,
  };
}

function ensureProductSyncRequestId() {
  if (!productSyncForm.requestId) {
    productSyncForm.requestId = `admin-product-sync-${Date.now().toString(36)}`;
  }
  return productSyncForm.requestId;
}

function submitProductSyncPreview() {
  if (!requireCapability(ADMIN_CAPABILITIES.CONFIG_WRITE)) return null;
  return runSaving("productSyncPreview", async () => {
    productSyncResult.value = await previewProductSync(productSyncPayload());
  }, "商品同步预览已生成");
}

function submitProductSyncExecute() {
  if (!requireCapability(ADMIN_CAPABILITIES.CONFIG_WRITE)) return null;
  return runSaving("productSyncExecute", async () => {
    const requestId = ensureProductSyncRequestId();
    productSyncResult.value = await executeProductSync({
      ...productSyncPayload(),
      requestId,
      confirmRisk: productSyncForm.confirmRisk,
      reason: "Element Plus Admin 同步有赞商品",
    }, requestId);
    await load();
  }, "商品同步已执行");
}

function submitRule() {
  if (!requireCapability(ADMIN_CAPABILITIES.CONFIG_WRITE)) return null;
  return runSaving("rule", () => {
    const payload = JSON.parse(ruleForm.payloadText || "{}");
    return publishRuleVersion({
      campaignId: ruleForm.campaignId,
      version: ruleForm.version,
      conditions: payload.conditions || [],
      rewards: payload.rewards || [],
      operatorId: "element-plus-admin",
      reason: "Element Plus Admin 规则发布",
    });
  }, "规则已发布");
}

function submitSettlementPreview() {
  return runSaving("settlement", async () => {
    const result = await previewSettlement({
      rootUserId: settlementForm.rootUserId,
      campaignId: settlementForm.campaignId,
    });
    settlementPreview.value = JSON.stringify(result, null, 2);
  }, "结算预览已生成");
}

function batchRootUserIds() {
  return batchSettlementForm.rootUserIdsText
    .split(/[\s,，;；]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function ensureBatchRequestId() {
  if (!batchSettlementForm.requestId) {
    batchSettlementForm.requestId = `admin-batch-${Date.now().toString(36)}`;
  }
  return batchSettlementForm.requestId;
}

function ensureBatchReviewRequestId() {
  if (!batchReviewForm.requestId) {
    batchReviewForm.requestId = `admin-review-${Date.now().toString(36)}`;
  }
  return batchReviewForm.requestId;
}

function ensureRewardDeliveryRequestId() {
  if (!deliveryForm.requestId) {
    deliveryForm.requestId = `admin-delivery-${Date.now().toString(36)}`;
  }
  return deliveryForm.requestId;
}

function ensureStatusQueryRequestId() {
  if (!statusQueryForm.requestId) {
    statusQueryForm.requestId = `admin-status-${Date.now().toString(36)}`;
  }
  return statusQueryForm.requestId;
}

function trimText(value) {
  return String(value || "").trim();
}

function joinText(value) {
  return Array.isArray(value) ? value.join(" / ") : trimText(value) || "-";
}

function submitBatchPreview() {
  return runSaving("batchPreview", async () => {
    batchSettlementResult.value = await previewSettlementBatch({
      rootUserIds: batchRootUserIds(),
      campaignId: batchSettlementForm.campaignId,
    });
  }, "批量预览已生成");
}

function submitBatchExecute() {
  if (!requireCapability(ADMIN_CAPABILITIES.SETTLEMENT_EXECUTE)) return null;
  return runSaving("batchExecute", async () => {
    const requestId = ensureBatchRequestId();
    batchSettlementResult.value = await executeSettlementBatch({
      rootUserIds: batchRootUserIds(),
      campaignId: batchSettlementForm.campaignId,
      confirmRisk: batchSettlementForm.confirmRisk,
      requestId,
      reason: "Element Plus Admin 批量结算",
    }, requestId);
    await load();
  }, "批量结算已执行");
}

async function handleReview(reviewId, decision) {
  if (!requireCapability(ADMIN_CAPABILITIES.REVIEW_RESOLVE)) return null;
  const requestId = `admin-review-${Date.now().toString(36)}`;
  return runSaving("review", async () => {
    await resolveManualReview(reviewId, {
      decision,
      operatorId: "element-plus-admin",
      reason: decision === "APPROVED" ? "后台复核通过" : "后台复核拒绝",
      publicNote: decision === "APPROVED"
        ? "运营已确认复核通过，奖励页会继续同步发放状态。"
        : "运营已完成复核，本次暂不满足发放条件。",
      requestId,
    }, requestId);
  }, "复核已处理");
}

function canSelectReview(row) {
  return canReviewResolve.value && row.status === "OPEN";
}

function handleReviewSelection(rows) {
  selectedReviewIds.value = rows
    .filter(canSelectReview)
    .map((row) => row.reviewItemId || row.manualReviewItemId)
    .filter(Boolean);
}

function submitBatchReview() {
  if (!requireCapability(ADMIN_CAPABILITIES.REVIEW_RESOLVE)) return null;
  return runSaving("batchReview", async () => {
    const requestId = ensureBatchReviewRequestId();
    await resolveManualReviewBatch({
      reviewItemIds: selectedReviewIds.value,
      decision: batchReviewForm.decision,
      confirmRisk: batchReviewForm.confirmRisk,
      requestId,
      reason: batchReviewForm.decision === "APPROVED" ? "Element Plus Admin 批量复核通过" : "Element Plus Admin 批量复核拒绝",
      publicNote: batchReviewForm.publicNote,
    }, requestId);
    selectedReviewIds.value = [];
    await load();
  }, "批量复核已处理");
}

function canSelectDeliveryJob(row) {
  return ["PENDING", "FAILED"].includes(row.status);
}

function canSelectStatusJob(row) {
  return row.adapterType === "YOUZAN_COUPON";
}

function canSelectDeliveryRow(row) {
  return canRewardDeliveryWrite.value && (canSelectDeliveryJob(row) || canSelectStatusJob(row));
}

function handleDeliverySelection(rows) {
  selectedDeliveryJobIds.value = rows
    .filter((row) => canRewardDeliveryWrite.value && ["PENDING", "FAILED"].includes(row.status))
    .map((row) => row.deliveryJobId)
    .filter(Boolean);
  selectedWeworkTagJobIds.value = rows
    .filter((row) => canRewardDeliveryWrite.value && row.adapterType === "WEWORK_TAG" && ["PENDING", "FAILED"].includes(row.status))
    .map((row) => row.deliveryJobId)
    .filter(Boolean);
  selectedStatusJobIds.value = rows
    .filter((row) => canRewardDeliveryWrite.value && canSelectStatusJob(row))
    .map((row) => row.deliveryJobId)
    .filter(Boolean);
  const tagRow = rows.find((row) => row.adapterType === "WEWORK_TAG" && ["PENDING", "FAILED"].includes(row.status));
  if (selectedWeworkTagJobIds.value.length === 1 && tagRow) fillWeworkTagForm(tagRow, { silent: true });
}

function displayWeworkTag(row) {
  const hint = row.weworkTagHint || {};
  return [hint.tagName, hint.tagId].filter(Boolean).join(" / ") || "-";
}

function displayWeworkContact(row) {
  const hint = row.weworkTagHint || {};
  return [hint.externalContactId, hint.remarkName].filter(Boolean).join(" / ") || "-";
}

function fillWeworkTagForm(row, options = {}) {
  const hint = row.weworkTagHint || {};
  deliveryForm.externalContactId = hint.externalContactId || deliveryForm.externalContactId;
  deliveryForm.tagId = hint.tagId || deliveryForm.tagId;
  deliveryForm.tagName = hint.tagName || deliveryForm.tagName;
  if (!options.silent) ElMessage.success("企微标签字段已填入");
}

function deliveryWeworkTagPayload() {
  if (selectedWeworkTagJobIds.value.length !== 1) return {};
  const payload = {
    externalContactId: trimText(deliveryForm.externalContactId),
    tagId: trimText(deliveryForm.tagId),
    tagName: trimText(deliveryForm.tagName),
  };
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value));
}

function rewardDeliveryPayload(outcome, requestId) {
  const payload = {
    deliveryJobIds: selectedDeliveryJobIds.value,
    outcome,
    deliveryMode: deliveryForm.deliveryMode,
    externalRef: deliveryForm.externalRef,
    confirmRisk: deliveryForm.confirmRisk,
    requestId,
    reason: outcome === "DELIVERED" ? "Element Plus Admin 确认奖励已发放" : "Element Plus Admin 标记奖励发放失败",
    errorMessage: outcome === "FAILED" ? "运营标记发放失败，待重试" : "",
  };
  const tagPayload = deliveryWeworkTagPayload();
  if (Object.keys(tagPayload).length) {
    Object.assign(payload, tagPayload, { payload: tagPayload });
  }
  return payload;
}

function submitRewardDelivery(outcome) {
  if (!requireCapability(ADMIN_CAPABILITIES.REWARD_DELIVERY_WRITE)) return null;
  return runSaving("rewardDelivery", async () => {
    const requestId = ensureRewardDeliveryRequestId();
    await executeRewardDelivery(rewardDeliveryPayload(outcome, requestId), requestId);
    selectedDeliveryJobIds.value = [];
    selectedWeworkTagJobIds.value = [];
    await load();
  }, outcome === "DELIVERED" ? "奖励发放已确认" : "奖励发放失败已记录");
}

function submitRewardStatusQuery() {
  if (!requireCapability(ADMIN_CAPABILITIES.REWARD_DELIVERY_WRITE)) return null;
  return runSaving("statusQuery", async () => {
    const requestId = ensureStatusQueryRequestId();
    await queryRewardDeliveryStatus({
      deliveryJobIds: selectedStatusJobIds.value,
      deliveryMode: statusQueryForm.deliveryMode,
      externalStatus: statusQueryForm.deliveryMode === "AUTO" ? "" : statusQueryForm.externalStatus,
      externalRef: statusQueryForm.externalRef,
      statusMessage: statusQueryForm.statusMessage,
      requestId,
      reason: statusQueryForm.deliveryMode === "AUTO"
        ? "Element Plus Admin 查询有赞券状态"
        : "Element Plus Admin 人工回写有赞券状态",
    }, requestId);
    selectedStatusJobIds.value = [];
    await load();
  }, "券状态已更新");
}

onMounted(() => {
  insertRuleTemplate();
  load();
});

defineExpose({ load });
</script>

<style scoped>
.review-explainer {
  display: grid;
  gap: 4px;
  line-height: 1.45;
}

.review-explainer strong {
  color: #1f2a24;
  font-size: 13px;
}

.review-explainer span,
.review-explainer small {
  color: #66746c;
  font-size: 12px;
}

.template-card {
  margin-top: 16px;
}

.rule-builder-panel {
  display: grid;
  gap: 10px;
  margin-bottom: 14px;
  padding: 12px;
  border: 1px solid #dfe7e2;
  border-radius: 8px;
  background: #f8fbf9;
}

.rule-builder-panel :deep(.el-form-item) {
  margin-bottom: 0;
}

.rule-builder-grid {
  display: grid;
  grid-template-columns: minmax(72px, 0.7fr) minmax(130px, 1fr);
  gap: 8px 10px;
  align-items: center;
}

.rule-builder-grid--rewards {
  grid-template-columns: minmax(72px, 0.7fr) minmax(130px, 1fr);
}

.rule-tree-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.rule-tree-editor {
  display: grid;
  gap: 8px;
}

.rule-tree-node,
.rule-condition-row {
  border: 1px solid #dfe7e2;
  border-radius: 8px;
  background: #ffffff;
}

.rule-tree-node--disabled {
  opacity: 0.58;
}

.rule-tree-node-header,
.rule-condition-row {
  display: grid;
  grid-template-columns: 44px 48px minmax(128px, 1fr) minmax(132px, 1fr) repeat(4, auto);
  gap: 8px;
  align-items: center;
  padding: 8px;
}

.rule-tree-node-header--group {
  grid-template-columns: 44px 48px minmax(120px, 1fr) minmax(132px, 1fr) repeat(4, auto);
  background: #f0f6f2;
  border-radius: 8px 8px 0 0;
}

.rule-condition-row {
  grid-template-columns: 44px 48px minmax(132px, 1.1fr) minmax(104px, 0.8fr) minmax(128px, 1fr) minmax(148px, 1.2fr) repeat(3, auto);
}

.rule-condition-row--child {
  border-color: #e6ede8;
}

.rule-tree-children {
  display: grid;
  gap: 8px;
  padding: 8px 8px 8px 28px;
}

.drag-handle {
  color: #66746c;
  cursor: grab;
  font-size: 12px;
  font-weight: 700;
}

.rule-builder-note {
  color: #66746c;
  font-size: 12px;
}

.rule-builder-label {
  color: #314039;
  font-size: 13px;
  font-weight: 600;
}

.rule-builder-rewards {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
}
</style>
