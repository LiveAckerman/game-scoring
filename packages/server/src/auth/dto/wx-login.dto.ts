import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class WxLoginDto {
  @ApiProperty({
    description: '微信小程序 wx.login() 获取的临时登录凭证 code',
    example: '0a1B2c3D4e5F6g',
  })
  @IsString()
  @IsNotEmpty({ message: 'code 不能为空' })
  code: string;
}
