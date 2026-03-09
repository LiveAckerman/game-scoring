import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { DataSource, In, Repository } from 'typeorm';
import { User } from '../user/entities/user.entity';
import { GuestUser } from '../guest/entities/guest-user.entity';
import { GuestService } from '../guest/guest.service';
import { RealtimeService } from '../realtime/realtime.service';
import {
  Room,
  RoomStatus,
  RoomType,
  ROOM_STATUS,
  ROOM_TYPE,
  RoomMember,
  ROOM_ACTOR_TYPE,
  RoomActorType,
  ROOM_MEMBER_ROLE,
  RoomScoreRecord,
  PoolRound,
  POOL_ROUND_STATUS,
  PoolRecord,
  POOL_RECORD_TYPE,
} from './entities';
import {
  AddMemberDto,
  AddScoreDto,
  CreateRoomDto,
  JoinRoomDto,
  KickMemberDto,
  ListRoomHistoryQueryDto,
  TransferOwnerDto,
  PoolGiveDto,
  PoolTakeDto,
  PoolTableTakeDto,
  ToggleTableFeeDto,
  SetSpectatorsDto,
} from './dto';

interface ActorContext {
  actorType: RoomActorType;
  actorRefId: number;
  nickname: string;
  avatar: string;
  avatarInitials: string;
  guestToken?: string;
}

@Injectable()
export class RoomService {
  constructor(
    @InjectRepository(Room)
    private readonly roomRepository: Repository<Room>,
    @InjectRepository(RoomMember)
    private readonly roomMemberRepository: Repository<RoomMember>,
    @InjectRepository(RoomScoreRecord)
    private readonly roomScoreRecordRepository: Repository<RoomScoreRecord>,
    @InjectRepository(PoolRound)
    private readonly poolRoundRepository: Repository<PoolRound>,
    @InjectRepository(PoolRecord)
    private readonly poolRecordRepository: Repository<PoolRecord>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(GuestUser)
    private readonly guestRepository: Repository<GuestUser>,
    private readonly guestService: GuestService,
    private readonly realtimeService: RealtimeService,
    private readonly jwtService: JwtService,
    private readonly dataSource: DataSource,
  ) { }

  private static readonly MAX_ONGOING_PER_TYPE = 3;

  async createRoom(req: Request, dto: CreateRoomDto) {
    const actor = await this.resolveActor(req, dto.guestNickname);
    const roomCode = await this.generateRoomCode();
    const roomName = this.normalizeRoomName(dto.roomName, roomCode);

    let roomType: RoomType = ROOM_TYPE.MULTI;
    if (dto.roomType === ROOM_TYPE.SINGLE) {
      roomType = ROOM_TYPE.SINGLE;
    } else if (dto.roomType === ROOM_TYPE.POOL) {
      roomType = ROOM_TYPE.POOL;
    }

    const ongoingMemberships = await this.roomMemberRepository.find({
      where: { actorType: actor.actorType, actorRefId: actor.actorRefId },
      select: ['roomId'],
    });
    if (ongoingMemberships.length > 0) {
      const ongoingCount = await this.roomRepository.count({
        where: {
          id: In(ongoingMemberships.map((m) => m.roomId)),
          status: ROOM_STATUS.IN_PROGRESS,
          roomType,
        },
      });
      if (ongoingCount >= RoomService.MAX_ONGOING_PER_TYPE) {
        const typeLabel =
          roomType === ROOM_TYPE.SINGLE ? '单人记分' :
          roomType === ROOM_TYPE.POOL ? '分数池' : '多人对战';
        throw new ConflictException(
          `你已有 ${ongoingCount} 个进行中的${typeLabel}房间，请先结束部分房间再创建新的`,
        );
      }
    }

    const room = this.roomRepository.create({
      roomCode,
      roomName,
      roomType,
      status: ROOM_STATUS.IN_PROGRESS,
      createdByType: actor.actorType,
      createdByRefId: actor.actorRefId,
      ownerMemberId: null,
      endedAt: null,
    });

    const savedRoom = await this.roomRepository.save(room);

    const ownerMember = this.roomMemberRepository.create({
      roomId: savedRoom.id,
      actorType: actor.actorType,
      actorRefId: actor.actorRefId,
      role: ROOM_MEMBER_ROLE.OWNER,
      nickname: actor.nickname,
      avatar: actor.avatar,
      avatarInitials: actor.avatarInitials,
      score: 0,
      isActive: true,
    });

    const savedOwnerMember = await this.roomMemberRepository.save(ownerMember);
    savedRoom.ownerMemberId = savedOwnerMember.id;
    await this.roomRepository.save(savedRoom);

    const payload = await this.buildRoomPayload(savedRoom.id, actor);
    this.realtimeService.notifyRoomUpdated(payload.room.roomCode, 'room_created');
    return payload;
  }

  async joinRoom(req: Request, dto: JoinRoomDto) {
    const actor = await this.resolveActor(req, dto.guestNickname);
    const roomCode = this.normalizeRoomCode(dto.roomCode);

    const room = await this.roomRepository.findOne({ where: { roomCode } });
    if (!room) {
      throw new NotFoundException('房间不存在');
    }

    if (room.status === ROOM_STATUS.ENDED) {
      throw new ConflictException('房间已结束，无法加入');
    }

    let member = await this.roomMemberRepository.findOne({
      where: {
        roomId: room.id,
        actorType: actor.actorType,
        actorRefId: actor.actorRefId,
      },
    });

    if (!member) {
      member = this.roomMemberRepository.create({
        roomId: room.id,
        actorType: actor.actorType,
        actorRefId: actor.actorRefId,
        role: ROOM_MEMBER_ROLE.MEMBER,
        nickname: actor.nickname,
        avatar: actor.avatar,
        avatarInitials: actor.avatarInitials,
        score: 0,
        isActive: true,
      });
    } else {
      member.nickname = actor.nickname;
      member.avatar = actor.avatar;
      member.avatarInitials = actor.avatarInitials;
      member.isActive = true;
    }

    await this.roomMemberRepository.save(member);

    const payload = await this.buildRoomPayload(room.id, actor);
    this.realtimeService.notifyRoomUpdated(payload.room.roomCode, 'member_joined');
    return payload;
  }

  async getRoomByCode(req: Request, roomCodeRaw: string) {
    const actor = await this.resolveActor(req);
    const roomCode = this.normalizeRoomCode(roomCodeRaw);

    const room = await this.roomRepository.findOne({ where: { roomCode } });
    if (!room) {
      throw new NotFoundException('房间不存在');
    }

    await this.ensureMemberInRoom(room.id, actor);

    return this.buildRoomPayload(room.id, actor);
  }

  async getHistory(req: Request, query: ListRoomHistoryQueryDto) {
    const actor = await this.resolveActor(req);
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;
    const statusFilter = query.status || 'ALL';

    const actorMemberships = await this.roomMemberRepository.find({
      where: {
        actorType: actor.actorType,
        actorRefId: actor.actorRefId,
      },
      order: { roomId: 'DESC' },
    });

    if (actorMemberships.length === 0) {
      return {
        summary: {
          totalGames: 0,
          winRounds: 0,
          loseRounds: 0,
          drawRounds: 0,
          totalWinPoints: 0,
          totalLosePoints: 0,
          totalScore: 0,
        },
        pagination: {
          page,
          pageSize,
          total: 0,
          totalPages: 0,
        },
        items: [],
      };
    }

    const actorMembershipMap = new Map<number, RoomMember>();
    actorMemberships.forEach((member) => {
      actorMembershipMap.set(member.roomId, member);
    });

    const roomIds = [...actorMembershipMap.keys()];
    const roomWhere: {
      id: ReturnType<typeof In<number>>;
      status?: RoomStatus;
      roomType?: RoomType;
    } = {
      id: In(roomIds),
    };

    if (statusFilter !== 'ALL') {
      roomWhere.status = statusFilter;
    }

    if (query.roomType) {
      roomWhere.roomType = query.roomType;
    }

    const [rooms, total] = await this.roomRepository.findAndCount({
      where: roomWhere,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    const summaryRooms = await this.roomRepository.find({
      where: roomWhere,
      select: ['id'],
    });
    const summaryRoomIdSet = new Set(summaryRooms.map((room) => room.id));
    const summaryMemberships = actorMemberships.filter((membership) =>
      summaryRoomIdSet.has(membership.roomId),
    );

    if (rooms.length === 0) {
      return {
        summary: this.buildHistorySummary(summaryMemberships),
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
        items: [],
      };
    }

    const currentPageRoomIds = rooms.map((room) => room.id);

    const members = await this.roomMemberRepository.find({
      where: {
        roomId: In(currentPageRoomIds),
        isActive: true,
      },
      order: { id: 'ASC' },
    });

    const histUserRefIds = members
      .filter((m) => m.actorType === ROOM_ACTOR_TYPE.USER)
      .map((m) => m.actorRefId);
    if (histUserRefIds.length > 0) {
      const uniqueIds = [...new Set(histUserRefIds)];
      const latestUsers = await this.userRepository.find({
        where: { id: In(uniqueIds) },
      });
      const userMap = new Map<number, User>();
      latestUsers.forEach((u) => userMap.set(u.id, u));
      for (const member of members) {
        if (member.actorType !== ROOM_ACTOR_TYPE.USER) continue;
        const user = userMap.get(member.actorRefId);
        if (!user) continue;
        member.nickname = user.nickname || member.nickname;
        member.avatar = user.avatar || '';
        member.avatarInitials = this.guestService.buildInitials(member.nickname);
      }
    }

    const roomMemberMap = new Map<number, RoomMember[]>();
    members.forEach((member) => {
      const roomMembers = roomMemberMap.get(member.roomId) || [];
      roomMembers.push(member);
      roomMemberMap.set(member.roomId, roomMembers);
    });

    const scoreRecordRows = await this.roomScoreRecordRepository
      .createQueryBuilder('record')
      .select('record.roomId', 'roomId')
      .addSelect('COUNT(record.id)', 'recordCount')
      .where('record.roomId IN (:...roomIds)', { roomIds: currentPageRoomIds })
      .groupBy('record.roomId')
      .getRawMany<{ roomId: string; recordCount: string }>();

    const scoreRecordCountMap = new Map<number, number>();
    scoreRecordRows.forEach((row) => {
      scoreRecordCountMap.set(Number(row.roomId), Number(row.recordCount));
    });

    const items = rooms.map((room) => {
      const roomMembers = roomMemberMap.get(room.id) || [];
      const actorMembership = actorMembershipMap.get(room.id);
      const startedAt = room.createdAt;
      const endedAt = room.endedAt;
      const endTime = endedAt ? endedAt.getTime() : Date.now();
      const durationMinutes = Math.max(
        0,
        Math.floor((endTime - startedAt.getTime()) / 60000),
      );

      return {
        roomId: room.id,
        roomCode: room.roomCode,
        roomName: room.roomName,
        roomType: room.roomType,
        status: room.status,
        ownerMemberId: room.ownerMemberId,
        startedAt,
        endedAt,
        durationMinutes,
        memberCount: roomMembers.length,
        myScore: actorMembership ? actorMembership.score : 0,
        scoreRecordCount: scoreRecordCountMap.get(room.id) || 0,
        members: roomMembers.map((member) => ({
          id: member.id,
          nickname: member.nickname,
          avatar: member.avatar,
          avatarInitials: member.avatarInitials,
          score: member.score,
          isOwner: room.ownerMemberId === member.id,
        })),
      };
    });

    return {
      summary: this.buildHistorySummary(summaryMemberships),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
      items,
    };
  }

  async addScore(req: Request, roomId: number, dto: AddScoreDto) {
    const actor = await this.resolveActor(req);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const room = await queryRunner.manager.findOne(Room, {
        where: { id: roomId },
      });

      if (!room) {
        throw new NotFoundException('房间不存在');
      }

      if (room.status === ROOM_STATUS.ENDED) {
        throw new ConflictException('房间已结束，无法继续记分');
      }

      const callerMember = await queryRunner.manager.findOne(RoomMember, {
        where: {
          roomId,
          actorType: actor.actorType,
          actorRefId: actor.actorRefId,
          isActive: true,
        },
      });

      if (!callerMember) {
        throw new ForbiddenException('你不在该房间内，无法记分');
      }

      let fromMember = callerMember;

      if (dto.fromMemberId && dto.fromMemberId !== callerMember.id) {
        if (room.ownerMemberId !== callerMember.id) {
          throw new ForbiddenException('只有桌主可以代替其他成员记分');
        }

        const specifiedFrom = await queryRunner.manager.findOne(RoomMember, {
          where: { id: dto.fromMemberId, roomId, isActive: true },
        });

        if (!specifiedFrom) {
          throw new NotFoundException('出分方成员不存在');
        }

        fromMember = specifiedFrom;
      }

      const toMember = await queryRunner.manager.findOne(RoomMember, {
        where: {
          id: dto.toMemberId,
          roomId,
          isActive: true,
        },
      });

      if (!toMember) {
        throw new NotFoundException('目标成员不存在');
      }

      if (toMember.id === fromMember.id) {
        throw new BadRequestException('不能给自己记分');
      }

      await queryRunner.manager.decrement(
        RoomMember,
        { id: fromMember.id },
        'score',
        dto.points,
      );

      await queryRunner.manager.increment(
        RoomMember,
        { id: toMember.id },
        'score',
        dto.points,
      );

      const scoreRecord = queryRunner.manager.create(RoomScoreRecord, {
        roomId,
        fromMemberId: fromMember.id,
        toMemberId: toMember.id,
        points: dto.points,
        createdByMemberId: callerMember.id,
      });

      await queryRunner.manager.save(scoreRecord);
      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }

    const payload = await this.buildRoomPayload(roomId, actor);
    this.realtimeService.notifyRoomUpdated(payload.room.roomCode, 'score_added');
    return payload;
  }

  async transferOwner(req: Request, roomId: number, dto: TransferOwnerDto) {
    const actor = await this.resolveActor(req);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const room = await queryRunner.manager.findOne(Room, {
        where: { id: roomId },
      });

      if (!room) {
        throw new NotFoundException('房间不存在');
      }

      const operatorMember = await queryRunner.manager.findOne(RoomMember, {
        where: {
          roomId,
          actorType: actor.actorType,
          actorRefId: actor.actorRefId,
          isActive: true,
        },
      });

      if (!operatorMember) {
        throw new ForbiddenException('你不在该房间内');
      }

      if (room.ownerMemberId !== operatorMember.id) {
        throw new ForbiddenException('只有桌主可以转移桌主');
      }

      const targetMember = await queryRunner.manager.findOne(RoomMember, {
        where: {
          id: dto.targetMemberId,
          roomId,
          isActive: true,
        },
      });

      if (!targetMember) {
        throw new NotFoundException('目标成员不存在');
      }

      if (targetMember.id !== operatorMember.id) {
        operatorMember.role = ROOM_MEMBER_ROLE.MEMBER;
        targetMember.role = ROOM_MEMBER_ROLE.OWNER;

        await queryRunner.manager.save(operatorMember);
        await queryRunner.manager.save(targetMember);
      }

      room.ownerMemberId = targetMember.id;
      await queryRunner.manager.save(room);

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }

    const payload = await this.buildRoomPayload(roomId, actor);
    this.realtimeService.notifyRoomUpdated(payload.room.roomCode, 'owner_transferred');
    return payload;
  }

  async kickMember(req: Request, roomId: number, dto: KickMemberDto) {
    const actor = await this.resolveActor(req);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const room = await queryRunner.manager.findOne(Room, {
        where: { id: roomId },
      });

      if (!room) {
        throw new NotFoundException('房间不存在');
      }

      if (room.roomType === ROOM_TYPE.POOL) {
        throw new BadRequestException('分数池模式暂不支持踢人');
      }

      if (room.status === ROOM_STATUS.ENDED) {
        throw new ConflictException('房间已结束，无法踢人');
      }

      const operatorMember = await queryRunner.manager.findOne(RoomMember, {
        where: {
          roomId,
          actorType: actor.actorType,
          actorRefId: actor.actorRefId,
          isActive: true,
        },
      });

      if (!operatorMember) {
        throw new ForbiddenException('你不在该房间内');
      }

      if (room.ownerMemberId !== operatorMember.id) {
        throw new ForbiddenException('只有桌主可以踢人');
      }

      const targetMember = await queryRunner.manager.findOne(RoomMember, {
        where: {
          id: dto.targetMemberId,
          roomId,
          isActive: true,
        },
      });

      if (!targetMember) {
        throw new NotFoundException('目标成员不存在');
      }

      if (targetMember.id === operatorMember.id || targetMember.id === room.ownerMemberId) {
        throw new BadRequestException('不能踢出桌主');
      }

      const relatedRecords = await queryRunner.manager.find(RoomScoreRecord, {
        where: { roomId },
        order: { id: 'ASC' },
      });

      // 仅回滚被踢成员当前仍持有的净得分，避免影响已经继续流转的积分链路。
      const refundMap = new Map<number, number>();
      relatedRecords.forEach((record) => {
        if (record.toMemberId === targetMember.id) {
          refundMap.set(
            record.fromMemberId,
            (refundMap.get(record.fromMemberId) || 0) + record.points,
          );
        } else if (record.fromMemberId === targetMember.id) {
          refundMap.set(
            record.toMemberId,
            (refundMap.get(record.toMemberId) || 0) - record.points,
          );
        }
      });

      const reverseEntries = [...refundMap.entries()]
        .filter(([memberId, points]) => memberId !== targetMember.id && points !== 0);

      if (reverseEntries.some(([, points]) => points < 0)) {
        throw new BadRequestException(
          '该玩家已有已转出的积分，请先手动结清后再踢出',
        );
      }

      const totalRefundPoints = reverseEntries.reduce((sum, [, points]) => sum + points, 0);

      if (targetMember.score < 0) {
        throw new BadRequestException('该玩家当前为负分，请先手动结清后再踢出');
      }

      if (totalRefundPoints !== targetMember.score) {
        throw new BadRequestException(
          '该玩家积分状态异常，请先手动结清后再踢出',
        );
      }

      for (const [memberId, points] of reverseEntries) {
        await queryRunner.manager.increment(RoomMember, { id: memberId }, 'score', points);
        const refundRecord = queryRunner.manager.create(RoomScoreRecord, {
          roomId,
          fromMemberId: targetMember.id,
          toMemberId: memberId,
          points,
          createdByMemberId: operatorMember.id,
        });
        await queryRunner.manager.save(refundRecord);
      }

      targetMember.score = 0;
      targetMember.isSpectator = false;
      targetMember.isActive = false;
      await queryRunner.manager.save(targetMember);

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }

    const payload = await this.buildRoomPayload(roomId, actor);
    this.realtimeService.notifyRoomUpdated(payload.room.roomCode, 'member_kicked');
    return payload;
  }

  async endRoom(req: Request, roomId: number) {
    const actor = await this.resolveActor(req);

    const room = await this.roomRepository.findOne({ where: { id: roomId } });
    if (!room) {
      throw new NotFoundException('房间不存在');
    }

    const member = await this.roomMemberRepository.findOne({
      where: {
        roomId,
        actorType: actor.actorType,
        actorRefId: actor.actorRefId,
        isActive: true,
      },
    });

    if (!member) {
      throw new ForbiddenException('你不在该房间内');
    }

    if (room.ownerMemberId !== member.id) {
      throw new ForbiddenException('只有桌主可以结束房间');
    }

    if (room.status !== ROOM_STATUS.ENDED) {
      room.status = ROOM_STATUS.ENDED;
      room.endedAt = new Date();
      await this.roomRepository.save(room);
    }

    const payload = await this.buildRoomPayload(room.id, actor);
    this.realtimeService.notifyRoomUpdated(payload.room.roomCode, 'room_ended');
    return payload;
  }

  async hideInviteCard(req: Request, roomId: number) {
    const actor = await this.resolveActor(req);

    const room = await this.roomRepository.findOne({ where: { id: roomId } });
    if (!room) {
      throw new NotFoundException('房间不存在');
    }

    const member = await this.roomMemberRepository.findOne({
      where: {
        roomId,
        actorType: actor.actorType,
        actorRefId: actor.actorRefId,
        isActive: true,
      },
    });

    if (!member) {
      throw new ForbiddenException('你不在该房间内');
    }

    if (!member.inviteCardHidden) {
      member.inviteCardHidden = true;
      await this.roomMemberRepository.save(member);
    }

    return this.buildRoomPayload(roomId, actor);
  }

  async addMember(req: Request, roomId: number, dto: AddMemberDto) {
    const actor = await this.resolveActor(req);

    const room = await this.roomRepository.findOne({ where: { id: roomId } });
    if (!room) {
      throw new NotFoundException('房间不存在');
    }

    if (room.status === ROOM_STATUS.ENDED) {
      throw new ConflictException('房间已结束，无法添加成员');
    }

    const callerMember = await this.roomMemberRepository.findOne({
      where: {
        roomId,
        actorType: actor.actorType,
        actorRefId: actor.actorRefId,
        isActive: true,
      },
    });

    if (!callerMember) {
      throw new ForbiddenException('你不在该房间内');
    }

    if (room.ownerMemberId !== callerMember.id) {
      throw new ForbiddenException('只有桌主可以添加成员');
    }

    const existingMembers = await this.roomMemberRepository.count({
      where: { roomId, isActive: true },
    });

    if (existingMembers >= 10) {
      throw new BadRequestException('房间最多10人');
    }

    const nickname = (dto.nickname || '').trim().slice(0, 64);
    if (!nickname) {
      throw new BadRequestException('昵称不能为空');
    }

    const initials = nickname.slice(0, 2);

    const maxRefResult = await this.roomMemberRepository
      .createQueryBuilder('m')
      .select('COALESCE(MAX(m.actorRefId), 0)', 'maxRef')
      .where('m.roomId = :roomId AND m.actorType = :actorType', {
        roomId,
        actorType: ROOM_ACTOR_TYPE.VIRTUAL,
      })
      .getRawOne<{ maxRef: string }>();

    const nextRefId = Number(maxRefResult?.maxRef || 0) + 1;

    const member = this.roomMemberRepository.create({
      roomId,
      actorType: ROOM_ACTOR_TYPE.VIRTUAL,
      actorRefId: nextRefId,
      role: ROOM_MEMBER_ROLE.MEMBER,
      nickname,
      avatar: '',
      avatarInitials: initials,
      score: 0,
      isActive: true,
    });

    await this.roomMemberRepository.save(member);

    const payload = await this.buildRoomPayload(roomId, actor);
    this.realtimeService.notifyRoomUpdated(payload.room.roomCode, 'member_added');
    return payload;
  }

  // ───────── 分数池：开启新圈 ─────────
  async startPoolRound(req: Request, roomId: number) {
    const actor = await this.resolveActor(req);
    const { room, member } = await this.ensurePoolOwner(roomId, actor);

    const activeRound = await this.poolRoundRepository.findOne({
      where: { roomId, status: POOL_ROUND_STATUS.IN_PROGRESS },
    });
    if (activeRound) {
      throw new ConflictException('当前还有进行中的圈，请先结束');
    }

    const maxResult = await this.poolRoundRepository
      .createQueryBuilder('r')
      .select('COALESCE(MAX(r.roundNumber), 0)', 'maxNum')
      .where('r.roomId = :roomId', { roomId })
      .getRawOne<{ maxNum: string }>();

    const nextNumber = Number(maxResult?.maxNum || 0) + 1;

    const round = this.poolRoundRepository.create({
      roomId,
      roundNumber: nextNumber,
      poolBalance: 0,
      status: POOL_ROUND_STATUS.IN_PROGRESS,
      endedAt: null,
    });
    const saved = await this.poolRoundRepository.save(round);

    this.realtimeService.notifyRoomUpdated(room.roomCode, 'pool_round_started');
    return this.buildPoolRoundPayload(saved.id, roomId, actor);
  }

  // ───────── 分数池：获取当前圈 ─────────
  async getCurrentPoolRound(req: Request, roomId: number) {
    const actor = await this.resolveActor(req);

    const room = await this.roomRepository.findOne({ where: { id: roomId } });
    if (!room) throw new NotFoundException('房间不存在');
    if (room.roomType !== ROOM_TYPE.POOL) throw new BadRequestException('非分数池房间');

    await this.ensureMemberInRoom(roomId, actor);

    const round = await this.poolRoundRepository.findOne({
      where: { roomId, status: POOL_ROUND_STATUS.IN_PROGRESS },
    });

    if (!round) {
      return { round: null, records: [], members: [] };
    }

    return this.buildPoolRoundPayload(round.id, roomId, actor);
  }

  // ───────── 分数池：获取指定圈 ─────────
  async getPoolRound(req: Request, roomId: number, roundId: number) {
    const actor = await this.resolveActor(req);

    const room = await this.roomRepository.findOne({ where: { id: roomId } });
    if (!room) throw new NotFoundException('房间不存在');

    await this.ensureMemberInRoom(roomId, actor);

    const round = await this.poolRoundRepository.findOne({
      where: { id: roundId, roomId },
    });
    if (!round) throw new NotFoundException('圈不存在');

    return this.buildPoolRoundPayload(round.id, roomId, actor);
  }

  // ───────── 分数池：给分到池 ─────────
  async poolGive(req: Request, roomId: number, dto: PoolGiveDto) {
    const actor = await this.resolveActor(req);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const room = await queryRunner.manager.findOne(Room, { where: { id: roomId } });
      if (!room) throw new NotFoundException('房间不存在');
      if (room.roomType !== ROOM_TYPE.POOL) throw new BadRequestException('非分数池房间');
      if (room.status === ROOM_STATUS.ENDED) throw new ConflictException('房间已结束');

      const member = await queryRunner.manager.findOne(RoomMember, {
        where: { roomId, actorType: actor.actorType, actorRefId: actor.actorRefId, isActive: true },
      });
      if (!member) throw new ForbiddenException('你不在该房间内');
      if (member.isSpectator) throw new ForbiddenException('旁观者不可操作');

      const round = await queryRunner.manager.findOne(PoolRound, {
        where: { roomId, status: POOL_ROUND_STATUS.IN_PROGRESS },
      });
      if (!round) throw new ConflictException('没有进行中的圈');

      await queryRunner.manager.decrement(RoomMember, { id: member.id }, 'score', dto.points);
      await queryRunner.manager.increment(PoolRound, { id: round.id }, 'poolBalance', dto.points);

      const record = queryRunner.manager.create(PoolRecord, {
        roundId: round.id,
        roomId,
        memberId: member.id,
        type: POOL_RECORD_TYPE.GIVE,
        points: dto.points,
      });
      await queryRunner.manager.save(record);

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }

    this.realtimeService.notifyRoomUpdated(
      (await this.roomRepository.findOne({ where: { id: roomId } }))!.roomCode,
      'pool_give',
    );

    const round = await this.poolRoundRepository.findOne({
      where: { roomId, status: POOL_ROUND_STATUS.IN_PROGRESS },
    });
    return this.buildPoolRoundPayload(round!.id, roomId, actor);
  }

  // ───────── 分数池：从池取分 ─────────
  async poolTake(req: Request, roomId: number, dto: PoolTakeDto) {
    const actor = await this.resolveActor(req);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const room = await queryRunner.manager.findOne(Room, { where: { id: roomId } });
      if (!room) throw new NotFoundException('房间不存在');
      if (room.roomType !== ROOM_TYPE.POOL) throw new BadRequestException('非分数池房间');
      if (room.status === ROOM_STATUS.ENDED) throw new ConflictException('房间已结束');

      const member = await queryRunner.manager.findOne(RoomMember, {
        where: { roomId, actorType: actor.actorType, actorRefId: actor.actorRefId, isActive: true },
      });
      if (!member) throw new ForbiddenException('你不在该房间内');
      if (member.isSpectator) throw new ForbiddenException('旁观者不可操作');

      const round = await queryRunner.manager.findOne(PoolRound, {
        where: { roomId, status: POOL_ROUND_STATUS.IN_PROGRESS },
      });
      if (!round) throw new ConflictException('没有进行中的圈');
      if (round.poolBalance < dto.points) throw new BadRequestException('分数池余额不足');

      await queryRunner.manager.increment(RoomMember, { id: member.id }, 'score', dto.points);
      await queryRunner.manager.decrement(PoolRound, { id: round.id }, 'poolBalance', dto.points);

      const record = queryRunner.manager.create(PoolRecord, {
        roundId: round.id,
        roomId,
        memberId: member.id,
        type: POOL_RECORD_TYPE.TAKE,
        points: dto.points,
      });
      await queryRunner.manager.save(record);

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }

    this.realtimeService.notifyRoomUpdated(
      (await this.roomRepository.findOne({ where: { id: roomId } }))!.roomCode,
      'pool_take',
    );

    const round = await this.poolRoundRepository.findOne({
      where: { roomId, status: POOL_ROUND_STATUS.IN_PROGRESS },
    });
    return this.buildPoolRoundPayload(round!.id, roomId, actor);
  }

  // ───────── 分数池：台板取分 ─────────
  async poolTableTake(req: Request, roomId: number, dto: PoolTableTakeDto) {
    const actor = await this.resolveActor(req);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const room = await queryRunner.manager.findOne(Room, { where: { id: roomId } });
      if (!room) throw new NotFoundException('房间不存在');
      if (room.roomType !== ROOM_TYPE.POOL) throw new BadRequestException('非分数池房间');
      if (room.status === ROOM_STATUS.ENDED) throw new ConflictException('房间已结束');
      if (!room.tableFeeEnabled) throw new BadRequestException('台板未开启');

      const callerMember = await queryRunner.manager.findOne(RoomMember, {
        where: { roomId, actorType: actor.actorType, actorRefId: actor.actorRefId, isActive: true },
      });
      if (!callerMember) throw new ForbiddenException('你不在该房间内');
      if (room.ownerMemberId !== callerMember.id) throw new ForbiddenException('只有桌主可以操作台板取分');

      const round = await queryRunner.manager.findOne(PoolRound, {
        where: { roomId, status: POOL_ROUND_STATUS.IN_PROGRESS },
      });
      if (!round) throw new ConflictException('没有进行中的圈');
      if (round.poolBalance < dto.points) throw new BadRequestException('分数池余额不足');

      const tableMember = await queryRunner.manager.findOne(RoomMember, {
        where: { roomId, actorType: ROOM_ACTOR_TYPE.VIRTUAL, nickname: '台板', isActive: true },
      });
      if (!tableMember) throw new BadRequestException('台板成员不存在');

      await queryRunner.manager.increment(RoomMember, { id: tableMember.id }, 'score', dto.points);
      await queryRunner.manager.decrement(PoolRound, { id: round.id }, 'poolBalance', dto.points);

      const record = queryRunner.manager.create(PoolRecord, {
        roundId: round.id,
        roomId,
        memberId: tableMember.id,
        type: POOL_RECORD_TYPE.TAKE,
        points: dto.points,
      });
      await queryRunner.manager.save(record);

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }

    this.realtimeService.notifyRoomUpdated(
      (await this.roomRepository.findOne({ where: { id: roomId } }))!.roomCode,
      'pool_table_take',
    );

    const round = await this.poolRoundRepository.findOne({
      where: { roomId, status: POOL_ROUND_STATUS.IN_PROGRESS },
    });
    return this.buildPoolRoundPayload(round!.id, roomId, actor);
  }

  // ───────── 分数池：结束本圈 ─────────
  async endPoolRound(req: Request, roomId: number, roundId: number) {
    const actor = await this.resolveActor(req);
    const { room } = await this.ensurePoolOwner(roomId, actor);

    const round = await this.poolRoundRepository.findOne({
      where: { id: roundId, roomId },
    });
    if (!round) throw new NotFoundException('圈不存在');
    if (round.status === POOL_ROUND_STATUS.ENDED) throw new ConflictException('该圈已结束');

    round.status = POOL_ROUND_STATUS.ENDED;
    round.endedAt = new Date();
    await this.poolRoundRepository.save(round);

    this.realtimeService.notifyRoomUpdated(room.roomCode, 'pool_round_ended');
    return this.buildPoolRoundPayload(round.id, roomId, actor);
  }

  // ───────── 分数池：获取所有圈（摘要） ─────────
  async getPoolRounds(req: Request, roomId: number) {
    const actor = await this.resolveActor(req);

    const room = await this.roomRepository.findOne({ where: { id: roomId } });
    if (!room) throw new NotFoundException('房间不存在');

    await this.ensureMemberInRoom(roomId, actor);

    const rounds = await this.poolRoundRepository.find({
      where: { roomId },
      order: { roundNumber: 'ASC' },
    });

    const members = await this.roomMemberRepository.find({
      where: { roomId, isActive: true },
      order: { id: 'ASC' },
    });

    const memberMap = new Map<number, RoomMember>();
    members.forEach((m) => memberMap.set(m.id, m));

    const roundSummaries = [];
    for (const round of rounds) {
      const records = await this.poolRecordRepository.find({
        where: { roundId: round.id },
        order: { id: 'ASC' },
      });

      const memberScores = new Map<number, number>();
      for (const rec of records) {
        const current = memberScores.get(rec.memberId) || 0;
        if (rec.type === POOL_RECORD_TYPE.GIVE) {
          memberScores.set(rec.memberId, current - rec.points);
        } else {
          memberScores.set(rec.memberId, current + rec.points);
        }
      }

      roundSummaries.push({
        id: round.id,
        roundNumber: round.roundNumber,
        poolBalance: round.poolBalance,
        status: round.status,
        createdAt: round.createdAt,
        endedAt: round.endedAt,
        memberScores: Array.from(memberScores.entries()).map(([memberId, score]) => ({
          memberId,
          nickname: memberMap.get(memberId)?.nickname || '未知',
          score,
        })),
      });
    }

    return { rounds: roundSummaries };
  }

  // ───────── 台板：开关 ─────────
  async toggleTableFee(req: Request, roomId: number, dto: ToggleTableFeeDto) {
    const actor = await this.resolveActor(req);
    const { room } = await this.ensurePoolOwner(roomId, actor);

    if (dto.enabled && !room.tableFeeEnabled) {
      room.tableFeeEnabled = true;
      await this.roomRepository.save(room);

      const existing = await this.roomMemberRepository.findOne({
        where: { roomId, actorType: ROOM_ACTOR_TYPE.VIRTUAL, nickname: '台板' },
      });

      if (existing) {
        existing.isActive = true;
        await this.roomMemberRepository.save(existing);
      } else {
        const maxRefResult = await this.roomMemberRepository
          .createQueryBuilder('m')
          .select('COALESCE(MAX(m.actorRefId), 0)', 'maxRef')
          .where('m.roomId = :roomId AND m.actorType = :actorType', {
            roomId,
            actorType: ROOM_ACTOR_TYPE.VIRTUAL,
          })
          .getRawOne<{ maxRef: string }>();
        const nextRefId = Number(maxRefResult?.maxRef || 0) + 1;

        const tableMember = this.roomMemberRepository.create({
          roomId,
          actorType: ROOM_ACTOR_TYPE.VIRTUAL,
          actorRefId: nextRefId,
          role: ROOM_MEMBER_ROLE.MEMBER,
          nickname: '台板',
          avatar: '',
          avatarInitials: '台',
          score: 0,
          isActive: true,
        });
        await this.roomMemberRepository.save(tableMember);
      }
    } else if (!dto.enabled && room.tableFeeEnabled) {
      room.tableFeeEnabled = false;
      await this.roomRepository.save(room);

      const tableMember = await this.roomMemberRepository.findOne({
        where: { roomId, actorType: ROOM_ACTOR_TYPE.VIRTUAL, nickname: '台板', isActive: true },
      });
      if (tableMember) {
        tableMember.isActive = false;
        await this.roomMemberRepository.save(tableMember);
      }
    }

    const payload = await this.buildRoomPayload(roomId, actor);
    this.realtimeService.notifyRoomUpdated(payload.room.roomCode, 'table_fee_toggled');
    return payload;
  }

  // ───────── 旁观者：设置 ─────────
  async setSpectators(req: Request, roomId: number, dto: SetSpectatorsDto) {
    const actor = await this.resolveActor(req);

    const room = await this.roomRepository.findOne({ where: { id: roomId } });
    if (!room) throw new NotFoundException('房间不存在');

    const callerMember = await this.roomMemberRepository.findOne({
      where: { roomId, actorType: actor.actorType, actorRefId: actor.actorRefId, isActive: true },
    });
    if (!callerMember) throw new ForbiddenException('你不在该房间内');
    if (room.ownerMemberId !== callerMember.id) throw new ForbiddenException('只有桌主可以设置旁观者');

    const members = await this.roomMemberRepository.find({
      where: { roomId, isActive: true },
    });

    const spectatorSet = new Set(dto.memberIds);

    for (const member of members) {
      if (member.id === room.ownerMemberId) continue;
      const shouldBeSpectator = spectatorSet.has(member.id);
      if (member.isSpectator !== shouldBeSpectator) {
        member.isSpectator = shouldBeSpectator;
        await this.roomMemberRepository.save(member);
      }
    }

    const payload = await this.buildRoomPayload(roomId, actor);
    this.realtimeService.notifyRoomUpdated(payload.room.roomCode, 'spectators_updated');
    return payload;
  }

  // ───────── 辅助：确认 POOL 房间桌主 ─────────
  private async ensurePoolOwner(roomId: number, actor: ActorContext) {
    const room = await this.roomRepository.findOne({ where: { id: roomId } });
    if (!room) throw new NotFoundException('房间不存在');
    if (room.roomType !== ROOM_TYPE.POOL) throw new BadRequestException('非分数池房间');
    if (room.status === ROOM_STATUS.ENDED) throw new ConflictException('房间已结束');

    const member = await this.roomMemberRepository.findOne({
      where: { roomId, actorType: actor.actorType, actorRefId: actor.actorRefId, isActive: true },
    });
    if (!member) throw new ForbiddenException('你不在该房间内');
    if (room.ownerMemberId !== member.id) throw new ForbiddenException('只有桌主可以操作');

    return { room, member };
  }

  // ───────── 辅助：构建圈信息 payload ─────────
  private async buildPoolRoundPayload(roundId: number, roomId: number, actor: ActorContext) {
    const round = await this.poolRoundRepository.findOne({ where: { id: roundId } });
    if (!round) throw new NotFoundException('圈不存在');

    const records = await this.poolRecordRepository.find({
      where: { roundId },
      order: { id: 'ASC' },
    });

    const members = await this.roomMemberRepository.find({
      where: { roomId, isActive: true },
      order: { id: 'ASC' },
    });

    const memberMap = new Map<number, { nickname: string; avatar: string; avatarInitials: string; actorType: string }>();
    members.forEach((m) => memberMap.set(m.id, {
      nickname: m.nickname,
      avatar: m.avatar,
      avatarInitials: m.avatarInitials,
      actorType: m.actorType,
    }));

    const currentMember = members.find(
      (m) => m.actorType === actor.actorType && m.actorRefId === actor.actorRefId,
    );

    const room = await this.roomRepository.findOne({ where: { id: roomId } });

    return {
      round: {
        id: round.id,
        roundNumber: round.roundNumber,
        poolBalance: round.poolBalance,
        status: round.status,
        createdAt: round.createdAt,
        endedAt: round.endedAt,
      },
      records: records.map((r, index) => ({
        id: r.id,
        seq: index + 1,
        memberId: r.memberId,
        memberNickname: memberMap.get(r.memberId)?.nickname || '未知',
        memberAvatar: memberMap.get(r.memberId)?.avatar || '',
        memberAvatarInitials: memberMap.get(r.memberId)?.avatarInitials || '',
        memberActorType: memberMap.get(r.memberId)?.actorType || 'USER',
        type: r.type,
        points: r.points,
        createdAt: r.createdAt,
      })),
      members: members.map((m) => ({
        id: m.id,
        nickname: m.nickname,
        avatar: m.avatar,
        avatarInitials: m.avatarInitials,
        actorType: m.actorType,
        score: m.score,
        isSpectator: m.isSpectator,
        isOwner: m.id === room?.ownerMemberId,
      })),
      currentMemberId: currentMember?.id || null,
      isOwner: currentMember ? currentMember.id === room?.ownerMemberId : false,
      tableFeeEnabled: room?.tableFeeEnabled || false,
    };
  }

  private buildHistorySummary(actorMemberships: RoomMember[]) {
    const totalGames = actorMemberships.length;
    const winRounds = actorMemberships.filter((item) => item.score > 0).length;
    const loseRounds = actorMemberships.filter((item) => item.score < 0).length;
    const drawRounds = actorMemberships.filter((item) => item.score === 0).length;

    const totalWinPoints = actorMemberships.reduce((sum, item) => {
      if (item.score > 0) {
        return sum + item.score;
      }
      return sum;
    }, 0);

    const totalLosePoints = actorMemberships.reduce((sum, item) => {
      if (item.score < 0) {
        return sum + item.score;
      }
      return sum;
    }, 0);

    return {
      totalGames,
      winRounds,
      loseRounds,
      drawRounds,
      totalWinPoints,
      totalLosePoints,
      totalScore: totalWinPoints + totalLosePoints,
    };
  }

  private async buildRoomPayload(roomId: number, actor: ActorContext) {
    const room = await this.roomRepository.findOne({ where: { id: roomId } });
    if (!room) {
      throw new NotFoundException('房间不存在');
    }

    const allMembers = await this.roomMemberRepository.find({
      where: { roomId },
      order: { id: 'ASC' },
    });
    const members = allMembers.filter((member) => member.isActive);

    const userRefIds = allMembers
      .filter((m) => m.actorType === ROOM_ACTOR_TYPE.USER)
      .map((m) => m.actorRefId);

    if (userRefIds.length > 0) {
      const latestUsers = await this.userRepository.find({
        where: { id: In(userRefIds) },
      });
      const userMap = new Map<number, User>();
      latestUsers.forEach((u) => userMap.set(u.id, u));

      for (const member of allMembers) {
        if (member.actorType !== ROOM_ACTOR_TYPE.USER) continue;
        const user = userMap.get(member.actorRefId);
        if (!user) continue;
        const latestNickname = user.nickname || member.nickname;
        const latestAvatar = user.avatar || '';
        const latestInitials = this.guestService.buildInitials(latestNickname);
        if (
          member.nickname !== latestNickname ||
          member.avatar !== latestAvatar ||
          member.avatarInitials !== latestInitials
        ) {
          member.nickname = latestNickname;
          member.avatar = latestAvatar;
          member.avatarInitials = latestInitials;
          await this.roomMemberRepository.save(member);
        }
      }
    }

    const memberNameMap = new Map<number, string>();
    allMembers.forEach((item) => {
      memberNameMap.set(item.id, item.nickname);
    });

    const records = await this.roomScoreRecordRepository.find({
      where: { roomId },
      order: { id: 'DESC' },
      take: 50,
    });

    const currentMember = members.find(
      (item) =>
        item.actorType === actor.actorType && item.actorRefId === actor.actorRefId,
    );

    let activePoolRound: PoolRound | null = null;
    if (room.roomType === ROOM_TYPE.POOL) {
      activePoolRound = await this.poolRoundRepository.findOne({
        where: { roomId, status: POOL_ROUND_STATUS.IN_PROGRESS },
      });
    }

    return {
      room: {
        id: room.id,
        roomCode: room.roomCode,
        roomName: room.roomName,
        roomType: room.roomType,
        status: room.status,
        ownerMemberId: room.ownerMemberId,
        tableFeeEnabled: room.tableFeeEnabled,
        createdAt: room.createdAt,
        endedAt: room.endedAt,
        activePoolRound: activePoolRound ? {
          id: activePoolRound.id,
          roundNumber: activePoolRound.roundNumber,
          poolBalance: activePoolRound.poolBalance,
          status: activePoolRound.status,
        } : null,
        members: members.map((item) => ({
          id: item.id,
          actorType: item.actorType,
          actorRefId: item.actorRefId,
          role: item.role,
          isOwner: item.id === room.ownerMemberId,
          nickname: item.nickname,
          avatar: item.avatar,
          avatarInitials: item.avatarInitials,
          score: item.score,
          inviteCardHidden: item.inviteCardHidden,
          isSpectator: item.isSpectator,
          joinedAt: item.joinedAt,
        })),
        scoreRecords: records.reverse().map((record) => ({
          id: record.id,
          fromMemberId: record.fromMemberId,
          toMemberId: record.toMemberId,
          fromMemberName: memberNameMap.get(record.fromMemberId) || '未知玩家',
          toMemberName: memberNameMap.get(record.toMemberId) || '未知玩家',
          points: record.points,
          createdByMemberId: record.createdByMemberId,
          createdAt: record.createdAt,
        })),
      },
      currentMemberId: currentMember ? currentMember.id : null,
      actor: {
        type: actor.actorType,
        id: actor.actorRefId,
        nickname: actor.nickname,
        avatarInitials: actor.avatarInitials,
        guestToken: actor.guestToken,
      },
    };
  }

  private async ensureMemberInRoom(roomId: number, actor: ActorContext) {
    const member = await this.roomMemberRepository.findOne({
      where: {
        roomId,
        actorType: actor.actorType,
        actorRefId: actor.actorRefId,
        isActive: true,
      },
    });

    if (!member) {
      throw new ForbiddenException('你还未加入该房间');
    }
  }

  private normalizeRoomCode(roomCodeRaw: string): string {
    const roomCode = (roomCodeRaw || '').replace(/\D/g, '').slice(0, 6);
    if (!/^\d{6}$/.test(roomCode)) {
      throw new BadRequestException('房间号必须是6位数字');
    }
    return roomCode;
  }

  private normalizeRoomName(roomNameRaw: string | undefined, roomCode: string): string {
    const roomName = (roomNameRaw || '').trim().slice(0, 64);
    if (roomName) {
      return roomName;
    }
    return `桌号 ${roomCode}`;
  }

  private async resolveActor(
    req: Request,
    guestNickname?: string,
  ): Promise<ActorContext> {
    const authToken = this.extractBearerToken(req);

    if (authToken) {
      try {
        const payload = this.jwtService.verify<{ sub: number }>(authToken);
        const user = await this.userRepository.findOne({
          where: { id: payload.sub },
        });

        if (!user) {
          throw new UnauthorizedException('用户不存在，请重新登录');
        }

        const nickname = user.nickname || `玩家${user.id}`;
        return {
          actorType: ROOM_ACTOR_TYPE.USER,
          actorRefId: user.id,
          nickname,
          avatar: user.avatar || '',
          avatarInitials: this.guestService.buildInitials(nickname),
        };
      } catch (error) {
        throw new UnauthorizedException('登录状态无效，请重新登录');
      }
    }

    const guestToken = this.extractGuestToken(req);
    if (guestToken) {
      const guest = await this.guestRepository.findOne({
        where: { token: guestToken, isActive: true },
      });

      if (!guest && !guestNickname) {
        throw new UnauthorizedException('游客身份失效，请重新输入昵称');
      }

      if (guest) {
        if (guestNickname) {
          const normalizedName = this.guestService.normalizeNickname(guestNickname);
          if (normalizedName !== guest.nickname) {
            guest.nickname = normalizedName;
            guest.avatarInitials = this.guestService.buildInitials(normalizedName);
            await this.guestRepository.save(guest);
          }
        }

        return {
          actorType: ROOM_ACTOR_TYPE.GUEST,
          actorRefId: guest.id,
          nickname: guest.nickname,
          avatar: '',
          avatarInitials: guest.avatarInitials,
          guestToken: guest.token,
        };
      }
    }

    if (!guestNickname) {
      throw new UnauthorizedException('请先登录或输入昵称后再继续');
    }

    const guest = await this.guestService.createSession(guestNickname, guestToken);
    return {
      actorType: ROOM_ACTOR_TYPE.GUEST,
      actorRefId: guest.id,
      nickname: guest.nickname,
      avatar: '',
      avatarInitials: guest.avatarInitials,
      guestToken: guest.token,
    };
  }

  private async generateRoomCode(): Promise<string> {
    for (let index = 0; index < 12; index += 1) {
      const roomCode = `${Math.floor(100000 + Math.random() * 900000)}`;
      const exists = await this.roomRepository.exist({ where: { roomCode } });
      if (!exists) {
        return roomCode;
      }
    }

    throw new ConflictException('房间号生成失败，请重试');
  }

  private extractBearerToken(req: Request): string | undefined {
    const authValue = req.headers.authorization;
    if (!authValue) {
      return undefined;
    }

    const rawValue = Array.isArray(authValue) ? authValue[0] : authValue;
    if (!rawValue) {
      return undefined;
    }

    const [prefix, token] = rawValue.split(' ');
    if (prefix !== 'Bearer' || !token) {
      return undefined;
    }

    return token;
  }

  private extractGuestToken(req: Request): string | undefined {
    const rawToken = req.headers['x-guest-token'];
    if (!rawToken) {
      return undefined;
    }

    if (Array.isArray(rawToken)) {
      return rawToken[0];
    }

    return rawToken;
  }
}
