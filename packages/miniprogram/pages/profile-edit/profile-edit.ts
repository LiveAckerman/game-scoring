import { request } from '../../utils/request';

Page({
  data: {
    userInfo: {
      nickname: '',
      avatar: '',
      gender: 0,
      title: '小财神'
    }
  },

  onLoad() {
    this.fetchUserInfo();
  },

  async fetchUserInfo() {
    try {
      const userInfo = await request({ url: '/user/profile' });
      this.setData({ userInfo });
    } catch (err) {
      console.error('获取用户信息失败', err);
    }
  },

  onNicknameInput(e: any) {
    this.setData({
      'userInfo.nickname': e.detail.value
    });
  },

  setGender(e: any) {
    const gender = parseInt(e.currentTarget.dataset.val);
    this.setData({
      'userInfo.gender': gender
    });
  },

  setTitle(e: any) {
    const title = e.currentTarget.dataset.val;
    if (title === '小财神') {
      this.setData({
        'userInfo.title': title
      });
    } else {
      wx.showToast({ title: '称号尚未解锁', icon: 'none' });
    }
  },

  chooseAvatar() {
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        // 实际开发中应上传到服务器并获取 URL，这里暂存临时路径
        this.setData({
          'userInfo.avatar': res.tempFilePaths[0]
        });
      }
    });
  },

  async handleSave() {
    wx.showLoading({ title: '保存中...' });
    try {
      await request({
        url: '/user/profile',
        method: 'PUT',
        data: {
          nickname: this.data.userInfo.nickname,
          avatar: this.data.userInfo.avatar,
          gender: this.data.userInfo.gender,
          title: this.data.userInfo.title
        }
      });
      wx.hideLoading();
      wx.showToast({ title: '保存成功', icon: 'success' });
      setTimeout(() => {
        wx.navigateBack();
      }, 1500);
    } catch (err) {
      wx.hideLoading();
      console.error('保存失败', err);
    }
  }
});
