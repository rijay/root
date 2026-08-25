const { request } = require("../../utils/request");
const { defaultOnShareAppMessage } = require("../../utils/page-share");
const { presentHealthPrivacyNotice } = require("../../utils/health-consent");

const UPDATED_AT = "2026年8月25日";
const docs = Object.freeze({
  agreement: {
    title: "用户协议",
    updatedAt: UPDATED_AT,
    sections: [
      {
        title: "一、服务内容",
        items: [
          "myRoot 提供品牌与商品内容浏览、Root4U 健康评测与生活方式建议、线下活动浏览与报名，以及会员资料与支持入口。",
          "我的订单与优惠券由你主动点击后前往 Root 会员中心查看；myRoot 不复制展示会员等级、积分、余额或资产摘要。",
        ],
      },
      {
        title: "二、健康信息说明",
        items: [
          "Root4U 用于健康状态了解与生活方式建议，不提供医疗诊断、治疗建议或疾病疗效承诺。出现明显或持续不适时，请及时咨询专业医生。",
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
        ],
      },
      {
        title: "二、使用与保存",
        items: [
          "当前版本的 Root4U 问卷答案、评测结果和回测记录仅在当前设备处理，不上传到 myRoot 服务器。",
          "上述本机数据自最后保存起最长保留 180 天，到期自动删除；更换设备、清理微信小程序数据后也会提前丢失且无法恢复。",
          "myRoot 服务器仅保存同意或撤回审计记录，以及登录、安全与稳定运行所必需的最少技术记录，不包含问卷答案和评测结果。依法需要保留的记录仅在必要期限内限制处理。",
        ],
      },
      {
        title: "三、你的选择与权利",
        items: [
          "你可以拒绝非必要授权、管理微信平台授权，并通过小程序内客服申请查阅、更正、删除或注销 myRoot 账号。本机健康评测数据可通过微信清理小程序数据立即删除；注销 myRoot 不会自动注销 Root 会员中心账号。",
        ],
      },
      {
        title: "四、对外提供",
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
          "手机号、生日、性别：用于注册和必要的人群适配；手机号、生日、性别为注册必填项。",
          "头像、昵称：用于个人资料展示；未授权时分别使用 Root 文字标识和“Root用户”。",
        ],
      },
      {
        title: "Root4U 与活动",
        items: [
          "Root4U 问卷答案、结果与回测记录：仅在单独同意并主动作答后在当前设备处理，不上传到 myRoot 服务器。",
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
          "用于 myRoot 后端运行、必要业务数据与媒体存储、安全控制和审计。当前版本的 Root4U 问卷答案、评测结果和回测记录不会发送至腾讯云 CloudBase。",
        ],
      },
      {
        title: "Root 会员中心",
        items: [
          "仅在你主动点击“我的订单”或“优惠券”后打开对应白名单页面。myRoot 当前不读取或缓存会员等级、积分、余额、优惠券数量及订单摘要。",
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
