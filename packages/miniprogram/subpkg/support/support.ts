import { fontSizeBehavior } from '../../behaviors/font-size';

interface SupportFaq {
  title: string;
  desc: string;
}

Page({
  behaviors: [fontSizeBehavior],
  data: {
    faqs: [
      {
        title: '数据恢复失败',
        desc: '请确认当前是原来的设备，并登录要绑定的微信账号后再尝试恢复。',
      },
      {
        title: '登录失败',
        desc: '请检查网络是否稳定，并确认微信授权流程已经完成。',
      },
      {
        title: '房间异常',
        desc: '请准备房间号、问题发生时间和涉及玩家昵称，便于客服快速定位。',
      },
      {
        title: '记分有误',
        desc: '请提供房间号、异常记录和正确结果，客服会协助核对。',
      },
    ] as SupportFaq[],
  },

  onShow() {
    (this as any)._applyFontSize();
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
      return;
    }

    wx.switchTab({ url: '/pages/profile/profile' });
  },
});
