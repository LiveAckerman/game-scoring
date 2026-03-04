import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateRoomDto {
  @ApiProperty({
    description: '房间名称（可选）',
    required: false,
    example: '今晚斗地主',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  roomName?: string;

  @ApiProperty({
    description: '游客昵称（未登录时必填）',
    required: false,
    example: '路人甲',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  guestNickname?: string;
}
