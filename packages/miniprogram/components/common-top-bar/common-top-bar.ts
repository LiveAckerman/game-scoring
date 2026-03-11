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
    statusBarHeight: 20
  },
  lifetimes: {
    attached() {
      let statusBarHeight = 20;
      try {
        const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
        statusBarHeight = info.statusBarHeight || 20;
      } catch (e) {
        statusBarHeight = 20;
      }
      this.setData({ statusBarHeight });
    }
  },
  methods: {
    onBackTap() {
      this.triggerEvent('back');
    }
  }
});
