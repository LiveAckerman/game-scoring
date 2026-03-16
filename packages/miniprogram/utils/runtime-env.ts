export type RuntimeEnvVersion = 'develop' | 'trial' | 'release' | 'unknown';

export const ENV_LABELS: Record<RuntimeEnvVersion, string> = {
  develop: '开发版',
  trial: '体验版',
  release: '正式版',
  unknown: '未知环境',
};

export const readRuntimeEnvVersion = (): RuntimeEnvVersion => {
  try {
    const accountInfo = wx.getAccountInfoSync ? wx.getAccountInfoSync() : null;
    const miniProgram = (accountInfo as { miniProgram?: { envVersion?: string } } | null)?.miniProgram;
    const envVersion = String(miniProgram?.envVersion || '').trim() as RuntimeEnvVersion;
    return ENV_LABELS[envVersion] ? envVersion : 'unknown';
  } catch (_error) {
    return 'unknown';
  }
};
