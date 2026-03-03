import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../user/entities/user.entity';

interface WxSessionResponse {
  openid: string;
  session_key: string;
  unionid?: string;
  errcode?: number;
  errmsg?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) { }

  /**
   * 微信登录
   * 1. 使用 code 换取 openid 和 session_key
   * 2. 查找或创建用户
   * 3. 签发 JWT Token
   */
  async wxLogin(code: string) {
    // 调用微信 code2Session 接口
    const wxSession = await this.code2Session(code);

    if (wxSession.errcode) {
      this.logger.error(
        `微信登录失败: ${wxSession.errcode} - ${wxSession.errmsg}`,
      );
      throw new UnauthorizedException(
        `微信登录失败: ${wxSession.errmsg || '未知错误'}`,
      );
    }

    const { openid, session_key } = wxSession;

    // 查找或创建用户
    let user = await this.userRepository.findOne({ where: { openid } });
    const isNewUser = !user;

    if (!user) {
      user = this.userRepository.create({
        openid,
        sessionKey: session_key,
        nickname: `玩家${Math.random().toString(36).substring(2, 8)}`,
      });
      await this.userRepository.save(user);
      this.logger.log(`新用户注册: ${user.id} (openid: ${openid})`);
    } else {
      // 更新 session_key
      user.sessionKey = session_key;
      await this.userRepository.save(user);
      this.logger.log(`用户登录: ${user.id} (openid: ${openid})`);
    }

    // 签发 JWT Token
    const payload = { sub: user.id, openid: user.openid };
    const token = this.jwtService.sign(payload);

    return {
      token,
      isNewUser,
      userInfo: {
        id: user.id,
        nickname: user.nickname,
        avatar: user.avatar,
        gender: user.gender,
        title: user.title,
        totalGames: user.totalGames,
        wins: user.wins,
      },
    };
  }

  /**
   * 调用微信 code2Session 接口
   */
  private async code2Session(code: string): Promise<WxSessionResponse> {
    const appid = this.configService.get<string>('WX_APPID');
    const secret = this.configService.get<string>('WX_SECRET');

    const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${appid}&secret=${secret}&js_code=${code}&grant_type=authorization_code`;

    try {
      const response = await fetch(url);
      const data = (await response.json()) as WxSessionResponse;
      return data;
    } catch (error) {
      this.logger.error('调用微信 code2Session 失败', error);
      throw new UnauthorizedException('微信服务请求失败，请稍后重试');
    }
  }

  /**
   * 验证 JWT payload，返回用户
   */
  async validateUser(payload: { sub: number; openid: string }): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id: payload.sub },
    });

    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }

    return user;
  }
}
