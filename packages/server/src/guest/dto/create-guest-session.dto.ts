import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateGuestSessionDto {
  @ApiProperty({ description: '游客昵称', example: '路人甲' })
  @IsString()
  @IsNotEmpty({ message: 'nickname 不能为空' })
  @MaxLength(64)
  nickname: string;
}
