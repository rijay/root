import { createApp } from "vue";
import { ElAlert } from "element-plus/es/components/alert/index";
import { ElButton } from "element-plus/es/components/button/index";
import { ElCard } from "element-plus/es/components/card/index";
import { ElCheckbox } from "element-plus/es/components/checkbox/index";
import { ElConfigProvider } from "element-plus/es/components/config-provider/index";
import { ElDatePicker } from "element-plus/es/components/date-picker/index";
import { ElDescriptions, ElDescriptionsItem } from "element-plus/es/components/descriptions/index";
import { ElDialog } from "element-plus/es/components/dialog/index";
import { ElDrawer } from "element-plus/es/components/drawer/index";
import { ElEmpty } from "element-plus/es/components/empty/index";
import { ElForm, ElFormItem } from "element-plus/es/components/form/index";
import { ElInput } from "element-plus/es/components/input/index";
import { ElInputNumber } from "element-plus/es/components/input-number/index";
import { ElLoading } from "element-plus/es/components/loading/index";
import { ElMenu, ElMenuItem } from "element-plus/es/components/menu/index";
import { ElOption, ElSelect } from "element-plus/es/components/select/index";
import { ElPagination } from "element-plus/es/components/pagination/index";
import { ElPopover } from "element-plus/es/components/popover/index";
import { ElSkeleton } from "element-plus/es/components/skeleton/index";
import { ElSpace } from "element-plus/es/components/space/index";
import { ElTable, ElTableColumn } from "element-plus/es/components/table/index";
import { ElTag } from "element-plus/es/components/tag/index";
import { ElUpload } from "element-plus/es/components/upload/index";
import "element-plus/theme-chalk/base.css";
import "element-plus/theme-chalk/el-alert.css";
import "element-plus/theme-chalk/el-button.css";
import "element-plus/theme-chalk/el-card.css";
import "element-plus/theme-chalk/el-checkbox.css";
import "element-plus/theme-chalk/el-date-picker.css";
import "element-plus/theme-chalk/el-descriptions.css";
import "element-plus/theme-chalk/el-dialog.css";
import "element-plus/theme-chalk/el-drawer.css";
import "element-plus/theme-chalk/el-empty.css";
import "element-plus/theme-chalk/el-form.css";
import "element-plus/theme-chalk/el-input.css";
import "element-plus/theme-chalk/el-input-number.css";
import "element-plus/theme-chalk/el-loading.css";
import "element-plus/theme-chalk/el-menu.css";
import "element-plus/theme-chalk/el-message.css";
import "element-plus/theme-chalk/el-message-box.css";
import "element-plus/theme-chalk/el-pagination.css";
import "element-plus/theme-chalk/el-popover.css";
import "element-plus/theme-chalk/el-select.css";
import "element-plus/theme-chalk/el-skeleton.css";
import "element-plus/theme-chalk/el-space.css";
import "element-plus/theme-chalk/el-table.css";
import "element-plus/theme-chalk/el-tag.css";
import "element-plus/theme-chalk/el-upload.css";
import App from "./App.vue";
import "./styles/theme.css";

const app = createApp(App);
[
  ElAlert,
  ElButton,
  ElCard,
  ElCheckbox,
  ElConfigProvider,
  ElDatePicker,
  ElDescriptions,
  ElDescriptionsItem,
  ElDialog,
  ElDrawer,
  ElEmpty,
  ElForm,
  ElFormItem,
  ElInput,
  ElInputNumber,
  ElLoading,
  ElMenu,
  ElMenuItem,
  ElOption,
  ElPagination,
  ElPopover,
  ElSelect,
  ElSkeleton,
  ElSpace,
  ElTable,
  ElTableColumn,
  ElTag,
  ElUpload,
].forEach((component) => app.use(component));
app.mount("#app");
