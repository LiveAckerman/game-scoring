import { fontSizeBehavior } from '../../behaviors/font-size';
import { getVersionPageState } from '../../utils/version';

Page({
  behaviors: [fontSizeBehavior],
  data: {
    currentVersion: '',
    envVersionLabel: '',
    history: [],
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
      history: versionState.history,
    });
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
