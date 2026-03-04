import { clearGuestIdentity, getAccessToken, getGuestProfile } from '../../utils/identity';
import { request } from '../../utils/request';

interface ProfileInfo {
  id: number;
  nickname: string;
  avatar: string;
  gender: number;
  title: string;
  totalGames: number;
  wins: number;
  winRate: string;
}

Page({
  data: {
    userInfo: null as ProfileInfo | null,
    isGuest: false,
  },

  onShow() {
    this.fetchUserInfo();
  },

  async fetchUserInfo() {
    if (getAccessToken()) {
      try {
        const userInfo = await request<ProfileInfo>({
          url: '/user/profile',
        });
        this.setData({ userInfo, isGuest: false });
        return;
      } catch (err) {
        console.error('获取用户信息失败', err);
      }
    }

    const guest = getGuestProfile();
    if (guest) {
      this.setData({
        userInfo: {
          id: guest.id,
          nickname: guest.nickname,
          avatar: '',
          gender: 0,
          title: '游客玩家',
          totalGames: 0,
          wins: 0,
          winRate: '--',
        },
        isGuest: true,
      });
      return;
    }

    this.setData({
      userInfo: null,
      isGuest: false,
    });
  },

  goToEdit() {
    if (!getAccessToken()) {
      wx.showToast({ title: '游客模式暂不支持编辑资料', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/subpkg/profile-edit/profile-edit' });
  },

  handleLogout() {
    const hasToken = !!getAccessToken();
    const hasGuest = !!getGuestProfile();

    if (!hasToken && !hasGuest) {
      wx.showToast({ title: '当前没有可退出的账号', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '提示',
      content: hasToken ? '确定退出登录吗？' : '确定退出游客身份吗？',
      success: (res: WechatMiniprogram.ShowModalSuccessCallbackResult) => {
        if (!res.confirm) {
          return;
        }

        wx.removeStorageSync('token');
        clearGuestIdentity();

        const app = getApp<IAppOption>();
        app.globalData.token = '';
        app.globalData.userInfo = null;
        app.globalData.guestProfile = null;

        wx.showToast({ title: '已退出', icon: 'success' });
        this.fetchUserInfo();
      },
    });
  },
});
