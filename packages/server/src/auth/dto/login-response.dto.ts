import { ApiProperty } from '@nestjs/swagger';

export class LoginResponseDto {
  @ApiProperty({ description: 'JWT 访问令牌' })
  token: string;

  @ApiProperty({ description: '是否为新用户' })
  isNewUser: boolean;

  @ApiProperty({ description: '用户信息' })
  userInfo: {
    id: number;
    nickname: string;
    avatar: string;
    gender: number;
    title: string;
    totalGames: number;
    wins: number;
  };
}
