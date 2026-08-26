const { request } = require("../../utils/request");
const { defaultOnShareAppMessage } = require("../../utils/page-share");
const { presentHealthPrivacyNotice } = require("../../utils/health-consent");

const UPDATED_AT = "2026年8月26日";
const docs = Object.freeze({
  agreement: {
    title: "用户协议",
    updatedAt: UPDATED_AT,
    sections: [
      {
        title: "一、服务内容",
        items: [
          "myRoot 提供品牌与商品内容浏览、Root4U 健康评测与生活方式建议、线下活动浏览与报名，以及会员资料与支持入口。",
          "在同主体微信身份关联成功后，myRoot 可展示最小化的订单数量、待处理数量和可用优惠券数量；订单、优惠券详情仍由你主动点击后前往 Root 会员中心查看。",
        ],
      },
      {
        title: "二、健康信息说明",
        items: [
          "Root4U 用于健康状态了解与生活方式建议，不提供医疗诊断、治疗建议或疾病疗效承诺。出现明显或持续不适时，请及时咨询专业医生。",
          "标注为“AI 辅助生成”的内容仅作日常健康管理参考；评测分类和安全分流由已审核规则确定，模型不能改写。",
        ],
      },
      {
        title: "三、活动规则",
        items: [
          "活动时间、地点、费用、名额、报名状态与取消规则以对应活动页面展示及后台权威记录为准。重复提交不会产生重复报名事实。",
        ],
      },
      {
        title: "四、账号与服务变更",
        items: [
          "你应保证主动填写的信息真实、准确。重要功能或规则变化将通过小程序页面或 Root 官方渠道说明。",
        ],
      },
    ],
  },
  privacy: {
    title: "隐私政策",
    updatedAt: UPDATED_AT,
    sections: [
      {
        title: "一、我们处理的信息",
        items: [
          "在你授权或主动填写后，我们处理微信身份标识、手机号、头像、昵称、生日与性别，用于登录、注册和会员资料管理。",
          "在你单独同意并主动参加 Root4U 后，我们处理问卷答案、评测结果和必要的健康相关信息，用于生成个人结果与生活方式建议。",
          "在你报名活动后，我们处理报名、取消与状态记录，用于活动组织、通知和安全保障。",
          "在同主体微信身份关联成功后，我们按需查询 Root 会员中心的订单数量、待处理数量、可用优惠券数量，以及商品价格与规格快照；不读取收货地址、订单明细、券码、会员等级、积分或余额。",
        ],
      },
      {
        title: "二、使用与保存",
        items: [
          "Root4U 问卷答案、评测结果和回测记录会加密传输并保存到你的 myRoot 账号，用于跨设备查看、同版回测对比和生成健康建议。",
          "原始健康评测答案原则上按单独同意页面载明的期限保存；到期后自动脱敏。评测版本、完成时间和同意审计事实按实现服务与合规所需的必要期限保存。",
          "你可以在评测历史中随时删除单条记录；删除后对应问卷答案、评测结果和回测记录不可恢复。法律法规另有要求的除外。",
          "会员中心数量摘要与商品价格快照仅作短时内存缓存，用于减少重复请求；myRoot 不持久化订单明细、收货地址或优惠券码。",
        ],
      },
      {
        title: "三、模型辅助建议",
        items: [
          "仅在两项评测均完成且未进入安全提示分支时，模型辅助功能才会调用腾讯云 CloudBase AI。发送范围限于评测类型、问卷版本、结果代码、状态标题和安全分流标记；不发送姓名、手机号、微信身份标识、原始问卷答案或自由文本。",
          "模型输出必须经过固定结构、长度、禁用表达和安全规则校验后才能展示；高风险分支不调用普通建议模型，模型不可用或输出未通过校验时自动改用经审核固定建议。",
        ],
      },
      {
        title: "四、你的选择与权利",
        items: [
          "你可以拒绝非必要授权、管理微信平台授权，并通过小程序内客服申请查阅、更正、删除或注销 myRoot 账号。健康评测记录可在评测历史中删除；注销 myRoot 不会自动注销 Root 会员中心账号。",
        ],
      },
      {
        title: "五、对外提供",
        items: [
          "除获得你的同意、为完成你主动请求的功能所必需或法律法规另有要求外，我们不会向无关第三方提供个人信息。",
        ],
      },
    ],
  },
  collection: {
    title: "个人信息收集清单",
    updatedAt: UPDATED_AT,
    sections: [
      {
        title: "账号与资料",
        items: [
          "微信身份标识：用于识别登录用户及同主体小程序身份关联。",
          "会员中心最小化摘要：在身份关联成功后按需查询订单总数、待处理订单数和可用优惠券数；仅作短时内存缓存。",
          "手机号、生日、性别：用于注册和必要的人群适配；手机号、生日、性别为注册必填项。",
          "头像、昵称：用于个人资料展示；未授权时分别使用 Root 文字标识和“Root用户”。",
        ],
      },
      {
        title: "Root4U 与活动",
        items: [
          "Root4U 问卷答案、结果与回测记录：仅在单独同意并主动作答后保存到 myRoot 账号，用于生成结果、跨设备查看、同版对比和健康建议；可在评测历史中删除。",
          "模型辅助建议最小结构化状态：仅包含评测类型、问卷版本、结果代码、状态标题和安全分流标记；不包含用户身份、联系方式、原始问卷答案或自由文本。",
          "健康敏感信息同意记录：保存同意或撤回决定、政策版本与发生时间，不包含问卷答案和评测结果。",
          "活动报名与取消记录：用于名额管理、状态查询、通知和安全保障。",
        ],
      },
      {
        title: "运行保障",
        items: [
          "必要的请求时间、错误码、幂等请求号与安全审计记录：用于稳定性、重复提交防护和问题排查。",
        ],
      },
    ],
  },
  sharing: {
    title: "第三方信息共享清单",
    updatedAt: UPDATED_AT,
    sections: [
      {
        title: "微信平台",
        items: [
          "用于小程序运行、微信登录、隐私授权、手机号验证、头像昵称控件与跨小程序跳转。具体处理范围以微信平台规则为准。",
        ],
      },
      {
        title: "腾讯云 CloudBase",
        items: [
          "用于 myRoot 后端运行、Root4U 健康评测记录及其他必要业务数据与媒体存储、安全控制和审计。健康记录仅在你单独同意并主动使用 Root4U 后处理。",
          "模型辅助建议启用后，腾讯云 CloudBase AI 受托处理由评测规则生成的最小结构化状态并返回建议；高风险分支不调用普通建议模型，不向模型发送姓名、手机号、微信身份标识、原始问卷答案或自由文本。",
        ],
      },
      {
        title: "Root 会员中心",
        items: [
          "为识别同主体会员，myRoot 向 Root 会员中心所使用的有赞开放平台发送经验证的微信 UnionID；只接收并展示订单数量、待处理数量、可用优惠券数量及商品价格与规格快照。订单与优惠券详情仅在你主动点击后通过白名单页面打开；不读取会员等级、积分、余额、收货地址、订单明细或券码。",
        ],
      },
    ],
  },
});

Page({
  data: {
    doc: docs.agreement,
    documentType: "agreement",
    privacyNotice: null,
  },

  onLoad(options = {}) {
    const type = Object.prototype.hasOwnProperty.call(docs, options.type) ? options.type : "agreement";
    const doc = docs[type];
    this.setData({ doc, documentType: type });
    wx.setNavigationBarTitle({ title: doc.title });
    if (type === "privacy") this.loadPrivacyNotice();
  },

  async loadPrivacyNotice() {
    try {
      const notice = await request({ url: "/api/v1/privacy/notice" });
      if (notice && notice.configured) this.setData({ privacyNotice: presentHealthPrivacyNotice(notice) });
    } catch (_) {
      // 公共元数据读取失败时，仍可查看随包发布的最小隐私说明。
    }
  },

  onShareAppMessage: defaultOnShareAppMessage,
});
