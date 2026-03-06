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
  ROOM_STATUS,
  ROOM_TYPE,
  RoomMember,
  ROOM_ACTOR_TYPE,
  RoomActorType,
  ROOM_MEMBER_ROLE,
  RoomScoreRecord,
} from './entities';
import {
  AddMemberDto,
  AddScoreDto,
  CreateRoomDto,
  JoinRoomDto,
  ListRoomHistoryQueryDto,
  TransferOwnerDto,
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
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(GuestUser)
    private readonly guestRepository: Repository<GuestUser>,
    private readonly guestService: GuestService,
    private readonly realtimeService: RealtimeService,
    private readonly jwtService: JwtService,
    private readonly dataSource: DataSource,
  ) { }

  async createRoom(req: Request, dto: CreateRoomDto) {
    const actor = await this.resolveActor(req, dto.guestNickname);
    const roomCode = await this.generateRoomCode();
    const roomName = this.normalizeRoomName(dto.roomName, roomCode);

    const roomType = dto.roomType === ROOM_TYPE.SINGLE ? ROOM_TYPE.SINGLE : ROOM_TYPE.MULTI;

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
    } = {
      id: In(roomIds),
    };

    if (statusFilter !== 'ALL') {
      roomWhere.status = statusFilter;
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

    const members = await this.roomMemberRepository.find({
      where: { roomId, isActive: true },
      order: { id: 'ASC' },
    });

    const memberNameMap = new Map<number, string>();
    members.forEach((item) => {
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

    return {
      room: {
        id: room.id,
        roomCode: room.roomCode,
        roomName: room.roomName,
        roomType: room.roomType,
        status: room.status,
        ownerMemberId: room.ownerMemberId,
        createdAt: room.createdAt,
        endedAt: room.endedAt,
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
