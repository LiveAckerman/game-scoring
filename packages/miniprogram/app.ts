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
  },
});
