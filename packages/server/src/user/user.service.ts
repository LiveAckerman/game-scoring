import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { User } from './entities/user.entity';
import { RoomMember, ROOM_ACTOR_TYPE } from '../room/entities/room-member.entity';
import { UpdateProfileDto } from './dto';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly dataSource: DataSource,
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

  /**
   * 战绩排行榜：所有与当前用户同房间对局过的玩家排行
   */
  async getLeaderboard(userId: number, sort: string) {
    const memberRepo = this.dataSource.getRepository(RoomMember);

    const myRoomIds = await memberRepo
      .createQueryBuilder('m')
      .select('DISTINCT m.roomId', 'roomId')
      .where('m.actorType = :type AND m.actorRefId = :uid', {
        type: ROOM_ACTOR_TYPE.USER,
        uid: userId,
      })
      .getRawMany();

    if (!myRoomIds.length) return [];

    const roomIds = myRoomIds.map((r) => r.roomId);

    const peers = await memberRepo
      .createQueryBuilder('m')
      .select([
        'm.actorType AS actorType',
        'm.actorRefId AS actorRefId',
        'MAX(m.nickname) AS nickname',
        'MAX(m.avatar) AS avatar',
        'COUNT(DISTINCT m.roomId) AS totalGames',
        'SUM(CASE WHEN m.score > 0 THEN 1 ELSE 0 END) AS wins',
      ])
      .where('m.roomId IN (:...roomIds)', { roomIds })
      .andWhere('m.actorType IN (:...types)', {
        types: [ROOM_ACTOR_TYPE.USER, ROOM_ACTOR_TYPE.GUEST],
      })
      .groupBy('m.actorType')
      .addGroupBy('m.actorRefId')
      .getRawMany();

    const result = peers.map((p) => {
      const total = parseInt(p.totalGames) || 0;
      const w = parseInt(p.wins) || 0;
      return {
        id: `${p.actorType}_${p.actorRefId}`,
        actorType: p.actorType,
        userId: p.actorRefId,
        nickname: p.nickname,
        avatar: p.avatar || '',
        totalGames: total,
        wins: w,
        winRate: total > 0 ? `${Math.round((w / total) * 100)}%` : '0%',
      };
    });

    if (sort === 'winRate') {
      result.sort((a, b) => parseFloat(b.winRate) - parseFloat(a.winRate));
    } else if (sort === 'games') {
      result.sort((a, b) => b.totalGames - a.totalGames);
    } else {
      result.sort((a, b) => b.wins - a.wins || b.totalGames - a.totalGames);
    }

    return result.slice(0, 20);
  }

  /**
   * 检查是否有可恢复的游客数据
   */
  async checkGuestData(userId: number) {
    const memberRepo = this.dataSource.getRepository(RoomMember);

    const user = await this.findById(userId);
    const guestCount = await memberRepo
      .createQueryBuilder('m')
      .where('m.actorType = :type', { type: ROOM_ACTOR_TYPE.GUEST })
      .getCount();

    return {
      hasData: guestCount > 0,
      guestGames: guestCount,
    };
  }

  /**
   * 恢复游客数据到当前登录账号（将 GUEST 类型的成员记录迁移为 USER）
   */
  async restoreGuestData(userId: number) {
    const memberRepo = this.dataSource.getRepository(RoomMember);
    const user = await this.findById(userId);

    const result = await memberRepo
      .createQueryBuilder()
      .update(RoomMember)
      .set({
        actorType: ROOM_ACTOR_TYPE.USER,
        actorRefId: userId,
        nickname: user.nickname || '已恢复玩家',
        avatar: user.avatar || '',
      })
      .where('actorType = :type', { type: ROOM_ACTOR_TYPE.GUEST })
      .execute();

    const migratedCount = result.affected || 0;

    if (migratedCount > 0) {
      user.totalGames = (user.totalGames || 0) + migratedCount;
      await this.userRepository.save(user);
    }

    return { migrated: migratedCount };
  }
}
