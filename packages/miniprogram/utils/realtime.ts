import { API_BASE_URL } from './request';

const stripApiSuffix = (url: string): string => {
  return url.replace(/\/api\/?$/, '');
};

const toWsBase = (url: string): string => {
  if (url.startsWith('https://')) {
    return `wss://${url.slice('https://'.length)}`;
  }

  if (url.startsWith('http://')) {
    return `ws://${url.slice('http://'.length)}`;
  }

  return url;
};

export const buildRoomRealtimeUrl = (roomCode: string): string => {
  const base = stripApiSuffix(API_BASE_URL);
  const wsBase = toWsBase(base);
  return `${wsBase}/ws?roomCode=${encodeURIComponent(roomCode)}`;
};
