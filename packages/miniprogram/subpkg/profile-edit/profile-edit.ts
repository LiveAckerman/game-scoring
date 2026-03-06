import { request } from '../../utils/request';
import { uploadFile } from '../../utils/upload';

Page({
  data: {
    saving: false,
    nicknameFocus: false,
    avatarTempPath: '',
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

  goBack() {
    wx.navigateBack();
  },

  async fetchUserInfo() {
    try {
      const userInfo = await request({ url: '/user/profile' });
      this.setData({ userInfo });
    } catch (err) {
      console.error('获取用户信息失败', err);
    }
  },

  onChooseAvatar(e: any) {
    const { avatarUrl } = e.detail;
    if (!avatarUrl) {
      wx.showToast({ title: '未获取到头像', icon: 'none' });
      return;
    }
    this.setData({ avatarTempPath: avatarUrl });
  },

  onNicknameInput(e: any) {
    this.setData({ 'userInfo.nickname': e.detail.value });
  },

  onNicknameFocus() {
    this.setData({ nicknameFocus: true });
  },

  onNicknameBlur(e: any) {
    this.setData({ nicknameFocus: false });
    if (e.detail.value) {
      this.setData({ 'userInfo.nickname': e.detail.value });
    }
  },

  focusNickname() {
    this.setData({ nicknameFocus: true });
  },

  setGender(e: any) {
    const gender = parseInt(e.currentTarget.dataset.val);
    this.setData({ 'userInfo.gender': gender });
  },

  setTitle(e: any) {
    const title = e.currentTarget.dataset.val;
    if (title === '小财神') {
      this.setData({ 'userInfo.title': title });
    } else {
      wx.showToast({ title: '称号尚未解锁', icon: 'none' });
    }
  },

  async handleSave() {
    if (this.data.saving) return;

    const nickname = String(this.data.userInfo.nickname || '').trim();
    if (!nickname) {
      wx.showToast({ title: '昵称不能为空', icon: 'none' });
      this.setData({ nicknameFocus: true });
      return;
    }

    this.setData({ saving: true });
    wx.showLoading({ title: '保存中...' });

    try {
      let avatarUrl = this.data.userInfo.avatar;

      if (this.data.avatarTempPath) {
        const uploadRes = await uploadFile({
          url: '/user/avatar',
          filePath: this.data.avatarTempPath,
          name: 'file',
        });
        const parsed = JSON.parse(uploadRes.data);
        avatarUrl = parsed.url || parsed.avatar || avatarUrl;
      }

      await request({
        url: '/user/profile',
        method: 'PUT',
        data: {
          nickname,
          avatar: avatarUrl,
          gender: this.data.userInfo.gender,
          title: this.data.userInfo.title
        }
      });

      wx.hideLoading();
      wx.showToast({ title: '保存成功', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 1500);
    } catch (err) {
      wx.hideLoading();
      console.error('保存失败', err);
    } finally {
      this.setData({ saving: false });
    }
  }
});
