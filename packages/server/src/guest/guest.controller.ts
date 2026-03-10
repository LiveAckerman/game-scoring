import { Body, Controller, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBody, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { GuestService } from './guest.service';
import { CreateGuestSessionDto } from './dto';

@ApiTags('游客')
@Controller({ path: 'guest', version: '1' })
export class GuestController {
  constructor(private readonly guestService: GuestService) { }

  @Post('session')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '创建或刷新游客会话' })
  @ApiHeader({
    name: 'x-guest-token',
    required: false,
    description: '游客会话Token，传入后会复用并更新昵称',
  })
  @ApiHeader({
    name: 'x-device-id',
    required: false,
    description: '设备标识，用于隔离当前设备的游客身份',
  })
  @ApiBody({ type: CreateGuestSessionDto })
  @ApiResponse({ status: 200, description: '会话创建成功' })
  async createSession(
    @Body() dto: CreateGuestSessionDto,
    @Headers('x-guest-token') token?: string,
    @Headers('x-device-id') deviceId?: string,
  ) {
    const guest = await this.guestService.createSession(dto.nickname, deviceId, token);

    return {
      guestToken: guest.token,
      user: {
        id: guest.id,
        type: 'GUEST',
        nickname: guest.nickname,
        avatarInitials: guest.avatarInitials,
      },
    };
  }
}
