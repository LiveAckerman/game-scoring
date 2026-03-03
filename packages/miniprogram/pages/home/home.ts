Page({
  onLoad() {
    const token = wx.getStorageSync('token');
    if (!token) {
      wx.redirectTo({ url: '/pages/login/login' });
    }
  },

  startMultiMode() {
    wx.showToast({ title: '多人记分功能开发中', icon: 'none' });
  },

  startSingleMode() {
    wx.showToast({ title: '单人记分功能开发中', icon: 'none' });
  },

  startPoolMode() {
    wx.showToast({ title: '分数池功能开发中', icon: 'none' });
  },

  viewAllRecords() {
    wx.switchTab({ url: '/pages/records/records' });
  }
});
