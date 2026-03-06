import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class ToggleTableFeeDto {
  @ApiProperty({ description: '是否开启台板', example: true })
  @IsBoolean()
  enabled: boolean;
}
