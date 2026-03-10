import { Injectable } from '@nestjs/common';
import { VersionInfoDto } from './dto/version-info.dto';

const VERSION_HISTORY: VersionInfoDto['history'] = [
  {
    version: '1.2.0',
    releaseDate: '2026-03-10',
    title: '体验优化',
    changes: [
      '个人中心入口结构优化，常用功能更集中。',
      '新增联系客服、使用说明与版本信息入口。',
      '补充版本历史查看能力，便于排查线上版本差异。',
    ],
  },
  {
    version: '1.1.0',
    releaseDate: '2026-03-01',
    title: '玩法增强',
    changes: [
      '新增分数池桌、单人记分桌等玩法支持。',
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

@Injectable()
export class AppInfoService {
  getVersionInfo(): VersionInfoDto {
    return {
      latestVersion: VERSION_HISTORY[0]?.version || '1.0.0',
      history: VERSION_HISTORY,
    };
  }
}
