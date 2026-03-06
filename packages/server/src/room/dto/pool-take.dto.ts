import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class PoolTakeDto {
  @ApiProperty({ description: '取分分值', example: 10 })
  @IsInt()
  @Min(1)
  points: number;
}
