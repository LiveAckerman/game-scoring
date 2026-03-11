import { fontSizeBehavior } from '../../behaviors/font-size';
import { fetchVersionInfo, getVersionPageState } from '../../utils/version';

Page({
  behaviors: [fontSizeBehavior],
  data: {
    currentVersion: '',
    envVersionLabel: '',
    latestVersion: '',
    history: [],
    isLoading: false,
    loadError: false,
  },

  onLoad() {
    this.refreshVersionInfo();
  },

  onShow() {
    (this as any)._applyFontSize();
    this.refreshVersionInfo();
  },

  refreshVersionInfo() {
    const versionState = getVersionPageState();
    this.setData({
      currentVersion: versionState.currentVersion,
      envVersionLabel: versionState.envVersionLabel,
      latestVersion: versionState.latestVersion,
      history: versionState.history,
    });
  },

  onReady() {
    this.loadRemoteVersionInfo();
  },

  async loadRemoteVersionInfo() {
    this.setData({ isLoading: true, loadError: false });
    try {
      const versionInfo = await fetchVersionInfo();
      this.setData({
        latestVersion: versionInfo.latestVersion,
        history: versionInfo.history,
      });
    } catch (_error) {
      this.setData({ loadError: true });
      // Keep fallback content if the request fails.
    } finally {
      this.setData({ isLoading: false });
    }
  },

  retryLoad() {
    this.loadRemoteVersionInfo();
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
      return;
    }

    wx.switchTab({ url: '/pages/profile/profile' });
  },
});
