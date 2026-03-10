import { getAccessToken, getGuestToken } from '../../utils/identity';
import { RequestError } from '../../utils/request';
import { getRoomHistory, RoomHistoryItem, RoomHistorySummary } from '../../utils/room';
import { fontSizeBehavior } from '../../behaviors/font-size';
import {
  buildRoomTagMap,
  getRoomTagIds,
  listRoomTags,
  RoomTag,
  setRoomTagIds,
} from '../../utils/tags';

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
  roomType: 'MULTI' | 'SINGLE' | 'POOL';
  status: 'IN_PROGRESS' | 'ENDED';
  statusText: string;
  statusClass: 'active' | 'ended';
  startText: string;
  durationText: string;
  members: RecordMemberView[];
  myScoreText: string;
  scoreRecordCount: number;
  tags: RoomTag[];
}

interface TagOptionView extends RoomTag {
  selected: boolean;
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
const SHARE_PROMO_IMAGE = '/assets/images/share-promo.jpg';

Page({
  behaviors: [fontSizeBehavior],
  data: {
    activeTab: 'all' as 'all' | 'ongoing' | 'finished',
    loading: false,
    summary: EMPTY_SUMMARY,
    totalRecords: 0,
    rawItems: [] as RoomHistoryItem[],
    records: [] as RecordCardView[],
    availableTags: [] as RoomTag[],
    filterTagOptions: [] as TagOptionView[],
    tagFilterVisible: false,
    selectedFilterTagIds: [] as string[],
    draftFilterTagIds: [] as string[],
    roomTagVisible: false,
    roomTagRoomCode: '',
    roomTagDraftIds: [] as string[],
    roomTagOptions: [] as TagOptionView[],
  },

  onLoad() {
    this.enableShareMenus();
  },

  onShow() {
    (this as any)._applyFontSize();
    this.syncAvailableTags();
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
        rawItems: [],
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
        paginate: false,
        status: this.getApiStatus(),
      });
      this.setData({ rawItems: payload.items });
      this.applyRecordViews(payload.items);
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
        rawItems: [],
        records: [],
      });
    } finally {
      this.setData({ loading: false });
      wx.stopPullDownRefresh();
    }
  },

  openRoomFromRecord(e: WechatMiniprogram.BaseEvent) {
    const roomCode = String(e.currentTarget.dataset.roomCode || '');
    const roomType = String(e.currentTarget.dataset.roomType || 'MULTI');

    if (!roomCode) {
      return;
    }

    const page = roomType === 'SINGLE'
      ? `/subpkg/single-score/single-score?roomCode=${roomCode}`
      : `/subpkg/multi-invite/multi-invite?roomCode=${roomCode}`;

    wx.navigateTo({ url: page });
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

  mapToRecordCard(item: RoomHistoryItem, tags: RoomTag[]): RecordCardView {
    const date = new Date(item.startedAt);
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hour = date.getHours();
    const minute = date.getMinutes();

    return {
      roomId: item.roomId,
      roomCode: item.roomCode,
      roomType: item.roomType || 'MULTI',
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
      tags,
    };
  },

  applyRecordViews(items: RoomHistoryItem[]) {
    const tagMap = buildRoomTagMap(items.map((item) => item.roomCode));
    const filteredItems = this.filterItemsByTags(items, tagMap);
    const records = filteredItems.map((item) => this.mapToRecordCard(item, tagMap[item.roomCode] || []));

    this.setData({
      records,
      totalRecords: filteredItems.length,
      summary: this.buildSummary(filteredItems),
    });
  },

  filterItemsByTags(
    items: RoomHistoryItem[],
    tagMap: Record<string, RoomTag[]>,
  ): RoomHistoryItem[] {
    if (this.data.selectedFilterTagIds.length === 0) {
      return items;
    }

    const selectedSet = new Set(this.data.selectedFilterTagIds);
    return items.filter((item) => {
      const tags = tagMap[item.roomCode] || [];
      return tags.some((tag) => selectedSet.has(tag.id));
    });
  },

  buildSummary(items: RoomHistoryItem[]): RoomHistorySummary {
    return items.reduce<RoomHistorySummary>((summary, item) => {
      const score = item.myScore || 0;
      summary.totalGames += 1;
      summary.totalScore += score;
      if (score > 0) {
        summary.winRounds += 1;
        summary.totalWinPoints += score;
      } else if (score < 0) {
        summary.loseRounds += 1;
        summary.totalLosePoints += score;
      } else {
        summary.drawRounds += 1;
      }
      return summary;
    }, {
      totalGames: 0,
      winRounds: 0,
      loseRounds: 0,
      drawRounds: 0,
      totalWinPoints: 0,
      totalLosePoints: 0,
      totalScore: 0,
    });
  },

  syncAvailableTags() {
    const availableTags = listRoomTags();
    const validIds = new Set(availableTags.map((tag) => tag.id));

    this.setData({
      availableTags,
      selectedFilterTagIds: this.data.selectedFilterTagIds.filter((tagId) => validIds.has(tagId)),
      draftFilterTagIds: this.data.draftFilterTagIds.filter((tagId) => validIds.has(tagId)),
      roomTagDraftIds: this.data.roomTagDraftIds.filter((tagId) => validIds.has(tagId)),
      filterTagOptions: this.buildTagOptions(
        availableTags,
        this.data.draftFilterTagIds.filter((tagId) => validIds.has(tagId)),
      ),
      roomTagOptions: this.buildTagOptions(
        availableTags,
        this.data.roomTagDraftIds.filter((tagId) => validIds.has(tagId)),
      ),
    });
  },

  openTagFilter() {
    this.syncAvailableTags();
    this.setData({
      tagFilterVisible: true,
      draftFilterTagIds: [...this.data.selectedFilterTagIds],
      filterTagOptions: this.buildTagOptions(this.data.availableTags, this.data.selectedFilterTagIds),
    });
  },

  closeTagFilter() {
    this.setData({ tagFilterVisible: false });
  },

  toggleFilterTag(e: WechatMiniprogram.BaseEvent) {
    const tagId = String(e.currentTarget.dataset.tagId || '');
    const selectedSet = new Set(this.data.draftFilterTagIds);
    if (selectedSet.has(tagId)) {
      selectedSet.delete(tagId);
    } else {
      selectedSet.add(tagId);
    }
    const draftFilterTagIds = [...selectedSet];
    this.setData({
      draftFilterTagIds,
      filterTagOptions: this.buildTagOptions(this.data.availableTags, draftFilterTagIds),
    });
  },

  clearTagFilter() {
    this.setData({
      selectedFilterTagIds: [],
      draftFilterTagIds: [],
      tagFilterVisible: false,
      filterTagOptions: this.buildTagOptions(this.data.availableTags, []),
    });
    this.applyRecordViews(this.data.rawItems);
  },

  confirmTagFilter() {
    this.setData({
      selectedFilterTagIds: [...this.data.draftFilterTagIds],
      tagFilterVisible: false,
    });
    this.applyRecordViews(this.data.rawItems);
  },

  openRoomTagDialog(e: WechatMiniprogram.CustomEvent<{ roomCode?: string }>) {
    const roomCode = String(e.detail.roomCode || '');
    if (!roomCode) {
      return;
    }

    this.syncAvailableTags();
    this.setData({
      roomTagVisible: true,
      roomTagRoomCode: roomCode,
      roomTagDraftIds: [...getRoomTagIds(roomCode)],
      roomTagOptions: this.buildTagOptions(this.data.availableTags, getRoomTagIds(roomCode)),
    });
  },

  closeRoomTagDialog() {
    this.setData({
      roomTagVisible: false,
      roomTagRoomCode: '',
      roomTagDraftIds: [],
      roomTagOptions: this.buildTagOptions(this.data.availableTags, []),
    });
  },

  toggleRoomTag(e: WechatMiniprogram.BaseEvent) {
    const tagId = String(e.currentTarget.dataset.tagId || '');
    const selectedSet = new Set(this.data.roomTagDraftIds);
    if (selectedSet.has(tagId)) {
      selectedSet.delete(tagId);
    } else {
      selectedSet.add(tagId);
    }
    const roomTagDraftIds = [...selectedSet];
    this.setData({
      roomTagDraftIds,
      roomTagOptions: this.buildTagOptions(this.data.availableTags, roomTagDraftIds),
    });
  },

  confirmRoomTagDialog() {
    setRoomTagIds(this.data.roomTagRoomCode, this.data.roomTagDraftIds);
    this.closeRoomTagDialog();
    this.applyRecordViews(this.data.rawItems);
    wx.showToast({ title: '标签已更新', icon: 'success' });
  },

  goToTagSettings() {
    this.setData({
      tagFilterVisible: false,
      roomTagVisible: false,
    });
    wx.navigateTo({ url: '/subpkg/tag-settings/tag-settings' });
  },

  noop() {
    // swallow panel taps so they do not bubble to the sheet mask
  },

  buildTagOptions(tags: RoomTag[], selectedIds: string[]): TagOptionView[] {
    const selectedSet = new Set(selectedIds);
    return tags.map((tag) => ({
      ...tag,
      selected: selectedSet.has(tag.id),
    }));
  },

  pad2(value: number): string {
    if (value < 10) {
      return `0${value}`;
    }
    return `${value}`;
  },

  enableShareMenus() {
    wx.showShareMenu({
      withShareTicket: true,
      menus: ['shareAppMessage', 'shareTimeline'],
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
