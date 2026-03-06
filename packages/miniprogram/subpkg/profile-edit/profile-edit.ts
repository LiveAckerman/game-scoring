import { request } from '../../utils/request';

const WX_PROFILE_MIN_INTERVAL_MS = 1500;
let lastWxProfileInvokeAt = 0;

Page({
  data: {
    saving: false,
    nicknameFocus: false,
    wechatProfileLoading: false,
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

  onNicknameInput(e: any) {
    this.setData({
      'userInfo.nickname': e.detail.value
    });
  },

  onNicknameFocus() {
    this.setData({ nicknameFocus: true });
  },

  onNicknameBlur() {
    this.setData({ nicknameFocus: false });
  },

  handleNicknameTap() {
    wx.showActionSheet({
      itemList: ['使用微信昵称', '手动输入昵称'],
      success: async (res) => {
        if (res.tapIndex === 0) {
          await this.syncWechatProfile({ withNickname: true, withAvatar: false });
          return;
        }
        this.setData({ nicknameFocus: true });
      },
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

  onAvatarTap() {
    this.syncWechatAvatarFirst();
  },

  async syncWechatAvatarFirst() {
    const result = await this.syncWechatProfile({
      withNickname: false,
      withAvatar: true,
    });

    if (result === 'success' || result === 'throttled') {
      return;
    }

    wx.showActionSheet({
      itemList: ['自定义头像'],
      success: () => {
        this.chooseCustomAvatar();
      },
    });
  },

  chooseCustomAvatar() {
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

  async syncWechatProfile(
    options: { withNickname: boolean; withAvatar: boolean },
  ): Promise<'success' | 'cancel' | 'throttled' | 'unsupported' | 'failed' | 'empty'> {
    if (!wx.getUserProfile) {
      wx.showToast({ title: '当前微信版本暂不支持', icon: 'none' });
      return 'unsupported';
    }

    if (this.data.wechatProfileLoading) {
      return 'throttled';
    }

    const now = Date.now();
    if (now - lastWxProfileInvokeAt < WX_PROFILE_MIN_INTERVAL_MS) {
      wx.showToast({ title: '操作太频繁，请稍后再试', icon: 'none' });
      return 'throttled';
    }

    lastWxProfileInvokeAt = now;
    this.setData({ wechatProfileLoading: true });

    try {
      const result = await new Promise<WechatMiniprogram.GetUserProfileSuccessCallbackResult>((resolve, reject) => {
        wx.getUserProfile({
          desc: '用于完善个人资料',
          success: resolve,
          fail: reject,
        });
      });
      const profile = result.userInfo;

      const patch: Record<string, string> = {};
      if (options.withNickname && profile.nickName) {
        patch['userInfo.nickname'] = profile.nickName;
      }
      if (options.withAvatar && profile.avatarUrl) {
        patch['userInfo.avatar'] = profile.avatarUrl;
      }

      if (!patch['userInfo.nickname'] && !patch['userInfo.avatar']) {
        wx.showToast({ title: '未获取到可用资料', icon: 'none' });
        return 'empty';
      }

      this.setData(patch);
      wx.showToast({ title: '已同步微信资料', icon: 'success' });
      return 'success';
    } catch (err: any) {
      if (String(err?.errMsg || '').includes('cancel')) {
        return 'cancel';
      }
      wx.showToast({ title: '获取微信资料失败', icon: 'none' });
      return 'failed';
    } finally {
      this.setData({ wechatProfileLoading: false });
    }
  },

  stopTap() {
    // 阻止冒泡，避免触发外层点击逻辑
  },

  async handleSave() {
    if (this.data.saving) {
      return;
    }

    const nickname = String(this.data.userInfo.nickname || '').trim();
    if (!nickname) {
      wx.showToast({ title: '昵称不能为空', icon: 'none' });
      this.setData({ nicknameFocus: true });
      return;
    }

    this.setData({ saving: true });
    wx.showLoading({ title: '保存中...' });
    try {
      await request({
        url: '/user/profile',
        method: 'PUT',
        data: {
          nickname,
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
    } finally {
      this.setData({ saving: false });
    }
  }
});
