import { getAccessToken, getGuestToken } from '../../utils/identity';
import { RequestError } from '../../utils/request';
import { getRoomHistory, RoomHistoryItem, RoomHistorySummary } from '../../utils/room';

interface RecordMemberView {
  id: number;
  nickname: string;
  avatar: string;
  avatarInitials: string;
  score: number;
  isOwner: boolean;
}

interface RecordCardView {
  roomId: number;
  roomCode: string;
  status: 'IN_PROGRESS' | 'ENDED';
  statusText: string;
  statusClass: 'active' | 'ended';
  startText: string;
  durationText: string;
  members: RecordMemberView[];
  myScoreText: string;
  scoreRecordCount: number;
}

const EMPTY_SUMMARY: RoomHistorySummary = {
  totalGames: 0,
  winRounds: 0,
  loseRounds: 0,
  drawRounds: 0,
  totalWinPoints: 0,
  totalLosePoints: 0,
  totalScore: 0,
};

Page({
  data: {
    activeTab: 'all' as 'all' | 'ongoing' | 'finished',
    loading: false,
    summary: EMPTY_SUMMARY,
    totalRecords: 0,
    records: [] as RecordCardView[],
  },

  onShow() {
    this.loadRecords();
  },

  onPullDownRefresh() {
    this.loadRecords(true);
  },

  switchTab(e: WechatMiniprogram.BaseEvent) {
    const id = String(e.currentTarget.dataset.id || 'all') as 'all' | 'ongoing' | 'finished';
    if (id === this.data.activeTab) {
      return;
    }

    this.setData({
      activeTab: id,
    });

    this.loadRecords();
  },

  async loadRecords(silent = false) {
    if (!getAccessToken() && !getGuestToken()) {
      this.setData({
        summary: EMPTY_SUMMARY,
        totalRecords: 0,
        records: [],
      });
      wx.stopPullDownRefresh();
      return;
    }

    if (!silent) {
      this.setData({ loading: true });
    }

    try {
      const payload = await getRoomHistory({
        page: 1,
        pageSize: 50,
        status: this.getApiStatus(),
      });

      const records = payload.items.map((item) => this.mapToRecordCard(item));

      this.setData({
        summary: payload.summary,
        totalRecords: payload.pagination.total,
        records,
      });
    } catch (error) {
      const requestError = error as RequestError;
      if (requestError.statusCode !== 401) {
        wx.showToast({
          title: requestError.message || '加载记录失败',
          icon: 'none',
        });
      }
      this.setData({
        summary: EMPTY_SUMMARY,
        totalRecords: 0,
        records: [],
      });
    } finally {
      this.setData({ loading: false });
      wx.stopPullDownRefresh();
    }
  },

  openRoomFromRecord(e: WechatMiniprogram.BaseEvent) {
    const roomCode = String(e.currentTarget.dataset.roomCode || '');

    if (!roomCode) {
      return;
    }

    wx.navigateTo({
      url: `/subpkg/multi-invite/multi-invite?roomCode=${roomCode}`,
    });
  },

  getApiStatus(): 'ALL' | 'IN_PROGRESS' | 'ENDED' {
    if (this.data.activeTab === 'ongoing') {
      return 'IN_PROGRESS';
    }

    if (this.data.activeTab === 'finished') {
      return 'ENDED';
    }

    return 'ALL';
  },

  mapToRecordCard(item: RoomHistoryItem): RecordCardView {
    const date = new Date(item.startedAt);
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hour = date.getHours();
    const minute = date.getMinutes();

    return {
      roomId: item.roomId,
      roomCode: item.roomCode,
      status: item.status,
      statusText: item.status === 'IN_PROGRESS' ? '进行中' : '已结束',
      statusClass: item.status === 'IN_PROGRESS' ? 'active' : 'ended',
      startText: `${month}-${day} ${this.pad2(hour)}:${this.pad2(minute)} 开始`,
      durationText: item.status === 'IN_PROGRESS'
        ? `已进行${item.durationMinutes}分钟`
        : `总时长${item.durationMinutes}分钟`,
      members: item.members,
      myScoreText: `${item.myScore > 0 ? '+' : ''}${item.myScore}`,
      scoreRecordCount: item.scoreRecordCount,
    };
  },

  pad2(value: number): string {
    if (value < 10) {
      return `0${value}`;
    }
    return `${value}`;
  },
});
