import {
  Controller,
  Get,
  Put,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { UserService } from './user.service';
import { UpdateProfileDto } from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('用户')
@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) { }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: '获取用户资料',
    description: '获取当前登录用户的个人资料信息',
  })
  @ApiResponse({ status: 200, description: '获取成功' })
  @ApiResponse({ status: 401, description: '未登录' })
  async getProfile(@Request() req: any) {
    return this.userService.getProfile(req.user.id);
  }

  @Put('profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: '更新用户资料',
    description: '更新当前登录用户的昵称、头像、性别、称号等信息',
  })
  @ApiResponse({ status: 200, description: '更新成功' })
  @ApiResponse({ status: 401, description: '未登录' })
  async updateProfile(
    @Request() req: any,
    @Body() updateDto: UpdateProfileDto,
  ) {
    return this.userService.updateProfile(req.user.id, updateDto);
  }
}
