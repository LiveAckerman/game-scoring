// app.ts
App<IAppOption>({
  globalData: {
    userInfo: null,
    guestProfile: null,
    token: '',
    fontSizeLevel: 'medium' as 'small' | 'medium' | 'large',
  },
  onLaunch() {
    const logs: number[] = wx.getStorageSync('logs') || [];
    logs.unshift(Date.now());
    wx.setStorageSync('logs', logs);

    const token = wx.getStorageSync('token');
    if (token) {
      this.globalData.token = token;
    }

    const userInfo = wx.getStorageSync('userInfo');
    if (userInfo) {
      this.globalData.userInfo = userInfo as AppUserInfo;
    }

    const guestProfile = wx.getStorageSync('guestProfile');
    if (guestProfile) {
      this.globalData.guestProfile = guestProfile as AppGuestProfile;
    }

    const fontSizeLevel = wx.getStorageSync('fontSizeLevel') || 'medium';
    this.globalData.fontSizeLevel = fontSizeLevel;

    this.registerUpdateManager();
  },

  registerUpdateManager() {
    if (typeof wx.getUpdateManager !== 'function') {
      return;
    }

    const updateManager = wx.getUpdateManager();

    updateManager.onUpdateReady(() => {
      wx.showModal({
        title: '发现新版本',
        content: '新版本已经准备好，点击确定重启小程序完成更新。',
        showCancel: false,
        confirmText: '立即重启',
        success: (res) => {
          if (res.confirm) {
            updateManager.applyUpdate();
          }
        },
      });
    });

    updateManager.onUpdateFailed(() => {
      wx.showModal({
        title: '更新失败',
        content: '新版本下载失败，请关闭小程序后重新打开再试。',
        showCancel: false,
      });
    });
  },
});
