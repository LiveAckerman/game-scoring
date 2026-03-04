// app.ts
App<IAppOption>({
  globalData: {
    userInfo: null,
    guestProfile: null,
    token: '',
  },
  onLaunch() {
    const logs: number[] = wx.getStorageSync('logs') || [];
    logs.unshift(Date.now());
    wx.setStorageSync('logs', logs);

    const token = wx.getStorageSync('token');
    if (token) {
      this.globalData.token = token;
    }

    const guestProfile = wx.getStorageSync('guestProfile');
    if (guestProfile) {
      this.globalData.guestProfile = guestProfile as AppGuestProfile;
    }
  },
});
