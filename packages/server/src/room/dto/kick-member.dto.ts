import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class KickMemberDto {
  @ApiProperty({ description: '被踢出的成员ID', example: 3 })
  @IsInt()
  @Min(1)
  targetMemberId: number;
}
