import { fontSizeBehavior } from '../../behaviors/font-size';

interface SupportFaq {
  id: string;
  title: string;
  desc: string;
  expanded?: boolean;
}

Page({
  behaviors: [fontSizeBehavior],
  data: {
    faqs: [
      {
        id: 'multi',
        title: '什么是多人计分桌？',
        desc: '多人计分桌适合多人同时参与的牌局。每位玩家都可以在房间内查看分数变化，按实际对局结果完成记分。',
        expanded: true,
      },
      {
        id: 'single',
        title: '什么是单人计分桌？',
        desc: '单人计分桌适合由一人集中操作的场景，只需要一个人负责录入输赢分数，其他人查看结果即可。',
      },
      {
        id: 'pool',
        title: '什么是分数池桌？',
        desc: '分数池桌同样支持多人记分。在每一圈中，玩家既可以把分数放入分数池，也可以从分数池中取分，一圈内可多次操作。',
      },
      {
        id: 'refresh',
        title: '牌桌数据无法更新怎么办？',
        desc: '建议先点击右上角“...”，再尝试“重新进入小程序”。如果仍无法恢复，请联系人工客服并提供房间号与截图。',
      },
      {
        id: 'spectator',
        title: '什么是旁观状态？',
        desc: '旁观状态表示只能查看房间和分数变化，不能直接操作记分。桌主可以按需要设置或取消玩家的旁观状态。',
      },
      {
        id: 'leaderboard',
        title: '战绩榜统计了哪些数据？',
        desc: '战绩榜只统计你本人参与过的计分数据，不会统计你未参与的好友对局，也不会展示与你无关的房间记录。',
      },
    ] as SupportFaq[],
  },

  onShow() {
    (this as any)._applyFontSize();
  },

  toggleFaq(e: WechatMiniprogram.BaseEvent) {
    const targetId = String(e.currentTarget.dataset.id || '');
    const nextFaqs = this.data.faqs.map((item) => ({
      ...item,
      expanded: item.id === targetId ? !item.expanded : item.expanded,
    }));

    this.setData({ faqs: nextFaqs });
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
