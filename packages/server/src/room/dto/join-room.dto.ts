import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class JoinRoomDto {
  @ApiProperty({ description: '6位房间号', example: '123456' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'roomCode 必须是6位数字' })
  roomCode: string;

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
