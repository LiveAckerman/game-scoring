import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListRoomHistoryQueryDto {
  @ApiPropertyOptional({
    description: '是否启用分页，默认 true；传 false 时返回全部符合条件的数据',
    example: true,
    default: true,
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') {
      return true;
    }
    if (typeof value === 'boolean') {
      return value;
    }
    return String(value).toLowerCase() !== 'false';
  })
  @IsBoolean()
  paginate?: boolean;

  @ApiPropertyOptional({ description: '页码，从1开始', example: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: '每页数量', example: 20, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @ApiPropertyOptional({
    description: '状态筛选',
    enum: ['ALL', 'IN_PROGRESS', 'ENDED'],
    default: 'ALL',
  })
  @IsOptional()
  @Transform(({ value }) => String(value || 'ALL').toUpperCase())
  @IsIn(['ALL', 'IN_PROGRESS', 'ENDED'])
  status?: 'ALL' | 'IN_PROGRESS' | 'ENDED';

  @ApiPropertyOptional({
    description: '房间类型筛选',
    enum: ['MULTI', 'SINGLE', 'POOL'],
  })
  @IsOptional()
  @Transform(({ value }) => (value ? String(value).toUpperCase() : undefined))
  @IsIn(['MULTI', 'SINGLE', 'POOL'])
  roomType?: 'MULTI' | 'SINGLE' | 'POOL';
}
