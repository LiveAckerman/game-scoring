import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class TransferOwnerDto {
  @ApiProperty({ description: '目标桌主成员ID', example: 3 })
  @IsInt()
  @Min(1)
  targetMemberId: number;
}
