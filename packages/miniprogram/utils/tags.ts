import { getGuestProfile } from './identity';

export interface RoomTag {
  id: string;
  name: string;
  color: string;
  createdAt: number;
  updatedAt: number;
}

const TAG_STORAGE_PREFIX = 'roomTags';
const ROOM_TAG_STORAGE_PREFIX = 'roomTagAssignments';

export const TAG_COLOR_PALETTE = [
  '#E63946',
  '#F4A261',
  '#2A9D8F',
  '#457B9D',
  '#B56D34',
  '#6B8E23',
  '#E76F51',
  '#8D6E63',
];

const buildScopeKey = (): string => {
  const token = wx.getStorageSync('token');
  const userInfo = wx.getStorageSync('userInfo') as { id?: number } | undefined;

  if (token && userInfo?.id) {
    return `user:${userInfo.id}`;
  }

  const guest = getGuestProfile();
  if (guest?.id) {
    return `guest:${guest.id}`;
  }

  return 'default';
};

const getTagStorageKey = (): string => `${TAG_STORAGE_PREFIX}:${buildScopeKey()}`;

const getRoomTagStorageKey = (): string => `${ROOM_TAG_STORAGE_PREFIX}:${buildScopeKey()}`;

const normalizeName = (name: string): string => {
  return String(name || '').trim().slice(0, 12);
};

const readTags = (): RoomTag[] => {
  const rawValue = wx.getStorageSync(getTagStorageKey());
  if (!Array.isArray(rawValue)) {
    return [];
  }

  return rawValue
    .filter((item) => item && typeof item === 'object' && item.id && item.name && item.color)
    .map((item) => item as RoomTag)
    .sort((left, right) => right.updatedAt - left.updatedAt);
};

const writeTags = (tags: RoomTag[]): void => {
  wx.setStorageSync(getTagStorageKey(), tags);
};

const readAssignments = (): Record<string, string[]> => {
  const rawValue = wx.getStorageSync(getRoomTagStorageKey());
  if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
    return {};
  }

  return rawValue as Record<string, string[]>;
};

const writeAssignments = (assignments: Record<string, string[]>): void => {
  wx.setStorageSync(getRoomTagStorageKey(), assignments);
};

export const listRoomTags = (): RoomTag[] => {
  return readTags();
};

export const createRoomTag = (name: string, color?: string): RoomTag => {
  const normalizedName = normalizeName(name);
  if (!normalizedName) {
    throw new Error('标签名不能为空');
  }

  const tags = readTags();
  if (tags.some((tag) => tag.name === normalizedName)) {
    throw new Error('标签名已存在');
  }

  const now = Date.now();
  const tag: RoomTag = {
    id: `tag_${now}_${Math.random().toString(36).slice(2, 8)}`,
    name: normalizedName,
    color: color || TAG_COLOR_PALETTE[tags.length % TAG_COLOR_PALETTE.length],
    createdAt: now,
    updatedAt: now,
  };

  writeTags([tag, ...tags]);
  return tag;
};

export const updateRoomTag = (
  tagId: string,
  patch: { name?: string; color?: string },
): RoomTag => {
  const tags = readTags();
  const tag = tags.find((item) => item.id === tagId);

  if (!tag) {
    throw new Error('标签不存在');
  }

  const nextName = patch.name === undefined ? tag.name : normalizeName(patch.name);
  if (!nextName) {
    throw new Error('标签名不能为空');
  }

  if (tags.some((item) => item.id !== tagId && item.name === nextName)) {
    throw new Error('标签名已存在');
  }

  const nextTag: RoomTag = {
    ...tag,
    name: nextName,
    color: patch.color || tag.color,
    updatedAt: Date.now(),
  };

  writeTags(tags.map((item) => (item.id === tagId ? nextTag : item)));
  return nextTag;
};

export const deleteRoomTag = (tagId: string): void => {
  writeTags(readTags().filter((tag) => tag.id !== tagId));

  const assignments = readAssignments();
  const nextAssignments: Record<string, string[]> = {};

  Object.keys(assignments).forEach((roomCode) => {
    const nextIds = (assignments[roomCode] || []).filter((item) => item !== tagId);
    if (nextIds.length > 0) {
      nextAssignments[roomCode] = nextIds;
    }
  });

  writeAssignments(nextAssignments);
};

export const getRoomTagIds = (roomCode: string): string[] => {
  return readAssignments()[roomCode] || [];
};

export const setRoomTagIds = (roomCode: string, tagIds: string[]): void => {
  const normalizedRoomCode = String(roomCode || '').trim();
  if (!normalizedRoomCode) {
    return;
  }

  const validTagIds = new Set(readTags().map((tag) => tag.id));
  const normalizedIds = [...new Set(tagIds)].filter((tagId) => validTagIds.has(tagId));
  const assignments = readAssignments();

  if (normalizedIds.length === 0) {
    delete assignments[normalizedRoomCode];
  } else {
    assignments[normalizedRoomCode] = normalizedIds;
  }

  writeAssignments(assignments);
};

export const getRoomTags = (roomCode: string): RoomTag[] => {
  const tags = readTags();
  const tagIds = new Set(getRoomTagIds(roomCode));
  return tags.filter((tag) => tagIds.has(tag.id));
};

export const buildRoomTagMap = (roomCodes: string[]): Record<string, RoomTag[]> => {
  const uniqueRoomCodes = [...new Set(roomCodes.filter(Boolean))];
  const tagMap: Record<string, RoomTag[]> = {};

  uniqueRoomCodes.forEach((roomCode) => {
    tagMap[roomCode] = getRoomTags(roomCode);
  });

  return tagMap;
};
