import {
  getAccessToken,
  getGuestToken,
  promptGuestNickname,
  saveActorIdentity,
} from '../../utils/identity';
import { buildRoomRealtimeUrl } from '../../utils/realtime';
import { API_BASE_URL, buildRequestHeader, request, RequestError } from '../../utils/request';
import { fontSizeBehavior } from '../../behaviors/font-size';
import { buildInviteEntryUrl, safeDecodeInviteParam } from '../../utils/invite-entry';
import {
  addRoomScore,
  endRoom,
  getRoomByCode,
  hideRoomInviteCard,
  joinRoom,
  kickRoomMember,
  leaveRoom,
  RoomMember,
  RoomPayload,
  RoomScoreRecord,
  refundTableFee,
  transferRoomOwner,
  toggleTableFee,
  updateRoomName,
  setSelfSpectator,
  setSpectators,
  startPoolRound,
  getPoolRound,
} from '../../utils/room';

interface RoomScoreRecordView extends RoomScoreRecord {
  displayTime: string;
}

const ROOM_CODE_LENGTH = 6;
const REALTIME_RECONNECT_BASE_MS = 1000;
const REALTIME_RECONNECT_MAX_MS = 10000;
const REALTIME_HEARTBEAT_MS = 20000;
const SHARE_PROMO_IMAGE = '/assets/images/share-promo.jpg';

interface RealtimeMessage {
  type?: string;
  roomCode?: string;
}

interface RealtimeSendMessage {
  type: string;
  roomCode?: string;
}

interface ScoreNotifyVoiceOption {
  name: string;
  value: string;
}

interface MemberManageCandidate {
  id: number;
  nickname: string;
  avatar: string;
  avatarInitials: string;
  actorType: string;
  isOwner: boolean;
  isSpectator: boolean;
  hasScoreActivity: boolean;
  disabled?: boolean;
  selected?: boolean;
}

let realtimeSocketTask: WechatMiniprogram.SocketTask | null = null;
let realtimeReconnectTimer: number | null = null;
let realtimeHeartbeatTimer: number | null = null;
let realtimeManualClose = false;
let realtimeReconnectAttempt = 0;
let realtimeRefreshing = false;
let realtimeRefreshPending = false;
let roomEntryLoading = false;
let scoreNotifyAudioContext: WechatMiniprogram.InnerAudioContext | null = null;
let scoreNotifyQueue: RoomScoreRecordView[] = [];
let scoreNotifyPlaying = false;
let scoreNotifyInitialized = false;
let scoreNotifyLastSeenRecordId = 0;
let scoreNotifyCurrentTempFilePath = '';
let scoreNotifyPreviewAudioContext: WechatMiniprogram.InnerAudioContext | null = null;
let scoreNotifyPreviewing = false;
let scoreNotifyPreviewTempFilePath = '';
let roomAccessRedirecting = false;

const SCORE_NOTIFY_MUTE_KEY = 'multiInviteScoreNotifyMuted';
const SCORE_NOTIFY_VOICE_KEY = 'multiInviteScoreNotifyVoice';
const DEFAULT_SCORE_NOTIFY_VOICE = 'zh-CN-XiaoxiaoNeural';
const SCORE_NOTIFY_VOICE_OPTIONS: ScoreNotifyVoiceOption[] = [
  { name: '女声 粤语', value: 'zh-HK-HiuMaanNeural' },
  { name: '男声 粤语', value: 'zh-HK-WanLungNeural' },
  { name: '女声', value: 'zh-CN-XiaoxiaoNeural' },
  { name: '男声', value: 'zh-CN-YunhaoNeural' },
];

Page({
  behaviors: [fontSizeBehavior],
  data: {
    topBarTitle: '桌号 ------',
    roomId: 0,
    roomCode: '',
    roomName: '',
    roomStatus: 'IN_PROGRESS' as 'IN_PROGRESS' | 'ENDED',
    codeDigits: ['', '', '', '', '', ''],
    codeFocus: false,
    members: [] as RoomMember[],
    scoreRecords: [] as RoomScoreRecordView[],
    displayMemberCount: 0,
    currentMemberId: 0,
    isOwner: false,
    currentMemberIsSpectator: false,
    inviteCardHiddenBySelf: false,
    showInlineInviteCard: false,
    invitePopupVisible: false,
    loading: false,
    realtimeConnected: false,
    scoreDialogVisible: false,
    scoreTargetMemberId: 0,
    scoreTargetName: '',
    scoreValue: '',
    isPoolMode: false,
    tableFeeEnabled: false,
    activePoolRound: null as { id: number; roundNumber: number; poolBalance: number; status: string } | null,
    poolRounds: [] as any[],
    poolStatsMembers: [] as any[],
    settingsSheetVisible: false,
    roomNameDialogVisible: false,
    roomNameDraft: '',
    transferDialogVisible: false,
    transferCandidates: [] as MemberManageCandidate[],
    selectedTransferMemberId: 0,
    spectatorDialogVisible: false,
    spectatorCandidates: [] as MemberManageCandidate[],
    kickDialogVisible: false,
    kickCandidates: [] as MemberManageCandidate[],
    selectedKickMemberId: 0,
    scoreNotifyDialogVisible: false,
    scoreNotifyVoiceOptions: SCORE_NOTIFY_VOICE_OPTIONS,
    roomType: 'MULTI' as string,
    poolStatsTableWidth: 690,
    ttsMuted: true,
    ttsVoice: DEFAULT_SCORE_NOTIFY_VOICE,
    ttsVoiceLabel: '女声',
  },

  onLoad(options: Record<string, string | undefined>) {
    this.enableShareMenus();
    this.disconnectRealtime(true);
    this.initScoreNotifyAudio();
    if (this.redirectSharedInviteEntry(options)) {
      return;
    }
    const roomCode = (options.roomCode || '').replace(/\D/g, '').slice(0, ROOM_CODE_LENGTH);
    if (roomCode.length === ROOM_CODE_LENGTH) {
      this.setRoomCode(roomCode);
      this.loadEntryRoom(roomCode);
    }
  },

  onShow() {
    (this as any)._applyFontSize();
    this.initScoreNotifyAudio();
    if (!roomEntryLoading) {
      this.refreshRoomState(true);
    }
    this.connectRealtime();
  },

  onHide() {
    this.resetScoreNotifyState();
    this.disconnectRealtime(true);
  },

  onUnload() {
    this.destroyScoreNotifyAudio();
    this.disconnectRealtime(true);
  },

  onPullDownRefresh() {
    this.refreshRoomState(true);
  },

  getScoreNotifyVoiceOption(value?: string): ScoreNotifyVoiceOption {
    return SCORE_NOTIFY_VOICE_OPTIONS.find((item) => item.value === value)
      || SCORE_NOTIFY_VOICE_OPTIONS[2];
  },

  isTableMember(member?: Pick<RoomMember, 'actorType' | 'nickname'> | null): boolean {
    return Boolean(
      member &&
      member.actorType === 'VIRTUAL' &&
      member.nickname === '台板',
    );
  },

  getStoredScoreNotifyMuted(): boolean {
    const storedValue = wx.getStorageSync(SCORE_NOTIFY_MUTE_KEY);

    if (storedValue === '' || typeof storedValue === 'undefined') {
      return true;
    }

    if (typeof storedValue === 'string') {
      const normalizedValue = storedValue.trim().toLowerCase();
      if (!normalizedValue) {
        return true;
      }
      return normalizedValue !== '0' && normalizedValue !== 'false';
    }

    return Boolean(storedValue);
  },

  setStoredScoreNotifyMuted(muted: boolean) {
    wx.setStorageSync(SCORE_NOTIFY_MUTE_KEY, muted ? '1' : '0');
  },

  initScoreNotifyAudio() {
    const ttsMuted = this.getStoredScoreNotifyMuted();
    const storedVoice = String(wx.getStorageSync(SCORE_NOTIFY_VOICE_KEY) || '').trim();
    const voiceOption = this.getScoreNotifyVoiceOption(storedVoice);

    if (
      ttsMuted !== this.data.ttsMuted ||
      voiceOption.value !== this.data.ttsVoice ||
      voiceOption.name !== this.data.ttsVoiceLabel
    ) {
      this.setData({
        ttsMuted,
        ttsVoice: voiceOption.value,
        ttsVoiceLabel: voiceOption.name,
      });
    }

    if (!scoreNotifyAudioContext) {
      scoreNotifyAudioContext = wx.createInnerAudioContext();
      scoreNotifyAudioContext.autoplay = false;
      scoreNotifyAudioContext.onEnded(() => {
        this.finishScoreNotifyPlayback();
        void this.playNextScoreNotifyAudio();
      });
      scoreNotifyAudioContext.onError(() => {
        this.finishScoreNotifyPlayback();
        void this.playNextScoreNotifyAudio();
      });
    }

    if (!scoreNotifyPreviewAudioContext) {
      scoreNotifyPreviewAudioContext = wx.createInnerAudioContext();
      scoreNotifyPreviewAudioContext.autoplay = false;
      scoreNotifyPreviewAudioContext.onEnded(() => {
        this.finishScoreNotifyPreview();
        void this.playNextScoreNotifyAudio();
      });
      scoreNotifyPreviewAudioContext.onError(() => {
        this.finishScoreNotifyPreview();
        void this.playNextScoreNotifyAudio();
      });
    }

    scoreNotifyQueue = [];
    scoreNotifyPlaying = false;
    scoreNotifyInitialized = false;
    scoreNotifyLastSeenRecordId = 0;
    scoreNotifyCurrentTempFilePath = '';
    scoreNotifyPreviewing = false;
    scoreNotifyPreviewTempFilePath = '';
  },

  destroyScoreNotifyAudio() {
    this.stopScoreNotifyPlayback(true);
    this.stopScoreNotifyPreview(false);
    if (scoreNotifyAudioContext) {
      scoreNotifyAudioContext.destroy();
      scoreNotifyAudioContext = null;
    }
    if (scoreNotifyPreviewAudioContext) {
      scoreNotifyPreviewAudioContext.destroy();
      scoreNotifyPreviewAudioContext = null;
    }
  },

  resetScoreNotifyState() {
    this.stopScoreNotifyPlayback(true);
    this.stopScoreNotifyPreview(false);
    scoreNotifyInitialized = false;
    scoreNotifyLastSeenRecordId = 0;
    if (this.data.scoreNotifyDialogVisible) {
      this.setData({ scoreNotifyDialogVisible: false });
    }
  },

  setScoreNotifyMuted(nextMuted: boolean, toastTitle?: string) {
    this.setStoredScoreNotifyMuted(nextMuted);
    this.setData({ ttsMuted: nextMuted });

    if (nextMuted) {
      this.stopScoreNotifyPlayback(true);
    } else {
      void this.playNextScoreNotifyAudio();
    }

    if (toastTitle) {
      wx.showToast({ title: toastTitle, icon: 'none' });
    }
  },

  openScoreNotifyDialog() {
    this.setData({ scoreNotifyDialogVisible: true });
  },

  closeScoreNotifyDialog() {
    this.stopScoreNotifyPreview();
    this.setData({ scoreNotifyDialogVisible: false });
  },

  selectScoreNotifyVoice(e: WechatMiniprogram.BaseEvent) {
    const voice = String(e.currentTarget.dataset.voice || '').trim();
    const option = this.getScoreNotifyVoiceOption(voice);

    if (option.value === this.data.ttsVoice) {
      return;
    }

    wx.setStorageSync(SCORE_NOTIFY_VOICE_KEY, option.value);
    this.setData({
      ttsVoice: option.value,
      ttsVoiceLabel: option.name,
    });
  },

  async previewScoreNotifyVoice(e: WechatMiniprogram.BaseEvent) {
    const voice = String(e.currentTarget.dataset.voice || '').trim();
    const option = this.getScoreNotifyVoiceOption(voice);

    if (!this.data.roomId) {
      wx.showToast({ title: '房间信息异常', icon: 'none' });
      return;
    }

    if (scoreNotifyPlaying) {
      wx.showToast({ title: '当前正在播报，请稍后试听', icon: 'none' });
      return;
    }

    if (!scoreNotifyPreviewAudioContext) {
      this.initScoreNotifyAudio();
    }

    this.stopScoreNotifyPreview(false);
    scoreNotifyPreviewing = true;
    wx.showLoading({ title: '试听生成中...' });

    try {
      const tempFilePath = await this.downloadScoreNotifyPreviewAudio(option.value);
      scoreNotifyPreviewTempFilePath = tempFilePath;
      if (!scoreNotifyPreviewAudioContext) {
        throw new Error('preview_audio_context_missing');
      }
      scoreNotifyPreviewAudioContext.src = tempFilePath;
      scoreNotifyPreviewAudioContext.play();
    } catch (_error) {
      this.finishScoreNotifyPreview();
      wx.showToast({ title: '试听失败，请稍后重试', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  confirmScoreNotifyDialog() {
    const nextMuted = !this.data.ttsMuted;
    this.stopScoreNotifyPreview(false);
    this.setScoreNotifyMuted(
      nextMuted,
      nextMuted ? '已关闭语音播报' : '已开启语音播报',
    );
    this.setData({ scoreNotifyDialogVisible: false });
  },

  handleScoreRecordNotifications(
    currentMemberId: number,
    scoreRecords: RoomScoreRecordView[],
  ) {
    const latestRecordId = scoreRecords.reduce((maxId, record) => {
      return record.id > maxId ? record.id : maxId;
    }, 0);

    if (!scoreNotifyInitialized) {
      scoreNotifyInitialized = true;
      scoreNotifyLastSeenRecordId = latestRecordId;
      return;
    }

    const newRecords = scoreRecords
      .filter((record) => record.id > scoreNotifyLastSeenRecordId)
      .sort((left, right) => left.id - right.id);
    scoreNotifyLastSeenRecordId = latestRecordId;

    if (this.data.ttsMuted || newRecords.length === 0) {
      return;
    }

    const targetRecords = newRecords.filter((record) => {
      return (
        record.toMemberId === currentMemberId &&
        (record.recordType === 'NORMAL' || record.recordType === 'KICK_REFUND')
      );
    });

    if (targetRecords.length === 0) {
      return;
    }

    scoreNotifyQueue.push(...targetRecords);
    void this.playNextScoreNotifyAudio();
  },

  async playNextScoreNotifyAudio() {
    if (scoreNotifyPlaying || scoreNotifyPreviewing || this.data.ttsMuted) {
      return;
    }

    const nextRecord = scoreNotifyQueue.shift();
    if (!nextRecord || !this.data.roomId || !scoreNotifyAudioContext) {
      return;
    }

    scoreNotifyPlaying = true;

    try {
      const tempFilePath = await this.downloadScoreNotifyAudio(nextRecord.id);
      scoreNotifyCurrentTempFilePath = tempFilePath;
      scoreNotifyAudioContext.src = tempFilePath;
      scoreNotifyAudioContext.play();
    } catch (_error) {
      this.finishScoreNotifyPlayback();
      void this.playNextScoreNotifyAudio();
    }
  },

  finishScoreNotifyPlayback() {
    scoreNotifyPlaying = false;

    if (scoreNotifyCurrentTempFilePath) {
      const tempFilePath = scoreNotifyCurrentTempFilePath;
      scoreNotifyCurrentTempFilePath = '';
      try {
        wx.getFileSystemManager().unlink({
          filePath: tempFilePath,
          fail: () => undefined,
        });
      } catch (_error) {
        // ignore cleanup errors
      }
    }
  },

  finishScoreNotifyPreview() {
    scoreNotifyPreviewing = false;

    if (scoreNotifyPreviewTempFilePath) {
      const tempFilePath = scoreNotifyPreviewTempFilePath;
      scoreNotifyPreviewTempFilePath = '';
      try {
        wx.getFileSystemManager().unlink({
          filePath: tempFilePath,
          fail: () => undefined,
        });
      } catch (_error) {
        // ignore cleanup errors
      }
    }
  },

  stopScoreNotifyPlayback(clearQueue = false) {
    if (clearQueue) {
      scoreNotifyQueue = [];
    }

    if (scoreNotifyAudioContext) {
      try {
        scoreNotifyAudioContext.stop();
      } catch (_error) {
        // ignore stop errors
      }
    }

    this.finishScoreNotifyPlayback();
  },

  stopScoreNotifyPreview(resumePlayback = true) {
    const wasPreviewing = scoreNotifyPreviewing;

    if (scoreNotifyPreviewAudioContext) {
      try {
        scoreNotifyPreviewAudioContext.stop();
      } catch (_error) {
        // ignore stop errors
      }
    }

    this.finishScoreNotifyPreview();

    if (resumePlayback && wasPreviewing) {
      void this.playNextScoreNotifyAudio();
    }
  },

  downloadScoreNotifyAudio(recordId: number): Promise<string> {
    const roomId = this.data.roomId;
    if (!roomId) {
      return Promise.reject(new Error('room_id_missing'));
    }
    const voice = encodeURIComponent(this.data.ttsVoice || DEFAULT_SCORE_NOTIFY_VOICE);

    return new Promise((resolve, reject) => {
      wx.downloadFile({
        url: `${API_BASE_URL}/rooms/${roomId}/score-records/${recordId}/audio?voice=${voice}`,
        header: buildRequestHeader(),
        success: (res) => {
          if (
            res.statusCode >= 200 &&
            res.statusCode < 300 &&
            res.tempFilePath
          ) {
            resolve(res.tempFilePath);
            return;
          }

          reject(new Error(`download_failed_${res.statusCode}`));
        },
        fail: reject,
      });
    });
  },

  downloadScoreNotifyPreviewAudio(voice: string): Promise<string> {
    const roomId = this.data.roomId;
    if (!roomId) {
      return Promise.reject(new Error('room_id_missing'));
    }
    const encodedVoice = encodeURIComponent(voice || DEFAULT_SCORE_NOTIFY_VOICE);

    return new Promise((resolve, reject) => {
      wx.downloadFile({
        url: `${API_BASE_URL}/rooms/${roomId}/score-notify-preview/audio?voice=${encodedVoice}`,
        header: buildRequestHeader(),
        success: (res) => {
          if (
            res.statusCode >= 200 &&
            res.statusCode < 300 &&
            res.tempFilePath
          ) {
            resolve(res.tempFilePath);
            return;
          }

          reject(new Error(`preview_download_failed_${res.statusCode}`));
        },
        fail: reject,
      });
    });
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
      return;
    }
    wx.switchTab({ url: '/pages/home/home' });
  },

  handleRoomAccessLost(error: RequestError) {
    if (
      this.data.roomId > 0 &&
      (error.statusCode === 401 || error.statusCode === 403) &&
      !roomAccessRedirecting
    ) {
      roomAccessRedirecting = true;
      this.disconnectRealtime(true);
      wx.showToast({ title: '你已不在当前房间', icon: 'none' });
      setTimeout(() => {
        roomAccessRedirecting = false;
        wx.switchTab({ url: '/pages/home/home' });
      }, 600);
      return true;
    }

    return false;
  },

  async refreshRoomState(silent = false) {
    const roomCode = this.data.roomCode;
    if (roomCode.length !== ROOM_CODE_LENGTH) {
      wx.stopPullDownRefresh();
      return;
    }

    if (!silent) {
      wx.showLoading({ title: '加载中...' });
    }

    try {
      const payload = await getRoomByCode(roomCode);
      roomAccessRedirecting = false;
      this.applyRoomPayload(payload);
    } catch (error) {
      const requestError = error as RequestError;
      if (this.handleRoomAccessLost(requestError)) {
        return;
      }
      if (!silent) {
        wx.showToast({
          title: requestError.message || '拉取房间失败',
          icon: 'none',
        });
      }
    } finally {
      if (!silent) {
        wx.hideLoading();
      }
      wx.stopPullDownRefresh();
    }
  },

  async loadEntryRoom(roomCode: string) {
    roomEntryLoading = true;
    wx.showLoading({ title: '加载中...' });

    try {
      try {
        const payload = await getRoomByCode(roomCode);
        this.applyRoomPayload(payload);
        return;
      } catch (error) {
        const requestError = error as RequestError;
        if (!this.shouldAutoJoinEntry(requestError)) {
          wx.showToast({
            title: requestError.message || '拉取房间失败',
            icon: 'none',
          });
          return;
        }
      }

      await this.joinRoomFromShare(roomCode);
    } finally {
      wx.hideLoading();
      roomEntryLoading = false;
    }
  },

  shouldAutoJoinEntry(error: RequestError): boolean {
    return error.statusCode === 401 || error.statusCode === 403;
  },

  async joinRoomFromShare(roomCode: string) {
    let guestNickname: string | undefined;

    if (!getAccessToken() && !getGuestToken()) {
      wx.hideLoading();
      const inputNickname = await promptGuestNickname('游客昵称', '请输入昵称后加入房间');
      if (!inputNickname) {
        wx.showToast({ title: '已取消加入房间', icon: 'none' });
        return;
      }
      guestNickname = inputNickname;
      wx.showLoading({ title: '加入中...' });
    }

    const payload = await joinRoom(roomCode, guestNickname);
    this.applyRoomPayload(payload);
  },

  onActionTap(e: WechatMiniprogram.BaseEvent) {
    const action = String(e.currentTarget.dataset.action || '');

    if (action === 'invite') {
      this.openInvitePopup();
      return;
    }

    if (action === 'detail') {
      wx.showToast({ title: '明细已展示在下方列表', icon: 'none' });
      return;
    }

    if (action === 'end') {
      this.handleEndRoom();
      return;
    }

    if (action === 'leave') {
      this.handleLeaveRoom();
      return;
    }

    if (action === 'cancel-spectator') {
      this.handleCancelSpectator();
      return;
    }

    if (action === 'manage' || action === 'settings') {
      this.openSettingsSheet();
      return;
    }

    if (action === 'mute') {
      this.openScoreNotifyDialog();
      return;
    }

    wx.showToast({ title: `${action} 功能开发中`, icon: 'none' });
  },

  openSettingsSheet() {
    if (!this.data.isOwner) {
      wx.showToast({ title: '只有桌主可以管理牌桌', icon: 'none' });
      return;
    }

    if (this.data.roomStatus !== 'IN_PROGRESS') {
      wx.showToast({ title: '房间已结束，无法继续管理', icon: 'none' });
      return;
    }

    this.setData({ settingsSheetVisible: true });
  },

  closeSettingsSheet() {
    this.setData({ settingsSheetVisible: false });
  },

  handleSettingsOptionTap(e: WechatMiniprogram.BaseEvent) {
    const action = String(e.currentTarget.dataset.action || '');
    this.closeSettingsSheet();

    if (action === 'room-name') {
      this.openRoomNameDialog();
      return;
    }

    if (action === 'transfer-owner') {
      this.openTransferDialog();
      return;
    }

    if (action === 'spectators') {
      this.openSpectatorDialog();
      return;
    }

    if (action === 'kick-member') {
      this.openKickDialog();
    }
  },

  openInvitePopup() {
    this.setData({
      invitePopupVisible: true,
      codeFocus: false,
    });
  },

  closeInvitePopup() {
    this.setData({
      invitePopupVisible: false,
      codeFocus: false,
    });
  },

  async handleInlineInviteCardClose() {
    if (!this.data.roomId) {
      this.setData({ showInlineInviteCard: false });
      return;
    }

    wx.showLoading({ title: '处理中...' });
    try {
      const payload = await hideRoomInviteCard(this.data.roomId);
      this.applyRoomPayload(payload);
    } catch (error) {
      wx.showToast({
        title: (error as RequestError).message || '关闭失败',
        icon: 'none',
      });
    } finally {
      wx.hideLoading();
    }
  },

  handleShareInvite() {
    const roomCode = this.data.roomCode;
    if (roomCode.length !== ROOM_CODE_LENGTH) {
      wx.showToast({ title: '房间号为空，无法分享', icon: 'none' });
      return;
    }

    wx.setClipboardData({
      data: roomCode,
      success: () => {
        wx.showToast({ title: `已复制房间号 ${roomCode}，可微信分享`, icon: 'none' });
      },
    });
  },

  enableShareMenus() {
    wx.showShareMenu({
      withShareTicket: true,
      menus: ['shareAppMessage', 'shareTimeline'],
    });
  },

  openScoreDialog(e: WechatMiniprogram.BaseEvent) {
    if (this.data.roomStatus !== 'IN_PROGRESS') {
      wx.showToast({ title: '房间已结束，不能继续记分', icon: 'none' });
      return;
    }

    if (this.data.currentMemberIsSpectator) {
      wx.showToast({ title: '旁观者不能操作', icon: 'none' });
      return;
    }

    const targetMemberId = Number(e.currentTarget.dataset.memberId || 0);
    const targetMemberName = String(e.currentTarget.dataset.memberName || '');

    if (!targetMemberId || targetMemberId === this.data.currentMemberId) {
      wx.showToast({ title: '请选择其他玩家', icon: 'none' });
      return;
    }

    this.setData({
      scoreDialogVisible: true,
      scoreTargetMemberId: targetMemberId,
      scoreTargetName: targetMemberName,
      scoreValue: '',
    });
  },

  closeScoreDialog() {
    this.setData({
      scoreDialogVisible: false,
      scoreTargetMemberId: 0,
      scoreTargetName: '',
      scoreValue: '',
    });
  },

  noop() {
    // 用于阻止弹窗内部点击事件冒泡
  },

  onScoreInput(e: WechatMiniprogram.CustomEvent) {
    const rawValue = String((e.detail as { value?: string }).value || '');
    const value = rawValue.replace(/\D/g, '').slice(0, 6);
    this.setData({ scoreValue: value });
  },

  async confirmScore() {
    if (!this.data.roomId) {
      wx.showToast({ title: '房间信息异常', icon: 'none' });
      return;
    }

    if (this.data.currentMemberIsSpectator) {
      wx.showToast({ title: '旁观者不能操作', icon: 'none' });
      return;
    }

    const points = Number(this.data.scoreValue || 0);
    if (!Number.isInteger(points) || points <= 0) {
      wx.showToast({ title: '请输入有效分数', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '记分中...' });
    try {
      const payload = await addRoomScore(
        this.data.roomId,
        this.data.scoreTargetMemberId,
        points,
      );
      this.applyRoomPayload(payload);
      this.closeScoreDialog();
      wx.showToast({ title: '记分成功', icon: 'success' });
    } catch (error) {
      wx.showToast({
        title: (error as RequestError).message || '记分失败',
        icon: 'none',
      });
    } finally {
      wx.hideLoading();
    }
  },

  openRoomNameDialog() {
    this.setData({
      roomNameDialogVisible: true,
      roomNameDraft: this.data.roomName || '',
    });
  },

  closeRoomNameDialog() {
    this.setData({
      roomNameDialogVisible: false,
      roomNameDraft: this.data.roomName || '',
    });
  },

  onRoomNameInput(e: WechatMiniprogram.CustomEvent) {
    const value = String((e.detail as { value?: string }).value || '')
      .trimStart()
      .slice(0, 64);
    this.setData({ roomNameDraft: value });
  },

  async confirmRoomNameDialog() {
    if (!this.data.roomId) {
      return;
    }

    wx.showLoading({ title: '保存中...' });
    try {
      const payload = await updateRoomName(this.data.roomId, this.data.roomNameDraft);
      this.applyRoomPayload(payload);
      this.closeRoomNameDialog();
      wx.showToast({ title: '牌桌名称已更新', icon: 'success' });
    } catch (error) {
      wx.showToast({
        title: (error as RequestError).message || '更新失败',
        icon: 'none',
      });
    } finally {
      wx.hideLoading();
    }
  },

  openTransferDialog() {
    const candidates = this.data.members
      .filter((member) => {
        return (
          member.id !== this.data.currentMemberId &&
          !member.isSpectator &&
          !this.isTableMember(member)
        );
      })
      .map((member) => ({
        id: member.id,
        nickname: member.nickname,
        avatar: member.avatar,
        avatarInitials: member.avatarInitials,
        actorType: member.actorType,
        isOwner: member.isOwner,
        isSpectator: Boolean(member.isSpectator),
        hasScoreActivity: Boolean(member.hasScoreActivity),
        selected: false,
      }));

    if (candidates.length === 0) {
      wx.showToast({ title: '暂无可转移的玩家', icon: 'none' });
      return;
    }

    this.setData({
      transferDialogVisible: true,
      transferCandidates: candidates,
      selectedTransferMemberId: 0,
    });
  },

  closeTransferDialog() {
    this.setData({
      transferDialogVisible: false,
      transferCandidates: [],
      selectedTransferMemberId: 0,
    });
  },

  selectTransferCandidate(e: WechatMiniprogram.BaseEvent) {
    const memberId = Number(e.currentTarget.dataset.memberId || 0);
    if (!memberId) {
      return;
    }

    this.setData({
      selectedTransferMemberId: memberId,
      transferCandidates: this.data.transferCandidates.map((candidate) => ({
        ...candidate,
        selected: candidate.id === memberId,
      })),
    });
  },

  async confirmTransferDialog() {
    if (!this.data.selectedTransferMemberId) {
      wx.showToast({ title: '请选择新桌主', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '转移中...' });
    try {
      const payload = await transferRoomOwner(this.data.roomId, this.data.selectedTransferMemberId);
      this.applyRoomPayload(payload);
      this.closeTransferDialog();
      wx.showToast({ title: '桌主已转移', icon: 'success' });
    } catch (error) {
      wx.showToast({
        title: (error as RequestError).message || '转移失败',
        icon: 'none',
      });
    } finally {
      wx.hideLoading();
    }
  },

  openKickDialog() {
    const candidates = this.data.members
      .filter((member) => {
        return (
          member.id !== this.data.currentMemberId &&
          !member.isOwner &&
          !this.isTableMember(member) &&
          !member.hasScoreActivity
        );
      })
      .map((member) => ({
        id: member.id,
        nickname: member.nickname,
        avatar: member.avatar,
        avatarInitials: member.avatarInitials,
        actorType: member.actorType,
        isOwner: member.isOwner,
        isSpectator: Boolean(member.isSpectator),
        hasScoreActivity: Boolean(member.hasScoreActivity),
        selected: false,
      }));

    if (candidates.length === 0) {
      wx.showToast({ title: '仅可踢出无得失分记录的玩家，不能踢出桌主，暂无可踢出的玩家。', icon: 'none' });
      return;
    }

    this.setData({
      kickDialogVisible: true,
      kickCandidates: candidates,
      selectedKickMemberId: 0,
    });
  },

  closeKickDialog() {
    this.setData({
      kickDialogVisible: false,
      kickCandidates: [],
      selectedKickMemberId: 0,
    });
  },

  selectKickCandidate(e: WechatMiniprogram.BaseEvent) {
    const memberId = Number(e.currentTarget.dataset.memberId || 0);
    if (!memberId) {
      return;
    }

    this.setData({
      selectedKickMemberId: memberId,
      kickCandidates: this.data.kickCandidates.map((candidate) => ({
        ...candidate,
        selected: candidate.id === memberId,
      })),
    });
  },

  async confirmKickDialog() {
    if (!this.data.selectedKickMemberId) {
      wx.showToast({ title: '请选择要踢出的玩家', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '处理中...' });
    try {
      const payload = await kickRoomMember(this.data.roomId, this.data.selectedKickMemberId);
      this.applyRoomPayload(payload);
      this.closeKickDialog();
      wx.showToast({ title: '玩家已踢出', icon: 'success' });
    } catch (error) {
      wx.showToast({
        title: (error as RequestError).message || '踢出失败',
        icon: 'none',
      });
    } finally {
      wx.hideLoading();
    }
  },

  handleEndRoom() {
    if (!this.data.isOwner) {
      wx.showToast({ title: '只有桌主可以结束房间', icon: 'none' });
      return;
    }

    if (this.data.roomStatus === 'ENDED') {
      wx.showToast({ title: '房间已结束', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '结束房间',
      content: '结束后将不能继续记分，是否继续？',
      success: async (res: WechatMiniprogram.ShowModalSuccessCallbackResult) => {
        if (!res.confirm) {
          return;
        }

        wx.showLoading({ title: '结束中...' });
        try {
          const payload = await endRoom(this.data.roomId);
          this.applyRoomPayload(payload);
          wx.showToast({ title: '房间已结束', icon: 'success' });
        } catch (error) {
          wx.showToast({
            title: (error as RequestError).message || '结束房间失败',
            icon: 'none',
          });
        } finally {
          wx.hideLoading();
        }
      },
    });
  },

  handleLeaveRoom() {
    if (this.data.isOwner) {
      wx.showToast({ title: '桌主请使用结束按钮', icon: 'none' });
      return;
    }

    const currentMember = this.getCurrentMember();
    if (!currentMember) {
      wx.showToast({ title: '未找到当前成员信息', icon: 'none' });
      return;
    }

    if (
      this.data.roomStatus === 'IN_PROGRESS' &&
      !currentMember.isSpectator &&
      currentMember.hasScoreActivity
    ) {
      wx.showModal({
        title: '提示',
        content: '您在本桌中已有分数记录，不能退出，可以旁观，旁观后仅能观看计分',
        cancelText: '不了',
        confirmText: '旁观',
        success: async (res: WechatMiniprogram.ShowModalSuccessCallbackResult) => {
          if (!res.confirm) {
            return;
          }

          await this.updateSelfSpectatorState(true);
        },
      });
      return;
    }

    wx.showModal({
      title: '退出房间',
      content: '退出后将离开当前房间，是否继续？',
      success: async (res: WechatMiniprogram.ShowModalSuccessCallbackResult) => {
        if (!res.confirm) {
          return;
        }

        wx.showLoading({ title: '退出中...' });
        try {
          await leaveRoom(this.data.roomId);
          this.disconnectRealtime(true);
          wx.hideLoading();
          wx.showToast({ title: '已退出房间', icon: 'success' });
          setTimeout(() => {
            wx.switchTab({ url: '/pages/home/home' });
          }, 300);
        } catch (error) {
          wx.hideLoading();
          wx.showToast({
            title: (error as RequestError).message || '退出房间失败',
            icon: 'none',
          });
        }
      },
    });
  },

  getCurrentMember(): RoomMember | null {
    return this.data.members.find((member) => member.id === this.data.currentMemberId) || null;
  },

  async updateSelfSpectatorState(spectator: boolean) {
    if (!this.data.roomId) {
      wx.showToast({ title: '房间信息异常', icon: 'none' });
      return;
    }

    wx.showLoading({ title: spectator ? '旁观中...' : '处理中...' });
    try {
      const payload = await setSelfSpectator(this.data.roomId, spectator);
      this.applyRoomPayload(payload);
      wx.showToast({
        title: spectator ? '已进入旁观' : '已取消旁观',
        icon: 'success',
      });
    } catch (error) {
      wx.showToast({
        title: (error as RequestError).message || (spectator ? '进入旁观失败' : '取消旁观失败'),
        icon: 'none',
      });
    } finally {
      wx.hideLoading();
    }
  },

  handleCancelSpectator() {
    if (!this.data.currentMemberIsSpectator) {
      wx.showToast({ title: '当前不是旁观状态', icon: 'none' });
      return;
    }

    if (this.data.roomStatus !== 'IN_PROGRESS') {
      wx.showToast({ title: '房间已结束，无需取消旁观', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '提示',
      content: '是否取消旁观？',
      cancelText: '不了',
      confirmText: '确定',
      success: async (res: WechatMiniprogram.ShowModalSuccessCallbackResult) => {
        if (!res.confirm) {
          return;
        }

        await this.updateSelfSpectatorState(false);
      },
    });
  },

  setRoomCode(roomCode: string) {
    const normalized = roomCode.replace(/\D/g, '').slice(0, ROOM_CODE_LENGTH);
    const fallbackRoomName = normalized ? `桌号 ${normalized}` : '桌号 ------';
    const codeDigits = Array.from({ length: ROOM_CODE_LENGTH }, (_, index) => {
      return normalized[index] || '';
    });

    this.setData({
      roomCode: normalized,
      roomName: fallbackRoomName,
      codeDigits,
      topBarTitle: fallbackRoomName,
    });
  },

  applyRoomPayload(payload: RoomPayload) {
    saveActorIdentity(payload.actor);

    const currentMemberId = payload.currentMemberId || 0;
    const isPoolMode = payload.room.roomType === 'POOL';
    const sortedMembers = this.sortMembersForView(
      payload.room.members,
      currentMemberId,
      payload.room.ownerMemberId || 0,
    );

    const scoreRecords = [...payload.room.scoreRecords]
      .reverse()
      .map((record) => ({
        ...record,
        displayTime: this.formatTime(record.createdAt),
      }));

    const currentMember = sortedMembers.find(
      (member) => member.id === currentMemberId,
    );
    const displayMembers = sortedMembers.filter((member) => !this.isTableMember(member));
    const inviteCardHiddenBySelf = currentMember
      ? Boolean(currentMember.inviteCardHidden)
      : false;
    const showInlineInviteCard =
      !isPoolMode && displayMembers.length === 1 && !inviteCardHiddenBySelf;

    this.handleScoreRecordNotifications(currentMemberId, scoreRecords);

    this.setData({
      roomId: payload.room.id,
      roomCode: payload.room.roomCode,
      roomName: payload.room.roomName || `桌号 ${payload.room.roomCode}`,
      roomStatus: payload.room.status,
      roomType: payload.room.roomType,
      topBarTitle: payload.room.roomName || `桌号 ${payload.room.roomCode}`,
      codeDigits: Array.from({ length: ROOM_CODE_LENGTH }, (_, index) => {
        return payload.room.roomCode[index] || '';
      }),
      members: sortedMembers,
      scoreRecords,
      displayMemberCount: displayMembers.length,
      currentMemberId,
      isOwner: payload.room.ownerMemberId === currentMemberId,
      currentMemberIsSpectator: Boolean(currentMember?.isSpectator),
      inviteCardHiddenBySelf,
      showInlineInviteCard,
      isPoolMode,
      tableFeeEnabled: payload.room.tableFeeEnabled || false,
      activePoolRound: (payload.room as any).activePoolRound || null,
    });

    if (isPoolMode) {
      this.loadPoolRounds();
    } else {
      this.setData({
        poolRounds: [],
        poolStatsMembers: [],
        poolStatsTableWidth: 690,
      });
    }
  },

  sortMembersForView(
    members: RoomMember[],
    currentMemberId: number,
    ownerMemberId: number,
  ): RoomMember[] {
    return members
      .map((member, index) => ({
        member,
        index,
      }))
      .sort((left, right) => {
        const leftRank = this.getMemberDisplayRank(
          left.member.id,
          currentMemberId,
          ownerMemberId,
        );
        const rightRank = this.getMemberDisplayRank(
          right.member.id,
          currentMemberId,
          ownerMemberId,
        );

        if (leftRank !== rightRank) {
          return leftRank - rightRank;
        }

        return left.index - right.index;
      })
      .map((item) => item.member);
  },

  getMemberDisplayRank(
    memberId: number,
    currentMemberId: number,
    ownerMemberId: number,
  ): number {
    if (memberId === currentMemberId) {
      return 0;
    }

    if (memberId === ownerMemberId) {
      return 1;
    }

    return 2;
  },

  connectRealtime() {
    const roomCode = this.data.roomCode;
    if (roomCode.length !== ROOM_CODE_LENGTH) {
      return;
    }

    if (realtimeSocketTask) {
      return;
    }

    this.clearRealtimeReconnectTimer();
    realtimeManualClose = false;

    const socketUrl = buildRoomRealtimeUrl(roomCode);
    const socketTask = wx.connectSocket({
      url: socketUrl,
      timeout: 10000,
    });
    realtimeSocketTask = socketTask;

    socketTask.onOpen(() => {
      realtimeReconnectAttempt = 0;
      this.setData({ realtimeConnected: true });
      this.startRealtimeHeartbeat();
      this.sendRealtimeMessage({
        type: 'subscribe',
        roomCode,
      });
    });

    socketTask.onMessage((event: WechatMiniprogram.SocketTaskOnMessageListenerResult) => {
      this.handleRealtimeMessage(event.data);
    });

    socketTask.onClose(() => {
      this.handleRealtimeClose();
    });

    socketTask.onError(() => {
      this.handleRealtimeClose();
    });
  },

  disconnectRealtime(manualClose = true) {
    realtimeManualClose = manualClose;
    this.clearRealtimeReconnectTimer();
    this.stopRealtimeHeartbeat();

    if (realtimeSocketTask) {
      try {
        realtimeSocketTask.close({
          code: 1000,
          reason: 'page_closed',
        });
      } catch (error) {
        // ignore close errors
      }
      realtimeSocketTask = null;
    }

    if (manualClose) {
      realtimeReconnectAttempt = 0;
      realtimeRefreshing = false;
      realtimeRefreshPending = false;
    }

    this.setData({ realtimeConnected: false });
  },

  handleRealtimeClose() {
    this.stopRealtimeHeartbeat();
    realtimeSocketTask = null;
    this.setData({ realtimeConnected: false });

    if (realtimeManualClose) {
      return;
    }

    this.scheduleRealtimeReconnect();
  },

  scheduleRealtimeReconnect() {
    if (realtimeReconnectTimer !== null) {
      return;
    }

    const roomCode = this.data.roomCode;
    if (roomCode.length !== ROOM_CODE_LENGTH) {
      return;
    }

    const waitMs = Math.min(
      REALTIME_RECONNECT_MAX_MS,
      REALTIME_RECONNECT_BASE_MS * (2 ** realtimeReconnectAttempt),
    );
    realtimeReconnectAttempt += 1;

    realtimeReconnectTimer = setTimeout(() => {
      realtimeReconnectTimer = null;
      this.connectRealtime();
    }, waitMs) as unknown as number;
  },

  clearRealtimeReconnectTimer() {
    if (realtimeReconnectTimer !== null) {
      clearTimeout(realtimeReconnectTimer);
      realtimeReconnectTimer = null;
    }
  },

  startRealtimeHeartbeat() {
    this.stopRealtimeHeartbeat();
    realtimeHeartbeatTimer = setInterval(() => {
      this.sendRealtimeMessage({ type: 'ping' });
    }, REALTIME_HEARTBEAT_MS) as unknown as number;
  },

  stopRealtimeHeartbeat() {
    if (realtimeHeartbeatTimer !== null) {
      clearInterval(realtimeHeartbeatTimer);
      realtimeHeartbeatTimer = null;
    }
  },

  sendRealtimeMessage(message: RealtimeSendMessage) {
    if (!realtimeSocketTask) {
      return;
    }

    try {
      realtimeSocketTask.send({
        data: JSON.stringify(message),
      });
    } catch (error) {
      // ignore send errors, reconnect handler will recover
    }
  },

  handleRealtimeMessage(rawData: string | ArrayBuffer) {
    const message = this.parseRealtimeMessage(rawData);
    if (!message || !message.type) {
      return;
    }

    if (message.type === 'room_updated' && message.roomCode === this.data.roomCode) {
      this.handleRealtimeRoomUpdated();
      return;
    }
  },

  parseRealtimeMessage(rawData: string | ArrayBuffer): RealtimeMessage | null {
    let messageText = '';
    if (typeof rawData === 'string') {
      messageText = rawData;
    } else {
      try {
        messageText = String.fromCharCode.apply(null, Array.from(new Uint8Array(rawData)));
      } catch (error) {
        return null;
      }
    }

    try {
      return JSON.parse(messageText) as RealtimeMessage;
    } catch (error) {
      return null;
    }
  },

  handleRealtimeRoomUpdated() {
    if (realtimeRefreshing) {
      realtimeRefreshPending = true;
      return;
    }

    realtimeRefreshing = true;
    this.refreshRoomState(true)
      .catch(() => {
        // 失败时保持静默，下一个实时事件或重连会继续尝试
      })
      .finally(() => {
        realtimeRefreshing = false;
        if (realtimeRefreshPending) {
          realtimeRefreshPending = false;
          this.handleRealtimeRoomUpdated();
        }
      });
  },

  // ───────── 分数池功能 ─────────

  async handleStartPoolRound() {
    if (!this.data.isOwner) {
      wx.showToast({ title: '只有桌主可以开启新圈', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '开启中...' });
    try {
      const payload = await startPoolRound(this.data.roomId);
      wx.hideLoading();
      if (payload.round) {
        this.setData({
          activePoolRound: {
            id: payload.round.id,
            roundNumber: payload.round.roundNumber,
            poolBalance: payload.round.poolBalance,
            status: payload.round.status,
          },
        });
        wx.navigateTo({
          url: `/subpkg/pool-record/pool-record?roomId=${this.data.roomId}&roundId=${payload.round.id}`,
        });
      }
    } catch (error) {
      wx.hideLoading();
      wx.showToast({ title: (error as RequestError).message || '开启失败', icon: 'none' });
    }
  },

  goToPoolRecord() {
    const round = this.data.activePoolRound;
    if (!round) return;
    wx.navigateTo({
      url: `/subpkg/pool-record/pool-record?roomId=${this.data.roomId}&roundId=${round.id}`,
    });
  },

  goToRoundDetail(e: any) {
    const roundId = Number(e.currentTarget.dataset.roundId || 0);
    if (!roundId) return;
    wx.navigateTo({
      url: `/subpkg/pool-record/pool-record?roomId=${this.data.roomId}&roundId=${roundId}`,
    });
  },

  async handleToggleTableFee() {
    if (!this.data.isOwner) {
      wx.showToast({ title: '只有桌主可以操作台板', icon: 'none' });
      return;
    }
    if (this.data.roomStatus !== 'IN_PROGRESS') {
      wx.showToast({ title: '房间已结束，无法操作台板', icon: 'none' });
      return;
    }
    const newEnabled = !this.data.tableFeeEnabled;
    wx.showLoading({ title: '处理中...' });
    try {
      const payload = await toggleTableFee(this.data.roomId, newEnabled);
      this.applyRoomPayload(payload);
    } catch (error) {
      wx.showToast({ title: (error as RequestError).message || '操作失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  handleRefundTableFee(e: WechatMiniprogram.BaseEvent) {
    if (!this.data.isOwner) {
      wx.showToast({ title: '只有桌主可以退台板积分', icon: 'none' });
      return;
    }
    if (this.data.roomStatus !== 'IN_PROGRESS') {
      wx.showToast({ title: '房间已结束，无法退分', icon: 'none' });
      return;
    }

    const memberId = Number(e.currentTarget.dataset.memberId || 0);
    const memberName = String(e.currentTarget.dataset.memberName || '台板');
    const memberScore = Number(e.currentTarget.dataset.memberScore || 0);

    if (!memberId || memberScore <= 0) {
      wx.showToast({ title: '台板暂无可退积分', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '台板退分',
      content: `确认将${memberName}当前的 ${memberScore} 分按原始来源退回给所有人吗？`,
      success: async (res: WechatMiniprogram.ShowModalSuccessCallbackResult) => {
        if (!res.confirm) {
          return;
        }

        wx.showLoading({ title: '退分中...' });
        try {
          const payload = await refundTableFee(this.data.roomId);
          this.applyRoomPayload(payload);
          wx.showToast({ title: '台板退分成功', icon: 'success' });
        } catch (error) {
          wx.showToast({
            title: (error as RequestError).message || '台板退分失败',
            icon: 'none',
          });
        } finally {
          wx.hideLoading();
        }
      },
    });
  },

  async loadPoolRounds() {
    if (!this.data.roomId) return;
    try {
      const res = await request<{ rounds: any[] }>({
        url: `/rooms/${this.data.roomId}/pool/rounds`,
        method: 'GET',
      });

      const members = this.data.members;
      const activeMemberIds = members.filter((m: any) => !m.isSpectator).map((m: any) => m.id);
      const poolStatsMembers = members
        .filter((m: any) => activeMemberIds.indexOf(m.id) >= 0)
        .map((m: any) => {
          const totalRounds = res.rounds.length;
          const wonRounds = res.rounds.filter((rd: any) => {
            const sc = rd.memberScores.find((s: any) => s.memberId === m.id);
            return sc && sc.score > 0;
          }).length;
          return {
            id: m.id,
            nickname: m.nickname,
            avatar: m.avatar,
            avatarInitials: m.avatarInitials,
            actorType: m.actorType || 'USER',
            winRate: totalRounds > 0 ? Math.round((wonRounds / totalRounds) * 100) + '%' : '0%',
          };
        });

      const poolRounds = res.rounds.map((rd: any) => {
        const memberScoreMap: Record<number, number> = {};
        rd.memberScores.forEach((s: any) => {
          memberScoreMap[s.memberId] = s.score;
        });
        const createdAt = new Date(rd.createdAt);
        const h = createdAt.getHours();
        const min = createdAt.getMinutes();
        const sec = createdAt.getSeconds();
        const timeText = `${h < 10 ? '0' + h : h}:${min < 10 ? '0' + min : min}:${sec < 10 ? '0' + sec : sec}`;
        return {
          id: rd.id,
          roundNumber: rd.roundNumber,
          poolBalance: rd.poolBalance,
          status: rd.status,
          timeText,
          memberScoreMap,
        };
      });

      this.setData({
        poolRounds,
        poolStatsMembers,
        poolStatsTableWidth: Math.max(690, 170 + poolStatsMembers.length * 112),
      });
    } catch (error) {
      // silent
    }
  },

  // ───────── 旁观者功能 ─────────

  openSpectatorDialog() {
    if (!this.data.isOwner) {
      wx.showToast({ title: '只有桌主可以管理旁观者', icon: 'none' });
      return;
    }

    if (this.data.roomStatus !== 'IN_PROGRESS') {
      wx.showToast({ title: '房间已结束，无法设置旁观者', icon: 'none' });
      return;
    }

    const candidates = this.data.members.map((member) => ({
      id: member.id,
      nickname: member.nickname,
      avatar: member.avatar,
      avatarInitials: member.avatarInitials,
      actorType: member.actorType || 'USER',
      isOwner: member.isOwner,
      isSpectator: Boolean(member.isSpectator),
      hasScoreActivity: Boolean(member.hasScoreActivity),
      disabled: member.isOwner || this.isTableMember(member),
      selected: Boolean(member.isSpectator),
    }));

    this.setData({
      spectatorDialogVisible: true,
      spectatorCandidates: candidates,
    });
  },

  closeSpectatorDialog() {
    this.setData({
      spectatorDialogVisible: false,
      spectatorCandidates: [],
    });
  },

  toggleSpectatorCandidate(e: any) {
    const memberId = Number(e.currentTarget.dataset.memberId || 0);
    const candidates = this.data.spectatorCandidates.map((candidate) => {
      if (candidate.id === memberId && !candidate.disabled) {
        return { ...candidate, selected: !candidate.selected };
      }
      return candidate;
    });
    this.setData({ spectatorCandidates: candidates });
  },

  async confirmSpectators() {
    const spectatorIds = this.data.spectatorCandidates
      .filter((candidate) => candidate.selected && !candidate.disabled)
      .map((candidate) => candidate.id);

    wx.showLoading({ title: '设置中...' });
    try {
      const payload = await setSpectators(this.data.roomId, spectatorIds);
      this.applyRoomPayload(payload);
      this.closeSpectatorDialog();
      wx.showToast({ title: '设置成功', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: (error as RequestError).message || '设置失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  formatTime(dateText: string): string {
    const date = new Date(dateText);
    if (Number.isNaN(date.getTime())) {
      return '';
    }

    const formatTwoDigits = (value: number): string => {
      if (value < 10) {
        return `0${value}`;
      }
      return `${value}`;
    };

    const month = formatTwoDigits(date.getMonth() + 1);
    const day = formatTwoDigits(date.getDate());
    const hour = formatTwoDigits(date.getHours());
    const minute = formatTwoDigits(date.getMinutes());

    return `${month}-${day} ${hour}:${minute}`;
  },

  redirectSharedInviteEntry(options: Record<string, string | undefined>) {
    const shareSource = String(options.shareSource || '').trim();
    const roomCode = String(options.roomCode || '').replace(/\D/g, '').slice(0, ROOM_CODE_LENGTH);
    if (!shareSource || roomCode.length !== ROOM_CODE_LENGTH) {
      return false;
    }

    const roomType = String(options.roomType || '').trim();
    const normalizedRoomType = roomType === 'SINGLE' || roomType === 'POOL' || roomType === 'MULTI'
      ? roomType
      : 'MULTI';

    wx.redirectTo({
      url: buildInviteEntryUrl({
        roomCode,
        inviterName: safeDecodeInviteParam(options.inviterName),
        roomName: safeDecodeInviteParam(options.roomName),
        roomType: normalizedRoomType as 'MULTI' | 'SINGLE' | 'POOL',
        shareSource,
      }),
    });
    return true;
  },

  onShareAppMessage() {
    const roomCode = this.data.roomCode;
    const roomName = this.data.roomName || `桌号 ${roomCode}`;
    const currentMember = (this.data.members as RoomMember[]).find(
      (member) => member.id === this.data.currentMemberId,
    );
    const inviterName = currentMember?.nickname || '好友';
    if (/^\d{6}$/.test(roomCode)) {
      return {
        title: `邀请你加入${roomName}`,
        path: buildInviteEntryUrl({
          roomCode,
          inviterName,
          roomName,
          roomType: this.data.roomType as 'MULTI' | 'SINGLE' | 'POOL',
          shareSource: 'app-message',
        }),
        imageUrl: SHARE_PROMO_IMAGE,
      };
    }

    return {
      title: '欢乐记分馆',
      path: '/pages/home/home',
      imageUrl: SHARE_PROMO_IMAGE,
    };
  },

  onShareTimeline() {
    const roomCode = this.data.roomCode;
    const roomName = this.data.roomName || `桌号 ${roomCode}`;
    const currentMember = (this.data.members as RoomMember[]).find(
      (member) => member.id === this.data.currentMemberId,
    );
    const inviterName = currentMember?.nickname || '好友';
    if (/^\d{6}$/.test(roomCode)) {
      return {
        title: `邀请你加入${roomName}`,
        query: `roomCode=${roomCode}&shareSource=timeline&roomType=${encodeURIComponent(this.data.roomType || 'MULTI')}&roomName=${encodeURIComponent(roomName)}&inviterName=${encodeURIComponent(inviterName)}`,
        imageUrl: SHARE_PROMO_IMAGE,
      };
    }

    return {
      title: '欢乐记分馆',
      query: '',
      imageUrl: SHARE_PROMO_IMAGE,
    };
  },
});
