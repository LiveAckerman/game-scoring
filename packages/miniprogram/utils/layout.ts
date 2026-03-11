const DEFAULT_WINDOW_WIDTH = 375;
const COMPACT_WINDOW_WIDTH = 375;
const LARGE_FONT_COMPACT_WINDOW_WIDTH = 430;

function getWindowWidth(): number {
  try {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    return info.windowWidth || info.screenWidth || DEFAULT_WINDOW_WIDTH;
  } catch (error) {
    return DEFAULT_WINDOW_WIDTH;
  }
}

export function shouldUseCompactLayout(): boolean {
  const fontSizeLevel = wx.getStorageSync('fontSizeLevel') || 'medium';
  const windowWidth = getWindowWidth();

  return (
    windowWidth <= COMPACT_WINDOW_WIDTH ||
    (fontSizeLevel === 'large' && windowWidth <= LARGE_FONT_COMPACT_WINDOW_WIDTH)
  );
}
