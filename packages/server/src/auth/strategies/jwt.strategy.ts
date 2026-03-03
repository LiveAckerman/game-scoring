import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>(
        'JWT_SECRET',
        'happy-score-hall-jwt-secret-dev',
      ),
    });
  }

  async validate(payload: { sub: number; openid: string }) {
    const user = await this.authService.validateUser(payload);
    if (!user) {
      throw new UnauthorizedException('用户认证失败');
    }
    return user;
  }
}
