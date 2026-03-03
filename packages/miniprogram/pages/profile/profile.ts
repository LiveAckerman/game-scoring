import { request } from '../../utils/request';

Page({
  data: {
    userInfo: null
  },

  onShow() {
    this.fetchUserInfo();
  },

  async fetchUserInfo() {
    try {
      const userInfo = await request({
        url: '/user/profile'
      });
      this.setData({ userInfo });
    } catch (err) {
      console.error('获取用户信息失败', err);
    }
  },

  goToEdit() {
    wx.navigateTo({ url: '/pages/profile-edit/profile-edit' });
  },

  handleLogout() {
    wx.showModal({
      title: '提示',
      content: '确定退出登录吗？',
      success: (res) => {
        if (res.confirm) {
          wx.removeStorageSync('token');
          wx.reLaunch({ url: '/pages/login/login' });
        }
      }
    });
  }
});
