import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
  Index,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { Room } from './room.entity';

export const ROOM_MEMBER_ROLE = {
  OWNER: 'OWNER',
  MEMBER: 'MEMBER',
} as const;

export type RoomMemberRole = (typeof ROOM_MEMBER_ROLE)[keyof typeof ROOM_MEMBER_ROLE];

export const ROOM_ACTOR_TYPE = {
  USER: 'USER',
  GUEST: 'GUEST',
} as const;

export type RoomActorType = (typeof ROOM_ACTOR_TYPE)[keyof typeof ROOM_ACTOR_TYPE];

@Entity('room_members')
@Index('idx_room_members_room_id', ['roomId'])
@Unique('uniq_room_members_identity', ['roomId', 'actorType', 'actorRefId'])
export class RoomMember {
  @ApiProperty({ description: '成员ID' })
  @PrimaryGeneratedColumn()
  id: number;

  @ApiProperty({ description: '房间ID' })
  @Column()
  roomId: number;

  @ManyToOne(() => Room, (room) => room.members, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'roomId' })
  room: Room;

  @ApiProperty({ description: '成员类型 USER/GUEST' })
  @Column({ type: 'varchar', length: 16 })
  actorType: RoomActorType;

  @ApiProperty({ description: '成员来源ID（用户ID或游客ID）' })
  @Column()
  actorRefId: number;

  @ApiProperty({ description: '角色 OWNER/MEMBER' })
  @Column({ type: 'varchar', length: 16, default: ROOM_MEMBER_ROLE.MEMBER })
  role: RoomMemberRole;

  @ApiProperty({ description: '成员昵称' })
  @Column({ length: 64 })
  nickname: string;

  @ApiProperty({ description: '头像URL' })
  @Column({ length: 512, default: '' })
  avatar: string;

  @ApiProperty({ description: '头像简写' })
  @Column({ length: 8, default: '' })
  avatarInitials: string;

  @ApiProperty({ description: '当前积分' })
  @Column({ default: 0 })
  score: number;

  @ApiProperty({ description: '是否隐藏邀请卡片' })
  @Column({ default: false })
  inviteCardHidden: boolean;

  @ApiProperty({ description: '是否在线' })
  @Column({ default: true })
  isActive: boolean;

  @ApiProperty({ description: '加入时间' })
  @CreateDateColumn()
  joinedAt: Date;

  @ApiProperty({ description: '更新时间' })
  @UpdateDateColumn()
  updatedAt: Date;
}
