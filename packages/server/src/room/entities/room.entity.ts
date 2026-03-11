import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { RoomMember } from './room-member.entity';
import { RoomScoreRecord } from './room-score-record.entity';

export const ROOM_STATUS = {
  IN_PROGRESS: 'IN_PROGRESS',
  ENDED: 'ENDED',
} as const;

export type RoomStatus = (typeof ROOM_STATUS)[keyof typeof ROOM_STATUS];

export const ROOM_TYPE = {
  MULTI: 'MULTI',
  SINGLE: 'SINGLE',
  POOL: 'POOL',
} as const;

export type RoomType = (typeof ROOM_TYPE)[keyof typeof ROOM_TYPE];

@Entity('rooms')
export class Room {
  @ApiProperty({ description: '房间ID' })
  @PrimaryGeneratedColumn()
  id: number;

  @ApiProperty({ description: '6位房间号' })
  @Column({ length: 6, unique: true })
  roomCode: string;

  @ApiProperty({ description: '房间名称' })
  @Column({ length: 64, default: '' })
  roomName: string;

  @ApiProperty({ description: '房间类型 MULTI/SINGLE/POOL' })
  @Column({ type: 'varchar', length: 16, default: ROOM_TYPE.MULTI })
  roomType: RoomType;

  @ApiProperty({ description: '是否开启台板（多人记分/分数池）' })
  @Column({ default: false })
  tableFeeEnabled: boolean;

  @ApiProperty({ description: '房间状态' })
  @Column({ type: 'varchar', length: 16, default: ROOM_STATUS.IN_PROGRESS })
  status: RoomStatus;

  @ApiProperty({ description: '桌主成员ID' })
  @Column({ type: 'int', nullable: true, default: null })
  ownerMemberId: number | null;

  @ApiProperty({ description: '创建者类型 USER/GUEST' })
  @Column({ type: 'varchar', length: 16 })
  createdByType: string;

  @ApiProperty({ description: '创建者引用ID' })
  @Column()
  createdByRefId: number;

  @ApiProperty({ description: '结束时间', required: false })
  @Column({ type: 'datetime', nullable: true })
  endedAt: Date | null;

  @ApiProperty({ description: '创建时间' })
  @CreateDateColumn()
  createdAt: Date;

  @ApiProperty({ description: '更新时间' })
  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => RoomMember, (member) => member.room)
  members: RoomMember[];

  @OneToMany(() => RoomScoreRecord, (record) => record.room)
  scoreRecords: RoomScoreRecord[];
}
