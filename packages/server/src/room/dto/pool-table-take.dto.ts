import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class PoolTableTakeDto {
  @ApiProperty({ description: '台板取分分值', example: 2 })
  @IsInt()
  @Min(1)
  points: number;
}
