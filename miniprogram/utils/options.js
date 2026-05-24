const joinReasonOptions = [
  { value: "health", label: "饮食健康/便型调理" },
  { value: "gut_flora", label: "肠道菌群改善" },
  { value: "skin", label: "皮肤/情绪/睡眠改善" },
  { value: "none", label: "没有特殊原因", exclusive: true },
];

const gutHealthOptions = [
  { value: "good", label: "良好，无明显问题" },
  { value: "normal", label: "一般，偶尔有问题" },
  { value: "poor", label: "较差，经常有问题" },
  { value: "very_poor", label: "很差，长期困扰" },
];

const improvementOptions = [
  { value: "diet", label: "调整饮食结构" },
  { value: "exercise", label: "规律运动" },
  { value: "probiotics", label: "服用益生菌/益生元" },
  { value: "medical", label: "看医生/吃药" },
  { value: "none", label: "暂未采取任何方式", exclusive: true },
];

const stoolOptions = [
  { value: "type1", label: "第一型：分散硬球，难排便", image: "/static/stool/type1.png" },
  { value: "type2", label: "第二型：腊肠状但表面凹凸", image: "/static/stool/type2.png" },
  { value: "type3", label: "第三型：腊肠状但表面有裂痕", image: "/static/stool/type3.png" },
  { value: "type4", label: "第四型：光滑柔软的腊肠状", image: "/static/stool/type4.png" },
  { value: "type5", label: "第五型：断边光滑的柔软块状", image: "/static/stool/type5.png" },
  { value: "type6", label: "第六型：粗边蓬松糊状", image: "/static/stool/type6.png" },
  { value: "type7", label: "第七型：水状无固体", image: "/static/stool/type7.png" },
];

module.exports = {
  gutHealthOptions,
  improvementOptions,
  joinReasonOptions,
  stoolOptions,
};
