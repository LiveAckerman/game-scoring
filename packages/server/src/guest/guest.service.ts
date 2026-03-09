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

  async createSession(nickname: string, deviceId?: string, token?: string): Promise<GuestUser> {
    const normalizedName = this.normalizeNickname(nickname);
    const normalizedDeviceId = this.normalizeDeviceId(deviceId);

    if (token) {
      const existingGuest = await this.findByToken(token, normalizedDeviceId);

      if (existingGuest) {
        existingGuest.nickname = normalizedName;
        existingGuest.avatarInitials = this.buildInitials(normalizedName);
        if (normalizedDeviceId && existingGuest.deviceId !== normalizedDeviceId) {
          existingGuest.deviceId = normalizedDeviceId;
        }
        return this.guestRepository.save(existingGuest);
      }
    }

    const guest = this.guestRepository.create({
      token: await this.generateUniqueToken(),
      deviceId: normalizedDeviceId,
      nickname: normalizedName,
      avatarInitials: this.buildInitials(normalizedName),
      isActive: true,
    });

    return this.guestRepository.save(guest);
  }

  async findByToken(token: string, deviceId?: string): Promise<GuestUser | null> {
    if (!token) {
      return null;
    }

    const normalizedDeviceId = this.normalizeDeviceId(deviceId);
    const guest = await this.guestRepository.findOne({
      where: { token, isActive: true },
    });

    if (!guest) {
      return null;
    }

    if (guest.deviceId) {
      return normalizedDeviceId && guest.deviceId === normalizedDeviceId ? guest : null;
    }

    if (!normalizedDeviceId) {
      return guest;
    }

    guest.deviceId = normalizedDeviceId;
    await this.guestRepository.save(guest);
    return guest;
  }

  async getByTokenOrFail(token: string, deviceId?: string): Promise<GuestUser> {
    const guest = await this.findByToken(token, deviceId);
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

  normalizeDeviceId(deviceId?: string): string {
    return String(deviceId || '').trim().slice(0, 80);
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
