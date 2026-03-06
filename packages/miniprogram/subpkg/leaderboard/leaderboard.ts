import { request } from '../../utils/request';
import { fontSizeBehavior } from '../../behaviors/font-size';

interface RankItem {
  id: string;
  actorType: string;
  userId: number;
  nickname: string;
  avatar: string;
  totalGames: number;
  wins: number;
  winRate: string;
}

Page({
  behaviors: [fontSizeBehavior],
  data: {
    rankList: [] as RankItem[],
    activeTab: 0,
    loading: true,
  },

  onShow() {
    (this as any)._applyFontSize();
  },

  onLoad() {
    this.fetchRank();
  },

  onBack() {
    wx.navigateBack();
  },

  switchTab(e: any) {
    const tab = parseInt(e.currentTarget.dataset.tab);
    this.setData({ activeTab: tab });
    this.fetchRank();
  },

  async fetchRank() {
    this.setData({ loading: true });
    const sortMap = ['score', 'winRate', 'games'];
    try {
      const rankList = await request<RankItem[]>({
        url: `/user/leaderboard?sort=${sortMap[this.data.activeTab]}`,
      });
      this.setData({ rankList, loading: false });
    } catch (err) {
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },
});
