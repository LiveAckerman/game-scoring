/**
 * 全局字体大小 Behavior
 * 通过 page-meta page-style 注入 CSS 自定义属性，各页面 WXSS 用 var() 引用即可跟随用户设置。
 *
 * 变量名    用途            小   中(默认)  大
 * --fs-xs   极小文字        18   20       24
 * --fs-sm   辅助/标签       20   24       28
 * --fs-base 正文/菜单项     24   28       34
 * --fs-md   小标题          28   30       36
 * --fs-lg   区块标题        30   34       40
 * --fs-xl   大号数字/姓名   34   38       46
 */

interface FontVarSet {
  xs: number;
  sm: number;
  base: number;
  md: number;
  lg: number;
  xl: number;
}

const LEVELS: Record<string, FontVarSet> = {
  small:  { xs: 18, sm: 20, base: 24, md: 28, lg: 30, xl: 34 },
  medium: { xs: 20, sm: 24, base: 28, md: 30, lg: 34, xl: 38 },
  large:  { xs: 24, sm: 28, base: 34, md: 36, lg: 40, xl: 46 },
};

const resolveFontSizeLevel = (): string => {
  try {
    const app = getApp<IAppOption>();
    const cached = app.globalData.fontSizeLevel;
    if (cached) {
      return cached;
    }

    const stored = String(wx.getStorageSync('fontSizeLevel') || 'medium');
    app.globalData.fontSizeLevel = stored === 'small' || stored === 'large' ? stored : 'medium';
    return app.globalData.fontSizeLevel;
  } catch (_error) {
    const stored = String(wx.getStorageSync('fontSizeLevel') || 'medium');
    return stored === 'small' || stored === 'large' ? stored : 'medium';
  }
};

function buildStyle(level: string): string {
  const v = LEVELS[level] || LEVELS.medium;
  return [
    `font-size:${v.base}rpx`,
    `--fs-xs:${v.xs}rpx`,
    `--fs-sm:${v.sm}rpx`,
    `--fs-base:${v.base}rpx`,
    `--fs-md:${v.md}rpx`,
    `--fs-lg:${v.lg}rpx`,
    `--fs-xl:${v.xl}rpx`,
  ].join(';');
}

export const fontSizeBehavior = Behavior({
  data: {
    pageFontStyle: buildStyle('medium'),
  },
  methods: {
    _applyFontSize() {
      const nextStyle = buildStyle(resolveFontSizeLevel());
      if (this.data.pageFontStyle === nextStyle) {
        return;
      }
      this.setData({ pageFontStyle: nextStyle });
    },
  },
});

export { buildStyle, LEVELS };
