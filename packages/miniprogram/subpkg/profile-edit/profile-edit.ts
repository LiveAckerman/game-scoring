import { request } from '../../utils/request';
import { uploadFile } from '../../utils/upload';
import { fontSizeBehavior } from '../../behaviors/font-size';
import { saveUserInfo } from '../../utils/profile';

interface EditableUserInfo {
  id?: number;
  nickname: string;
  avatar: string;
  profileSetupCompleted: boolean;
  gender: number;
  title: string;
}

interface ProfileResponse extends EditableUserInfo {
  totalGames?: number;
  wins?: number;
}

Page({
  behaviors: [fontSizeBehavior],
  data: {
    saving: false,
    nicknameFocus: false,
    avatarTempPath: '',
    isOnboarding: false,
    topBarTitle: '编辑资料',
    submitText: '保存修改',
    userInfo: {
      nickname: '',
      avatar: '',
      profileSetupCompleted: false,
      gender: 0,
      title: '小财神',
    } as EditableUserInfo,
  },

  onShow() {
    (this as any)._applyFontSize();
  },

  onLoad(options: Record<string, string | undefined>) {
    const isOnboarding = String(options.mode || '').trim() === 'onboarding';
    this.setData({
      isOnboarding,
      topBarTitle: isOnboarding ? '完善资料' : '编辑资料',
      submitText: isOnboarding ? '完成设置，开始记分' : '保存修改',
    });
    this.fetchUserInfo();
  },

  goBack() {
    if (this.data.isOnboarding) {
      return;
    }
    wx.navigateBack();
  },

  async fetchUserInfo() {
    try {
      const userInfo = await request<ProfileResponse>({ url: '/user/profile' });
      this.setData({
        userInfo: this.normalizeUserInfo(userInfo),
      });
    } catch (err) {
      console.error('获取用户信息失败', err);
      wx.showToast({ title: '获取资料失败', icon: 'none' });
    }
  },

  normalizeUserInfo(userInfo: Partial<ProfileResponse>): EditableUserInfo {
    return {
      id: userInfo.id,
      nickname: String(userInfo.nickname || ''),
      avatar: String(userInfo.avatar || ''),
      profileSetupCompleted: Boolean(userInfo.profileSetupCompleted),
      gender: Number(userInfo.gender || 0),
      title: String(userInfo.title || '小财神'),
    };
  },

  onChooseAvatar(e: WechatMiniprogram.CustomEvent<{ avatarUrl?: string }>) {
    const { avatarUrl } = e.detail || {};
    if (!avatarUrl) {
      wx.showToast({ title: '未获取到头像', icon: 'none' });
      return;
    }
    this.setData({ avatarTempPath: avatarUrl });
  },

  onNicknameInput(e: WechatMiniprogram.CustomEvent<{ value?: string }>) {
    this.setData({ 'userInfo.nickname': String(e.detail.value || '').slice(0, 64) });
  },

  onNicknameFocus() {
    this.setData({ nicknameFocus: true });
  },

  onNicknameBlur(e: WechatMiniprogram.CustomEvent<{ value?: string }>) {
    this.setData({
      nicknameFocus: false,
      'userInfo.nickname': String(e.detail.value || '').trim().slice(0, 64),
    });
  },

  focusNickname() {
    this.setData({ nicknameFocus: true });
  },

  setGender(e: WechatMiniprogram.BaseEvent) {
    const gender = Number(e.currentTarget.dataset.val || 0);
    this.setData({ 'userInfo.gender': gender });
  },

  setTitle(e: WechatMiniprogram.BaseEvent) {
    const title = String(e.currentTarget.dataset.val || '');
    if (title === '小财神') {
      this.setData({ 'userInfo.title': title });
      return;
    }

    wx.showToast({ title: '称号尚未解锁', icon: 'none' });
  },

  async handleSave() {
    if (this.data.saving) {
      return;
    }

    const nickname = String(this.data.userInfo.nickname || '').trim();
    if (!nickname) {
      wx.showToast({ title: '请先设置昵称', icon: 'none' });
      this.setData({ nicknameFocus: true });
      return;
    }

    const currentAvatar = String(this.data.avatarTempPath || this.data.userInfo.avatar || '').trim();
    if (!currentAvatar) {
      wx.showToast({ title: '请先授权头像', icon: 'none' });
      return;
    }

    this.setData({ saving: true });
    wx.showLoading({ title: this.data.isOnboarding ? '完成设置中...' : '保存中...' });

    try {
      let avatarUrl = this.data.userInfo.avatar;

      if (this.data.avatarTempPath) {
        const uploadRes = await uploadFile({
          url: '/user/avatar',
          filePath: this.data.avatarTempPath,
          name: 'file',
        });
        const parsed = JSON.parse(uploadRes.data || '{}') as { url?: string; avatar?: string };
        avatarUrl = parsed.url || parsed.avatar || avatarUrl;
      }

      const updatedProfile = await request<ProfileResponse>({
        url: '/user/profile',
        method: 'PUT',
        data: {
          nickname,
          avatar: avatarUrl,
          gender: this.data.userInfo.gender,
          title: this.data.userInfo.title,
        },
      });

      const normalizedProfile = this.normalizeUserInfo(updatedProfile);
      this.setData({
        avatarTempPath: '',
        userInfo: normalizedProfile,
      });

      saveUserInfo({
        id: Number(updatedProfile.id || normalizedProfile.id || 0),
        nickname: normalizedProfile.nickname,
        avatar: normalizedProfile.avatar,
        profileSetupCompleted: normalizedProfile.profileSetupCompleted,
        gender: normalizedProfile.gender,
        title: normalizedProfile.title,
        totalGames: Number(updatedProfile.totalGames || 0),
        wins: Number(updatedProfile.wins || 0),
      });

      wx.hideLoading();
      wx.showToast({
        title: this.data.isOnboarding ? '资料已就位' : '保存成功',
        icon: 'success',
      });

      setTimeout(() => {
        if (this.data.isOnboarding) {
          wx.switchTab({ url: '/pages/home/home' });
          return;
        }
        wx.navigateBack();
      }, 500);
    } catch (err) {
      wx.hideLoading();
      console.error('保存失败', err);
      wx.showToast({ title: '保存失败，请重试', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },
});
