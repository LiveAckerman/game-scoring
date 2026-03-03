import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber, IsIn, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  @ApiProperty({ description: '昵称', required: false, example: 'Lucky Dragon' })
  @IsString()
  @IsOptional()
  @MaxLength(64)
  nickname?: string;

  @ApiProperty({ description: '头像 URL', required: false })
  @IsString()
  @IsOptional()
  @MaxLength(512)
  avatar?: string;

  @ApiProperty({ description: '性别: 0-未知 1-男 2-女', required: false, example: 1 })
  @IsNumber()
  @IsOptional()
  @IsIn([0, 1, 2])
  gender?: number;

  @ApiProperty({ description: '称号', required: false, example: '小财神' })
  @IsString()
  @IsOptional()
  @MaxLength(32)
  title?: string;
}
