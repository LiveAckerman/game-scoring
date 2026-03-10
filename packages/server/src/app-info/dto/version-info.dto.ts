import { ApiProperty } from '@nestjs/swagger';

export class VersionHistoryItemDto {
  @ApiProperty({ description: '版本号', example: '1.2.0' })
  version: string;

  @ApiProperty({ description: '发布日期', example: '2026-03-10' })
  releaseDate: string;

  @ApiProperty({ description: '版本标题', example: '体验优化' })
  title: string;

  @ApiProperty({
    description: '更新内容',
    example: ['个人中心入口结构优化，常用功能更集中。'],
    type: [String],
  })
  changes: string[];
}

export class VersionInfoDto {
  @ApiProperty({ description: '服务端最新版本号', example: '1.2.0' })
  latestVersion: string;

  @ApiProperty({ description: '版本历史', type: [VersionHistoryItemDto] })
  history: VersionHistoryItemDto[];
}
