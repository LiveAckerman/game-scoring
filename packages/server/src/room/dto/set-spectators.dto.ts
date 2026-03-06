import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsInt } from 'class-validator';

export class SetSpectatorsDto {
  @ApiProperty({ description: '旁观者成员ID列表', example: [2, 3] })
  @IsArray()
  @IsInt({ each: true })
  memberIds: number[];
}
