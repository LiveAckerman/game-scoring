Page({
  data: {
    activeTab: 'all'
  },

  switchTab(e: any) {
    const id = e.currentTarget.dataset.id;
    this.setData({
      activeTab: id
    });
  },

  onShow() {
    // 检查登录
    const token = wx.getStorageSync('token');
    if (!token) {
      wx.redirectTo({ url: '/pages/login/login' });
    }
  }
});
