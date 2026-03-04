import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { GuestUser } from './entities/guest-user.entity';

@Injectable()
export class GuestService {
  constructor(
    @InjectRepository(GuestUser)
    private readonly guestRepository: Repository<GuestUser>,
  ) { }

  async createSession(nickname: string, token?: string): Promise<GuestUser> {
    const normalizedName = this.normalizeNickname(nickname);

    if (token) {
      const existingGuest = await this.guestRepository.findOne({
        where: { token },
      });

      if (existingGuest) {
        existingGuest.nickname = normalizedName;
        existingGuest.avatarInitials = this.buildInitials(normalizedName);
        return this.guestRepository.save(existingGuest);
      }
    }

    const guest = this.guestRepository.create({
      token: await this.generateUniqueToken(),
      nickname: normalizedName,
      avatarInitials: this.buildInitials(normalizedName),
      isActive: true,
    });

    return this.guestRepository.save(guest);
  }

  async findByToken(token: string): Promise<GuestUser | null> {
    if (!token) {
      return null;
    }

    return this.guestRepository.findOne({
      where: { token, isActive: true },
    });
  }

  async getByTokenOrFail(token: string): Promise<GuestUser> {
    const guest = await this.findByToken(token);
    if (!guest) {
      throw new UnauthorizedException('游客身份无效，请重新输入昵称加入房间');
    }
    return guest;
  }

  normalizeNickname(nickname: string): string {
    const value = (nickname || '').trim();
    if (!value) {
      return '游客';
    }
    return value.slice(0, 64);
  }

  buildInitials(nickname: string): string {
    const pureName = nickname.replace(/\s+/g, '');
    const chars = [...pureName];

    if (chars.length === 0) {
      return '游客';
    }

    if (chars.length === 1) {
      return chars[0].toUpperCase();
    }

    return `${chars[0]}${chars[1]}`.toUpperCase();
  }

  private async generateUniqueToken(): Promise<string> {
    for (let index = 0; index < 8; index += 1) {
      const token = `gst_${randomBytes(24).toString('hex')}`;
      const exists = await this.guestRepository.exist({ where: { token } });
      if (!exists) {
        return token;
      }
    }

    throw new Error('生成游客 Token 失败，请重试');
  }
}
