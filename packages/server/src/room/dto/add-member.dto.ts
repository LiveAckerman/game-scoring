import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class AddMemberDto {
  @ApiProperty({ description: '成员昵称', example: '小明' })
  @IsString()
  @Length(1, 64)
  nickname: string;
}
