import { clearGuestIdentity, getAccessToken, getGuestProfile } from '../../utils/identity';
import { request, RequestError } from '../../utils/request';

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
const SHARE_PROMO_IMAGE = '/assets/images/share-promo.jpg';

Page({
  data: {
    userInfo: null as ProfileInfo | null,
    isGuest: false,
    showLoginCard: false,
  },

  onLoad() {
    this.enableShareMenus();
  },

  onShow() {
    this.fetchUserInfo();
  },

  enableShareMenus() {
    wx.showShareMenu({
      withShareTicket: true,
      menus: ['shareAppMessage', 'shareTimeline'],
    });
  },

  async fetchUserInfo() {
    if (getAccessToken()) {
      try {
        const userInfo = await request<ProfileInfo>({
          url: '/user/profile',
        });
        wx.setStorageSync('userInfo', userInfo);
        const app = getApp<IAppOption>();
        app.globalData.userInfo = {
          id: userInfo.id,
          nickname: userInfo.nickname,
          avatar: userInfo.avatar,
          gender: userInfo.gender,
          title: userInfo.title,
          totalGames: userInfo.totalGames,
          wins: userInfo.wins,
        };
        this.setData({ userInfo, isGuest: false, showLoginCard: false });
        return;
      } catch (err) {
        const requestError = err as RequestError;
        console.error('获取用户信息失败', err);

        if (requestError.statusCode === 401) {
          wx.removeStorageSync('token');
          wx.removeStorageSync('userInfo');
          const app = getApp<IAppOption>();
          app.globalData.token = '';
          app.globalData.userInfo = null;
        } else {
          const cachedLoginProfile = this.getCachedLoginProfile();
          if (cachedLoginProfile) {
            this.setData({
              userInfo: cachedLoginProfile,
              isGuest: false,
              showLoginCard: false,
            });
            return;
          }
        }
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
        showLoginCard: false,
      });
      return;
    }

    this.setData({
      userInfo: null,
      isGuest: false,
      showLoginCard: true,
    });
  },

  goToLogin() {
    wx.navigateTo({ url: '/subpkg/login/login' });
  },

  getCachedLoginProfile(): ProfileInfo | null {
    const app = getApp<IAppOption>();
    const fromGlobal = app.globalData.userInfo;
    const fromStorage = wx.getStorageSync('userInfo') as AppUserInfo | undefined;
    const source = fromGlobal || fromStorage;
    if (!source || !source.id) {
      return null;
    }

    const winRateValue = source.totalGames > 0
      ? `${Math.round((source.wins / source.totalGames) * 100)}%`
      : '0%';

    return {
      id: source.id,
      nickname: source.nickname || `玩家${source.id}`,
      avatar: source.avatar || '',
      gender: source.gender || 0,
      title: source.title || '小财神',
      totalGames: source.totalGames || 0,
      wins: source.wins || 0,
      winRate: winRateValue,
    };
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
        wx.removeStorageSync('userInfo');
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

  onShareAppMessage() {
    return {
      title: '欢乐记分馆',
      path: '/pages/home/home',
      imageUrl: SHARE_PROMO_IMAGE,
    };
  },

  onShareTimeline() {
    return {
      title: '欢乐记分馆',
      query: '',
      imageUrl: SHARE_PROMO_IMAGE,
    };
  },
});
