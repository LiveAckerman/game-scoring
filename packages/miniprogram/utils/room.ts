import { request } from './request';

export type RoomStatus = 'IN_PROGRESS' | 'ENDED';
export type RoomType = 'MULTI' | 'SINGLE';
export type RoomActorType = 'USER' | 'GUEST';

export interface RoomMember {
  id: number;
  actorType: RoomActorType;
  actorRefId: number;
  role: 'OWNER' | 'MEMBER';
  isOwner: boolean;
  nickname: string;
  avatar: string;
  avatarInitials: string;
  score: number;
  inviteCardHidden: boolean;
  joinedAt: string;
}

export interface RoomScoreRecord {
  id: number;
  fromMemberId: number;
  toMemberId: number;
  fromMemberName: string;
  toMemberName: string;
  points: number;
  createdByMemberId: number;
  createdAt: string;
}

export interface RoomData {
  id: number;
  roomCode: string;
  roomName: string;
  roomType: RoomType;
  status: RoomStatus;
  ownerMemberId: number | null;
  members: RoomMember[];
  scoreRecords: RoomScoreRecord[];
  createdAt: string;
  endedAt: string | null;
}

export interface RoomActor {
  type: RoomActorType;
  id: number;
  nickname: string;
  avatarInitials: string;
  guestToken?: string;
}

export interface RoomPayload {
  room: RoomData;
  currentMemberId: number | null;
  actor: RoomActor;
}

export interface HistoryMember {
  id: number;
  nickname: string;
  avatar: string;
  avatarInitials: string;
  score: number;
  isOwner: boolean;
}

export interface RoomHistoryItem {
  roomId: number;
  roomCode: string;
  roomName: string;
  roomType: RoomType;
  status: RoomStatus;
  ownerMemberId: number | null;
  startedAt: string;
  endedAt: string | null;
  durationMinutes: number;
  memberCount: number;
  myScore: number;
  scoreRecordCount: number;
  members: HistoryMember[];
}

export interface RoomHistorySummary {
  totalGames: number;
  winRounds: number;
  loseRounds: number;
  drawRounds: number;
  totalWinPoints: number;
  totalLosePoints: number;
  totalScore: number;
}

export interface RoomHistoryPayload {
  summary: RoomHistorySummary;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  items: RoomHistoryItem[];
}

interface GuestBody {
  guestNickname?: string;
}

interface CreateRoomBody extends GuestBody {
  roomName?: string;
  roomType?: RoomType;
}

const buildGuestBody = (guestNickname?: string): GuestBody | undefined => {
  if (!guestNickname) {
    return undefined;
  }
  return { guestNickname };
};

const buildCreateRoomBody = (
  guestNickname?: string,
  roomName?: string,
  roomType?: RoomType,
): CreateRoomBody => {
  const body: CreateRoomBody = {};

  const nicknameValue = (guestNickname || '').trim();
  if (nicknameValue) {
    body.guestNickname = nicknameValue;
  }

  const roomNameValue = (roomName || '').trim();
  if (roomNameValue) {
    body.roomName = roomNameValue;
  }

  if (roomType) {
    body.roomType = roomType;
  }

  return body;
};

export const createRoom = (
  guestNickname?: string,
  roomName?: string,
  roomType?: RoomType,
): Promise<RoomPayload> => {
  return request<RoomPayload>({
    url: '/rooms',
    method: 'POST',
    data: buildCreateRoomBody(guestNickname, roomName, roomType),
  });
};

export const joinRoom = (
  roomCode: string,
  guestNickname?: string,
): Promise<RoomPayload> => {
  return request<RoomPayload>({
    url: '/rooms/join',
    method: 'POST',
    data: {
      roomCode,
      ...buildGuestBody(guestNickname),
    },
  });
};

export const getRoomByCode = (roomCode: string): Promise<RoomPayload> => {
  return request<RoomPayload>({
    url: `/rooms/code/${roomCode}`,
    method: 'GET',
  });
};

export const addRoomScore = (
  roomId: number,
  toMemberId: number,
  points: number,
  fromMemberId?: number,
): Promise<RoomPayload> => {
  const data: { toMemberId: number; points: number; fromMemberId?: number } = {
    toMemberId,
    points,
  };
  if (fromMemberId) {
    data.fromMemberId = fromMemberId;
  }
  return request<RoomPayload>({
    url: `/rooms/${roomId}/score`,
    method: 'POST',
    data,
  });
};

export const addRoomMember = (
  roomId: number,
  nickname: string,
): Promise<RoomPayload> => {
  return request<RoomPayload>({
    url: `/rooms/${roomId}/members`,
    method: 'POST',
    data: { nickname },
  });
};

export const transferRoomOwner = (
  roomId: number,
  targetMemberId: number,
): Promise<RoomPayload> => {
  return request<RoomPayload>({
    url: `/rooms/${roomId}/transfer-owner`,
    method: 'POST',
    data: {
      targetMemberId,
    },
  });
};

export const endRoom = (roomId: number): Promise<RoomPayload> => {
  return request<RoomPayload>({
    url: `/rooms/${roomId}/end`,
    method: 'POST',
  });
};

export const hideRoomInviteCard = (roomId: number): Promise<RoomPayload> => {
  return request<RoomPayload>({
    url: `/rooms/${roomId}/invite-card/hide`,
    method: 'POST',
  });
};

export const getRoomHistory = (params?: {
  page?: number;
  pageSize?: number;
  status?: 'ALL' | RoomStatus;
}): Promise<RoomHistoryPayload> => {
  const page = params?.page || 1;
  const pageSize = params?.pageSize || 20;
  const status = params?.status || 'ALL';

  return request<RoomHistoryPayload>({
    url: `/rooms/history?page=${page}&pageSize=${pageSize}&status=${status}`,
    method: 'GET',
  });
};
