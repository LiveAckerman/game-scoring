import { clearGuestIdentity, getAccessToken, getGuestProfile } from '../../utils/identity';
import { request, RequestError } from '../../utils/request';
import { fontSizeBehavior, buildStyle } from '../../behaviors/font-size';

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
const SHARE_PROMO_IMAGE = '/assets/stitch/avatars/avatar-main.png';
const FONT_LABELS: Record<string, string> = { small: '小', medium: '中（默认）', large: '大' };

Page({
  behaviors: [fontSizeBehavior],
  data: {
    userInfo: null as ProfileInfo | null,
    isGuest: false,
    showLoginCard: false,
    showQrPopup: false,
    fontLabel: '中（默认）',
  },

  onLoad() {
    this.enableShareMenus();
    this.initFontLevel();
  },

  onShow() {
    (this as any)._applyFontSize();
    this.fetchUserInfo();
  },

  initFontLevel() {
    const level = wx.getStorageSync('fontSizeLevel') || 'medium';
    this.setData({ fontLabel: FONT_LABELS[level] || '中（默认）' });
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

  // ---- 字体设置 ----
  showFontSettings() {
    const app = getApp<IAppOption>();
    const current = app.globalData.fontSizeLevel || 'medium';
    const levels = ['small', 'medium', 'large'] as const;
    const labels = levels.map(l => FONT_LABELS[l] + (l === current ? ' ✓' : ''));

    wx.showActionSheet({
      itemList: labels,
      success: (res) => {
        const selected = levels[res.tapIndex];
        app.globalData.fontSizeLevel = selected;
        wx.setStorageSync('fontSizeLevel', selected);
        this.setData({
          fontLabel: FONT_LABELS[selected],
          pageFontStyle: buildStyle(selected),
        });
        wx.showToast({ title: `已切换为${FONT_LABELS[selected]}字体`, icon: 'none' });
      },
    });
  },

  // ---- 物料码弹窗 ----
  showQrCode() {
    this.setData({ showQrPopup: true });
  },

  hideQrCode() {
    this.setData({ showQrPopup: false });
  },

  // ---- 战绩榜 ----
  goToLeaderboard() {
    wx.navigateTo({ url: '/subpkg/leaderboard/leaderboard' });
  },

  // ---- 我的战绩 ----
  goToMyRecords() {
    wx.switchTab({ url: '/pages/records/records' });
  },

  goToTagSettings() {
    wx.navigateTo({ url: '/subpkg/tag-settings/tag-settings' });
  },

  // ---- 数据恢复（游客 → 微信账号） ----
  async handleDataRestore() {
    if (!getAccessToken()) {
      wx.showToast({ title: '请先登录微信账号再恢复数据', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '检测中...' });
    try {
      const res = await request<{ hasData: boolean; guestGames: number }>({
        url: '/user/check-guest-data',
      });
      wx.hideLoading();
      if (!res.hasData) {
        wx.showToast({ title: '未检测到可恢复的游客数据', icon: 'none' });
        return;
      }
      wx.showModal({
        title: '发现游客数据',
        content: `检测到 ${res.guestGames} 场游客对局数据，是否导入到当前账号？`,
        success: async (modalRes) => {
          if (!modalRes.confirm) return;
          wx.showLoading({ title: '导入中...' });
          try {
            const restoreRes = await request<{ migrated: number }>({
              url: '/user/restore-guest-data',
              method: 'POST',
            });
            wx.hideLoading();
            if (!restoreRes.migrated) {
              wx.showToast({ title: '未找到可导入的数据', icon: 'none' });
              return;
            }
            clearGuestIdentity();
            const app = getApp<IAppOption>();
            app.globalData.guestProfile = null;
            wx.showToast({ title: '数据恢复成功', icon: 'success' });
            this.fetchUserInfo();
          } catch (err) {
            wx.hideLoading();
            wx.showToast({ title: '数据恢复失败', icon: 'none' });
          }
        },
      });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '检测失败', icon: 'none' });
    }
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
