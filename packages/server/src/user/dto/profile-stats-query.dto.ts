import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export const PROFILE_STATS_SCOPE = {
  ALL: 'ALL',
  YEAR: 'YEAR',
  MONTH: 'MONTH',
} as const;

export type ProfileStatsScope =
  (typeof PROFILE_STATS_SCOPE)[keyof typeof PROFILE_STATS_SCOPE];

export class ProfileStatsQueryDto {
  @ApiPropertyOptional({
    description: '统计范围：全部 / 按年 / 按月',
    enum: PROFILE_STATS_SCOPE,
    default: PROFILE_STATS_SCOPE.ALL,
  })
  @IsOptional()
  @IsIn(Object.values(PROFILE_STATS_SCOPE), {
    message: 'scope 仅支持 ALL、YEAR、MONTH',
  })
  scope?: ProfileStatsScope;

  @ApiPropertyOptional({
    description: '统计年份，scope=YEAR 或 MONTH 时使用',
    example: 2026,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'year 必须为整数' })
  @Min(2000, { message: 'year 不能早于 2000' })
  @Max(2100, { message: 'year 不能晚于 2100' })
  year?: number;

  @ApiPropertyOptional({
    description: '统计月份，scope=MONTH 时使用',
    example: 3,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'month 必须为整数' })
  @Min(1, { message: 'month 不能小于 1' })
  @Max(12, { message: 'month 不能大于 12' })
  month?: number;
}
