import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateRoomNameDto {
  @ApiPropertyOptional({
    description: '牌桌名称，留空时恢复默认桌号名称',
    example: '周末麻将局',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  roomName?: string;
}
