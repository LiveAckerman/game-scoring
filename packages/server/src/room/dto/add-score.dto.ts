import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min, Max } from 'class-validator';

export class AddScoreDto {
  @ApiProperty({ description: '收分方成员ID', example: 2 })
  @IsInt()
  @Min(1)
  toMemberId: number;

  @ApiProperty({ description: '分值（正整数）', example: 20 })
  @IsInt()
  @Min(1)
  @Max(999999)
  points: number;
}
