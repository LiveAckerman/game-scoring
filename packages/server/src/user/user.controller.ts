import {
  Controller,
  Get,
  Headers,
  Put,
  Post,
  Query,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { UserService } from './user.service';
import { UpdateProfileDto } from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

const UPLOAD_DIR = join(process.cwd(), 'uploads', 'avatars');
if (!existsSync(UPLOAD_DIR)) {
  mkdirSync(UPLOAD_DIR, { recursive: true });
}

@ApiTags('用户')
@Controller({ path: 'user', version: '1' })
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

  @Post('avatar')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: UPLOAD_DIR,
        filename: (_req, file, cb) => {
          const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          const ext = extname(file.originalname) || '.png';
          cb(null, `avatar-${uniqueSuffix}${ext}`);
        },
      }),
      limits: { fileSize: 2 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.match(/^image\/(jpeg|png|gif|webp)$/)) {
          cb(new BadRequestException('仅支持 jpg/png/gif/webp 图片'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  @ApiOperation({ summary: '上传头像', description: '上传用户头像图片，返回可访问的 URL' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiResponse({ status: 201, description: '上传成功' })
  async uploadAvatar(
    @Request() req: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('请选择要上传的头像文件');
    }
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const url = `${protocol}://${host}/uploads/avatars/${file.filename}`;
    return { url };
  }

  @Get('leaderboard')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: '战绩排行榜', description: '获取与当前用户同场对局过的所有玩家的排行' })
  @ApiResponse({ status: 200, description: '获取成功' })
  async getLeaderboard(
    @Request() req: any,
    @Query('sort') sort: string,
  ) {
    return this.userService.getLeaderboard(req.user.id, sort || 'score');
  }

  @Get('check-guest-data')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: '检查游客数据', description: '检查当前设备是否有可恢复的游客对局数据' })
  @ApiResponse({ status: 200, description: '检查成功' })
  async checkGuestData(
    @Request() req: any,
    @Headers('x-guest-token') guestToken?: string,
    @Headers('x-device-id') deviceId?: string,
  ) {
    return this.userService.checkGuestData(req.user.id, guestToken, deviceId);
  }

  @Post('restore-guest-data')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: '恢复游客数据', description: '将游客对局数据导入到当前登录账号' })
  @ApiResponse({ status: 200, description: '恢复成功' })
  async restoreGuestData(
    @Request() req: any,
    @Headers('x-guest-token') guestToken?: string,
    @Headers('x-device-id') deviceId?: string,
  ) {
    return this.userService.restoreGuestData(req.user.id, guestToken, deviceId);
  }
}
