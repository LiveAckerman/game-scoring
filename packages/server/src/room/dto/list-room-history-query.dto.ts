import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListRoomHistoryQueryDto {
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
}
