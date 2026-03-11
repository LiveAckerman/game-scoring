const DEFAULT_FONT_SIZE_LEVEL: 'small' | 'medium' | 'large' = 'medium';

// app.ts
App<IAppOption>({
  globalData: {
    userInfo: null,
    guestProfile: null,
    token: '',
    guestToken: '',
    deviceId: '',
    fontSizeLevel: DEFAULT_FONT_SIZE_LEVEL,
    statusBarHeight: 20,
  },
  onLaunch() {
    const token = String(wx.getStorageSync('token') || '').trim();
    if (token) {
      this.globalData.token = token;
    }

    const guestToken = String(wx.getStorageSync('guestToken') || '').trim();
    if (guestToken) {
      this.globalData.guestToken = guestToken;
    }

    const userInfo = wx.getStorageSync('userInfo');
    if (userInfo) {
      this.globalData.userInfo = userInfo as AppUserInfo;
    }

    const guestProfile = wx.getStorageSync('guestProfile');
    if (guestProfile) {
      this.globalData.guestProfile = guestProfile as AppGuestProfile;
    }

    const deviceId = String(wx.getStorageSync('deviceId') || '').trim();
    if (deviceId) {
      this.globalData.deviceId = deviceId;
    }

    const fontSizeLevel = wx.getStorageSync('fontSizeLevel') || DEFAULT_FONT_SIZE_LEVEL;
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
