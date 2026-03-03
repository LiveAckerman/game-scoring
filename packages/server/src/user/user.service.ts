import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { UpdateProfileDto } from './dto';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) { }

  /**
   * 根据 ID 获取用户信息
   */
  async findById(id: number): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }
    return user;
  }

  /**
   * 获取用户资料（含胜率计算）
   */
  async getProfile(userId: number) {
    const user = await this.findById(userId);
    const winRate = user.totalGames > 0
      ? Math.round((user.wins / user.totalGames) * 100)
      : 0;

    return {
      id: user.id,
      nickname: user.nickname,
      avatar: user.avatar,
      gender: user.gender,
      title: user.title,
      totalGames: user.totalGames,
      wins: user.wins,
      winRate: `${winRate}%`,
      createdAt: user.createdAt,
    };
  }

  /**
   * 更新用户资料
   */
  async updateProfile(userId: number, updateDto: UpdateProfileDto) {
    const user = await this.findById(userId);

    if (updateDto.nickname !== undefined) user.nickname = updateDto.nickname;
    if (updateDto.avatar !== undefined) user.avatar = updateDto.avatar;
    if (updateDto.gender !== undefined) user.gender = updateDto.gender;
    if (updateDto.title !== undefined) user.title = updateDto.title;

    await this.userRepository.save(user);

    return this.getProfile(userId);
  }
}
