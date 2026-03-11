import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class ToggleSelfSpectatorDto {
  @ApiProperty({ description: '是否将当前成员设为旁观者', example: true })
  @IsBoolean()
  spectator: boolean;
}
