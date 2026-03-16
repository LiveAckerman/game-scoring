import { clearGuestIdentity, getAccessToken, getGuestProfile } from '../../utils/identity';
import { request, RequestError } from '../../utils/request';
import { getVersionSummary } from '../../utils/version';
import { fontSizeBehavior, buildStyle } from '../../behaviors/font-size';
import { relaunchProfileSetup, shouldForceProfileSetup } from '../../utils/profile';

type ProfileStatsScope = 'ALL' | 'YEAR' | 'MONTH';

interface ProfileStatsMonthOption {
  key?: string;
  year: number;
  month: number;
  label: string;
}

interface ProfileStatsFilter {
  scope: ProfileStatsScope;
  year: number | null;
  month: number | null;
  label: string;
  availableYears: number[];
  availableMonths: ProfileStatsMonthOption[];
}

interface ProfileInfo {
  id: number;
  nickname: string;
  avatar: string;
  profileSetupCompleted: boolean;
  gender: number;
  title: string;
  totalGames: number;
  wins: number;
  winRate: string;
  statsFilter: ProfileStatsFilter;
}

const SHARE_PROMO_IMAGE = '/assets/images/share-promo.jpg';
const FONT_LABELS: Record<string, string> = { small: '小', medium: '中（默认）', large: '大' };
const DEFAULT_STATS_FILTER: ProfileStatsFilter = {
  scope: 'ALL',
  year: null,
  month: null,
  label: '全部数据',
  availableYears: [],
  availableMonths: [],
};

const buildDefaultStatsFilter = (): ProfileStatsFilter => ({
  scope: DEFAULT_STATS_FILTER.scope,
  year: DEFAULT_STATS_FILTER.year,
  month: DEFAULT_STATS_FILTER.month,
  label: DEFAULT_STATS_FILTER.label,
  availableYears: [],
  availableMonths: [],
});

Page({
  behaviors: [fontSizeBehavior],
  data: {
    userInfo: null as ProfileInfo | null,
    isGuest: false,
    showLoginCard: false,
    showQrPopup: false,
    fontLabel: '中（默认）',
    versionSummary: '',
    showStatsFilterDialog: false,
    statsFilterDraftScope: 'ALL' as ProfileStatsScope,
    statsFilterDraftYear: null as number | null,
    statsFilterDraftMonthKey: '',
  },

  onLoad() {
    this.enableShareMenus();
    this.initFontLevel();
    this.initVersionSummary();
  },

  onShow() {
    (this as any)._applyFontSize();
    if (shouldForceProfileSetup()) {
      relaunchProfileSetup();
      return;
    }
    this.fetchUserInfo();
  },

  initFontLevel() {
    const app = getApp<IAppOption>();
    const level = app.globalData.fontSizeLevel || 'medium';
    this.setData({ fontLabel: FONT_LABELS[level] || '中（默认）' });
  },

  initVersionSummary() {
    this.setData({ versionSummary: getVersionSummary() });
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
          url: this.buildProfileRequestUrl(),
        });
        const normalizedProfile = this.normalizeProfileInfo(userInfo);
        this.persistProfileCache(normalizedProfile);
        this.setData({
          userInfo: normalizedProfile,
          isGuest: false,
          showLoginCard: false,
        });
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
              showStatsFilterDialog: false,
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
          profileSetupCompleted: true,
          gender: 0,
          title: '游客玩家',
          totalGames: 0,
          wins: 0,
          winRate: '--',
          statsFilter: buildDefaultStatsFilter(),
        },
        isGuest: true,
        showLoginCard: false,
        showStatsFilterDialog: false,
      });
      return;
    }

    this.setData({
      userInfo: null,
      isGuest: false,
      showLoginCard: true,
      showStatsFilterDialog: false,
    });
  },

  buildProfileRequestUrl() {
    const currentFilter = this.data.userInfo?.statsFilter || buildDefaultStatsFilter();
    const scope = currentFilter.scope || 'ALL';

    if (scope === 'YEAR' && currentFilter.year) {
      return `/user/profile?scope=YEAR&year=${currentFilter.year}`;
    }

    if (scope === 'MONTH' && currentFilter.year && currentFilter.month) {
      return `/user/profile?scope=MONTH&year=${currentFilter.year}&month=${currentFilter.month}`;
    }

    return '/user/profile';
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
      profileSetupCompleted: Boolean(source.profileSetupCompleted),
      gender: source.gender || 0,
      title: source.title || '小财神',
      totalGames: source.totalGames || 0,
      wins: source.wins || 0,
      winRate: winRateValue,
      statsFilter: buildDefaultStatsFilter(),
    };
  },

  normalizeProfileInfo(profile: ProfileInfo): ProfileInfo {
    return {
      ...profile,
      statsFilter: {
        ...buildDefaultStatsFilter(),
        ...(profile.statsFilter || {}),
        availableYears: Array.isArray(profile.statsFilter?.availableYears)
          ? [...profile.statsFilter.availableYears]
          : [],
        availableMonths: Array.isArray(profile.statsFilter?.availableMonths)
          ? profile.statsFilter.availableMonths.map((item) => ({
            key: `${Number(item.year)}-${String(Number(item.month)).padStart(2, '0')}`,
            year: Number(item.year),
            month: Number(item.month),
            label: item.label || `${item.year}年${String(item.month).padStart(2, '0')}月`,
          }))
          : [],
      },
    };
  },

  persistProfileCache(profile: ProfileInfo) {
    const app = getApp<IAppOption>();
    if (profile.statsFilter.scope !== 'ALL') {
      return;
    }

    wx.setStorageSync('userInfo', profile);
    app.globalData.userInfo = {
      id: profile.id,
      nickname: profile.nickname,
      avatar: profile.avatar,
      profileSetupCompleted: profile.profileSetupCompleted,
      gender: profile.gender,
      title: profile.title,
      totalGames: profile.totalGames,
      wins: profile.wins,
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
      success: (res: WechatMiniprogram.ShowActionSheetSuccessCallbackResult) => {
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

  openStatsFilterDialog() {
    if (!getAccessToken() || !this.data.userInfo) {
      wx.showToast({ title: '登录后可按时间筛选统计', icon: 'none' });
      return;
    }

    const currentFilter = this.data.userInfo.statsFilter || buildDefaultStatsFilter();
    this.setData({
      showStatsFilterDialog: true,
      statsFilterDraftScope: currentFilter.scope || 'ALL',
      statsFilterDraftYear: currentFilter.year,
      statsFilterDraftMonthKey: currentFilter.year && currentFilter.month
        ? `${currentFilter.year}-${String(currentFilter.month).padStart(2, '0')}`
        : '',
    });
  },

  closeStatsFilterDialog() {
    this.setData({ showStatsFilterDialog: false });
  },

  selectStatsFilterScope(e: WechatMiniprogram.CustomEvent) {
    const scope = String(e.currentTarget.dataset.scope || 'ALL') as ProfileStatsScope;
    const currentFilter = this.data.userInfo?.statsFilter || buildDefaultStatsFilter();

    if (scope === 'ALL') {
      this.setData({
        statsFilterDraftScope: 'ALL',
        statsFilterDraftYear: null,
        statsFilterDraftMonthKey: '',
      });
      return;
    }

    if (scope === 'YEAR') {
      const nextYear = this.data.statsFilterDraftYear
        || currentFilter.year
        || currentFilter.availableYears[0]
        || null;
      this.setData({
        statsFilterDraftScope: 'YEAR',
        statsFilterDraftYear: nextYear,
        statsFilterDraftMonthKey: '',
      });
      return;
    }

    const fallbackMonth = currentFilter.availableMonths[0];
    const nextMonthKey = this.data.statsFilterDraftMonthKey
      || (currentFilter.year && currentFilter.month
        ? `${currentFilter.year}-${String(currentFilter.month).padStart(2, '0')}`
        : fallbackMonth
          ? `${fallbackMonth.year}-${String(fallbackMonth.month).padStart(2, '0')}`
          : '');

    this.setData({
      statsFilterDraftScope: 'MONTH',
      statsFilterDraftYear: this.data.statsFilterDraftYear || currentFilter.year || fallbackMonth?.year || null,
      statsFilterDraftMonthKey: nextMonthKey,
    });
  },

  selectStatsFilterYear(e: WechatMiniprogram.CustomEvent) {
    const year = Number(e.currentTarget.dataset.year || 0) || null;
    this.setData({ statsFilterDraftYear: year });
  },

  selectStatsFilterMonth(e: WechatMiniprogram.CustomEvent) {
    const monthKey = String(e.currentTarget.dataset.monthKey || '');
    if (!monthKey) {
      return;
    }
    this.setData({ statsFilterDraftMonthKey: monthKey });
  },

  async applyStatsFilter() {
    if (!this.data.userInfo) {
      return;
    }

    const currentFilter = this.data.userInfo.statsFilter || buildDefaultStatsFilter();
    const nextScope = this.data.statsFilterDraftScope || 'ALL';
    let nextYear: number | null = null;
    let nextMonth: number | null = null;

    if (nextScope === 'YEAR') {
      nextYear = this.data.statsFilterDraftYear;
      if (!nextYear) {
        wx.showToast({ title: '请选择统计年份', icon: 'none' });
        return;
      }
    }

    if (nextScope === 'MONTH') {
      const monthOption = currentFilter.availableMonths.find(
        (item: ProfileStatsMonthOption) => item.key === this.data.statsFilterDraftMonthKey,
      );
      if (!monthOption) {
        wx.showToast({ title: '请选择统计月份', icon: 'none' });
        return;
      }
      nextYear = monthOption.year;
      nextMonth = monthOption.month;
    }

    this.setData({
      showStatsFilterDialog: false,
      userInfo: {
        ...this.data.userInfo,
        statsFilter: {
          ...currentFilter,
          scope: nextScope,
          year: nextYear,
          month: nextMonth,
          label: this.buildStatsFilterLabel(nextScope, nextYear, nextMonth),
        },
      },
    });

    await this.fetchUserInfo();
  },

  buildStatsFilterLabel(scope: ProfileStatsScope, year: number | null, month: number | null) {
    if (scope === 'YEAR' && year) {
      return `${year}年`;
    }

    if (scope === 'MONTH' && year && month) {
      return `${year}年${String(month).padStart(2, '0')}月`;
    }

    return '全部数据';
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

  goToSupport() {
    wx.navigateTo({ url: '/subpkg/support/support' });
  },

  goToVersionInfo() {
    wx.navigateTo({ url: '/subpkg/version-info/version-info' });
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
        success: async (modalRes: WechatMiniprogram.ShowModalSuccessCallbackResult) => {
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
        app.globalData.guestToken = '';

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
