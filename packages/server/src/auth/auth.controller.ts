import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { WxLoginDto, LoginResponseDto } from './dto';

@ApiTags('认证')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  @Post('wx-login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '微信登录',
    description:
      '使用微信小程序 wx.login() 获取的 code 进行登录，返回 JWT Token',
  })
  @ApiBody({ type: WxLoginDto })
  @ApiResponse({
    status: 200,
    description: '登录成功',
    type: LoginResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: '登录失败（code 无效或微信服务异常）',
  })
  async wxLogin(@Body() wxLoginDto: WxLoginDto) {
    return this.authService.wxLogin(wxLoginDto.code);
  }
}
