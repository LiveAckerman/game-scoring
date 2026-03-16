import { login } from '../../utils/auth';
import { fontSizeBehavior } from '../../behaviors/font-size';
import { relaunchProfileSetup } from '../../utils/profile';

Page({
  behaviors: [fontSizeBehavior],
  data: {
    isAgreed: false
  },

  onShow() {
    (this as any)._applyFontSize();
  },

  handleAgreementChange(e: any) {
    this.setData({
      isAgreed: e.detail.value.length > 0
    });
  },

  async handleLogin() {
    if (!this.data.isAgreed) {
      wx.showToast({
        title: '请先同意用户协议',
        icon: 'none'
      });
      return;
    }

    wx.showLoading({ title: '登录中...' });

    try {
      const result = await login();
      wx.hideLoading();
      if (result.needsProfileSetup) {
        relaunchProfileSetup();
        return;
      }
      wx.switchTab({
        url: '/pages/home/home'
      });
    } catch (err) {
      wx.hideLoading();
      console.error('登录失败', err);
      wx.showModal({
        title: '登录失败',
        content: '请确保后端服务已启动并正确配置了微信 AppID',
        showCancel: false
      });
    }
  }
});
