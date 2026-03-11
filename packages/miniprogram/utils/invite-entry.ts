import { RoomType } from './room';

export interface InviteEntryParams {
  roomCode: string;
  inviterName?: string;
  roomName?: string;
  roomType?: RoomType;
  shareSource?: string;
}

const appendQueryParam = (pairs: string[], key: string, value?: string) => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return;
  }
  pairs.push(`${key}=${encodeURIComponent(normalized)}`);
};

export const buildInviteEntryUrl = (params: InviteEntryParams): string => {
  const roomCode = String(params.roomCode || '').replace(/\D/g, '').slice(0, 6);
  const query: string[] = [];

  appendQueryParam(query, 'roomCode', roomCode);
  appendQueryParam(query, 'inviterName', params.inviterName);
  appendQueryParam(query, 'roomName', params.roomName);
  appendQueryParam(query, 'roomType', params.roomType);
  appendQueryParam(query, 'shareSource', params.shareSource);

  return `/subpkg/invite-entry/invite-entry${query.length ? `?${query.join('&')}` : ''}`;
};

export const buildRoomPageUrl = (roomCodeRaw: string, roomType?: RoomType): string => {
  const roomCode = String(roomCodeRaw || '').replace(/\D/g, '').slice(0, 6);
  if (roomType === 'SINGLE') {
    return `/subpkg/single-score/single-score?roomCode=${roomCode}`;
  }
  return `/subpkg/multi-invite/multi-invite?roomCode=${roomCode}`;
};

export const safeDecodeInviteParam = (value?: string): string => {
  const rawValue = String(value || '');
  if (!rawValue) {
    return '';
  }

  try {
    return decodeURIComponent(rawValue);
  } catch (_error) {
    return rawValue;
  }
};
