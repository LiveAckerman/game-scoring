const DEFAULT_STATUS_BAR_HEIGHT = 20;
let cachedStatusBarHeight = DEFAULT_STATUS_BAR_HEIGHT;

const resolveStatusBarHeight = (): number => {
  try {
    const app = getApp<IAppOption>();
    if (app.globalData.statusBarHeight && app.globalData.statusBarHeight > 0) {
      cachedStatusBarHeight = app.globalData.statusBarHeight;
      return cachedStatusBarHeight;
    }

    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    cachedStatusBarHeight = info.statusBarHeight || DEFAULT_STATUS_BAR_HEIGHT;
    app.globalData.statusBarHeight = cachedStatusBarHeight;
    return cachedStatusBarHeight;
  } catch (_error) {
    return cachedStatusBarHeight;
  }
};

Component({
  properties: {
    title: {
      type: String,
      value: ''
    },
    bgColor: {
      type: String,
      value: '#E63946'
    },
    textColor: {
      type: String,
      value: '#FFFFFF'
    },
    showBack: {
      type: Boolean,
      value: true
    }
  },
  data: {
    statusBarHeight: DEFAULT_STATUS_BAR_HEIGHT
  },
  lifetimes: {
    attached() {
      const statusBarHeight = resolveStatusBarHeight();
      if (this.data.statusBarHeight !== statusBarHeight) {
        this.setData({ statusBarHeight });
      }
    }
  },
  methods: {
    onBackTap() {
      this.triggerEvent('back');
    }
  }
});
