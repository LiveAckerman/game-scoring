import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class PoolGiveDto {
  @ApiProperty({ description: '给分分值', example: 20 })
  @IsInt()
  @Min(1)
  points: number;
}
