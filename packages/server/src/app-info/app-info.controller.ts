import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AppInfoService } from './app-info.service';
import { VersionInfoDto } from './dto/version-info.dto';

@ApiTags('应用')
@Controller({ path: 'app', version: '1' })
export class AppInfoController {
  constructor(private readonly appInfoService: AppInfoService) {}

  @Get('version-info')
  @ApiOperation({ summary: '获取版本信息', description: '返回当前小程序版本历史与最新版本信息' })
  @ApiResponse({ status: 200, description: '获取成功', type: VersionInfoDto })
  getVersionInfo() {
    return this.appInfoService.getVersionInfo();
  }
}
