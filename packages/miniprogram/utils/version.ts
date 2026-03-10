import { request } from './request';

export interface VersionHistoryItem {
  version: string;
  releaseDate: string;
  title: string;
  changes: string[];
}

export interface VersionInfoResponse {
  latestVersion: string;
  history: VersionHistoryItem[];
}

type EnvVersion = 'develop' | 'trial' | 'release' | 'unknown';

const ENV_LABELS: Record<EnvVersion, string> = {
  develop: '开发版',
  trial: '体验版',
  release: '正式版',
  unknown: '未知环境',
};

export const FALLBACK_VERSION_HISTORY: VersionHistoryItem[] = [
  {
    version: '1.2.0',
    releaseDate: '2026-03-10',
    title: '体验优化',
    changes: [
      '个人中心入口结构优化，常用功能更集中。',
      '新增联系客服与使用说明页，补充常见问题指引。',
      '支持版本信息查看，方便核对当前版本与更新记录。',
    ],
  },
  {
    version: '1.1.0',
    releaseDate: '2026-03-01',
    title: '玩法增强',
    changes: [
      '补充分数池桌、单人记分桌等玩法支持。',
      '优化牌桌交互与记分流程，提升多人协作体验。',
    ],
  },
  {
    version: '1.0.0',
    releaseDate: '2026-02-20',
    title: '首个正式版本',
    changes: [
      '提供多人计分、战绩榜、个人中心等核心功能。',
      '支持游客体验与微信登录后的基础数据同步。',
    ],
  },
];

const readRuntimeVersion = (): { version: string; envVersion: EnvVersion } => {
  const fallbackVersion = FALLBACK_VERSION_HISTORY[0]?.version || '1.0.0';

  try {
    const accountInfo = wx.getAccountInfoSync ? wx.getAccountInfoSync() : null;
    const miniProgram = (accountInfo as { miniProgram?: { version?: string; envVersion?: string } } | null)?.miniProgram;
    const version = String(miniProgram?.version || '').trim() || fallbackVersion;
    const envVersion = String(miniProgram?.envVersion || '').trim() as EnvVersion;

    return {
      version,
      envVersion: ENV_LABELS[envVersion] ? envVersion : 'unknown',
    };
  } catch (_error) {
    return {
      version: fallbackVersion,
      envVersion: 'unknown',
    };
  }
};

export const getVersionPageState = () => {
  const runtime = readRuntimeVersion();
  return {
    currentVersion: runtime.version,
    envVersion: runtime.envVersion,
    envVersionLabel: ENV_LABELS[runtime.envVersion],
    latestVersion: FALLBACK_VERSION_HISTORY[0]?.version || runtime.version,
    history: FALLBACK_VERSION_HISTORY,
  };
};

export const getVersionSummary = (): string => {
  const versionState = getVersionPageState();
  return `v${versionState.currentVersion} · ${versionState.envVersionLabel}`;
};

export const fetchVersionInfo = async (): Promise<VersionInfoResponse> => {
  const response = await request<VersionInfoResponse>({
    url: '/app/version-info',
  });

  return {
    latestVersion: response.latestVersion || FALLBACK_VERSION_HISTORY[0]?.version || '1.0.0',
    history: Array.isArray(response.history) && response.history.length > 0
      ? response.history
      : FALLBACK_VERSION_HISTORY,
  };
};
