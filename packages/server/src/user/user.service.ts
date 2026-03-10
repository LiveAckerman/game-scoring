import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { User } from './entities/user.entity';
import { RoomMember, ROOM_ACTOR_TYPE } from '../room/entities/room-member.entity';
import { GuestUser } from '../guest/entities/guest-user.entity';
import { PoolRecord, Room, RoomScoreRecord } from '../room/entities';
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
    const { totalGames, wins } = await this.buildProfileStats(userId);
    const winRate = totalGames > 0
      ? Math.round((wins / totalGames) * 100)
      : 0;

    return {
      id: user.id,
      nickname: user.nickname,
      avatar: user.avatar,
      gender: user.gender,
      title: user.title,
      totalGames,
      wins,
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
  async checkGuestData(userId: number, guestToken?: string, deviceId?: string) {
    const memberRepo = this.dataSource.getRepository(RoomMember);
    await this.findById(userId);

    const guest = await this.findRestorableGuest(userId, guestToken, deviceId);
    if (!guest) {
      return {
        hasData: false,
        guestGames: 0,
      };
    }

    const rawCount = await memberRepo
      .createQueryBuilder('m')
      .select('COUNT(DISTINCT m.roomId)', 'roomCount')
      .where('m.actorType = :type', { type: ROOM_ACTOR_TYPE.GUEST })
      .andWhere('m.actorRefId = :guestId', { guestId: guest.id })
      .getRawOne<{ roomCount: string }>();
    const guestGames = Number(rawCount?.roomCount || 0);

    return {
      hasData: guestGames > 0,
      guestGames,
    };
  }

  /**
   * 恢复游客数据到当前登录账号（将 GUEST 类型的成员记录迁移为 USER）
   */
  async restoreGuestData(userId: number, guestToken?: string, deviceId?: string) {
    const memberRepo = this.dataSource.getRepository(RoomMember);
    const guestRepo = this.dataSource.getRepository(GuestUser);
    const user = await this.findById(userId);
    const guest = await this.findRestorableGuest(userId, guestToken, deviceId);

    if (!guest) {
      return { migrated: 0 };
    }

    const guestMembers = await memberRepo.find({
      where: {
        actorType: ROOM_ACTOR_TYPE.GUEST,
        actorRefId: guest.id,
      },
      order: { roomId: 'ASC', id: 'ASC' },
    });

    if (guestMembers.length === 0) {
      guest.isActive = false;
      await guestRepo.save(guest);
      return { migrated: 0 };
    }

    const nextNickname = user.nickname || '已恢复玩家';
    const nextInitials = this.buildInitials(nextNickname);
    const roomIdSet = new Set<number>();

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      for (const guestMember of guestMembers) {
        roomIdSet.add(guestMember.roomId);

        const existingUserMember = await queryRunner.manager.findOne(RoomMember, {
          where: {
            roomId: guestMember.roomId,
            actorType: ROOM_ACTOR_TYPE.USER,
            actorRefId: userId,
          },
        });

        if (existingUserMember) {
          existingUserMember.score += guestMember.score;
          existingUserMember.nickname = nextNickname;
          existingUserMember.avatar = user.avatar || '';
          existingUserMember.avatarInitials = nextInitials;
          existingUserMember.isActive = existingUserMember.isActive || guestMember.isActive;
          existingUserMember.inviteCardHidden =
            existingUserMember.inviteCardHidden && guestMember.inviteCardHidden;
          existingUserMember.isSpectator = existingUserMember.isSpectator || guestMember.isSpectator;
          await queryRunner.manager.save(existingUserMember);

          await queryRunner.manager
            .createQueryBuilder()
            .update(RoomScoreRecord)
            .set({ fromMemberId: existingUserMember.id })
            .where('fromMemberId = :memberId', { memberId: guestMember.id })
            .execute();

          await queryRunner.manager
            .createQueryBuilder()
            .update(RoomScoreRecord)
            .set({ toMemberId: existingUserMember.id })
            .where('toMemberId = :memberId', { memberId: guestMember.id })
            .execute();

          await queryRunner.manager
            .createQueryBuilder()
            .update(RoomScoreRecord)
            .set({ createdByMemberId: existingUserMember.id })
            .where('createdByMemberId = :memberId', { memberId: guestMember.id })
            .execute();

          await queryRunner.manager
            .createQueryBuilder()
            .update(PoolRecord)
            .set({ memberId: existingUserMember.id })
            .where('memberId = :memberId', { memberId: guestMember.id })
            .execute();

          await queryRunner.manager
            .createQueryBuilder()
            .update(Room)
            .set({ ownerMemberId: existingUserMember.id })
            .where('ownerMemberId = :memberId', { memberId: guestMember.id })
            .execute();

          await queryRunner.manager.remove(guestMember);
          continue;
        }

        guestMember.actorType = ROOM_ACTOR_TYPE.USER;
        guestMember.actorRefId = userId;
        guestMember.nickname = nextNickname;
        guestMember.avatar = user.avatar || '';
        guestMember.avatarInitials = nextInitials;
        await queryRunner.manager.save(guestMember);
      }

      await queryRunner.manager
        .createQueryBuilder()
        .update(Room)
        .set({
          createdByType: ROOM_ACTOR_TYPE.USER,
          createdByRefId: userId,
        })
        .where('createdByType = :actorType', { actorType: ROOM_ACTOR_TYPE.GUEST })
        .andWhere('createdByRefId = :guestId', { guestId: guest.id })
        .execute();

      guest.isActive = false;
      await queryRunner.manager.save(guest);

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }

    return { migrated: roomIdSet.size };
  }

  private async findRestorableGuest(
    userId: number,
    guestToken?: string,
    deviceId?: string,
  ): Promise<GuestUser | null> {
    const normalizedDeviceId = String(deviceId || '').trim();
    const normalizedToken = String(guestToken || '').trim();
    const guestRepo = this.dataSource.getRepository(GuestUser);
    const memberRepo = this.dataSource.getRepository(RoomMember);

    if (normalizedDeviceId) {
      const deviceGuests = await guestRepo.find({
        where: {
          deviceId: normalizedDeviceId,
          isActive: true,
        },
        order: { updatedAt: 'DESC', id: 'DESC' },
      });

      if (deviceGuests.length > 0) {
        if (normalizedToken) {
          const exactGuest = deviceGuests.find((guest) => guest.token === normalizedToken);
          if (exactGuest) {
            return exactGuest;
          }
        }

        for (const guest of deviceGuests) {
          const hasGuestMembership = await memberRepo.exist({
            where: {
              actorType: ROOM_ACTOR_TYPE.GUEST,
              actorRefId: guest.id,
            },
          });

          if (hasGuestMembership) {
            return guest;
          }
        }

        return deviceGuests[0];
      }
    }

    return this.findGuestByToken(guestToken, deviceId);
  }

  private async findGuestByToken(guestToken?: string, deviceId?: string): Promise<GuestUser | null> {
    const normalizedToken = String(guestToken || '').trim();
    const normalizedDeviceId = String(deviceId || '').trim();
    if (!normalizedToken) {
      return null;
    }

    const guestRepo = this.dataSource.getRepository(GuestUser);
    const guest = await guestRepo.findOne({
      where: {
        token: normalizedToken,
        isActive: true,
      },
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
    await guestRepo.save(guest);
    return guest;
  }

  private buildInitials(name: string): string {
    const normalizedName = String(name || '').trim();
    if (!normalizedName) {
      return '游客';
    }

    return normalizedName.slice(0, 2);
  }

  private async buildProfileStats(userId: number): Promise<{ totalGames: number; wins: number }> {
    const memberships = await this.dataSource.getRepository(RoomMember).find({
      where: {
        actorType: ROOM_ACTOR_TYPE.USER,
        actorRefId: userId,
      },
      select: ['score'],
    });

    return {
      totalGames: memberships.length,
      wins: memberships.filter((member) => member.score > 0).length,
    };
  }
}
