import { ApiProperty } from '@nestjs/swagger';

export class LeaveRoomResponseDto {
  @ApiProperty({ description: '是否退出成功', example: true })
  success: boolean;
}
