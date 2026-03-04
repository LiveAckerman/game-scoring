import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { Room } from './room.entity';

@Entity('room_score_records')
@Index('idx_room_score_records_room_id', ['roomId'])
export class RoomScoreRecord {
  @ApiProperty({ description: '积分流水ID' })
  @PrimaryGeneratedColumn()
  id: number;

  @ApiProperty({ description: '房间ID' })
  @Column()
  roomId: number;

  @ManyToOne(() => Room, (room) => room.scoreRecords, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'roomId' })
  room: Room;

  @ApiProperty({ description: '出分方成员ID' })
  @Column()
  fromMemberId: number;

  @ApiProperty({ description: '收分方成员ID' })
  @Column()
  toMemberId: number;

  @ApiProperty({ description: '分值（正数）' })
  @Column()
  points: number;

  @ApiProperty({ description: '操作人成员ID' })
  @Column()
  createdByMemberId: number;

  @ApiProperty({ description: '创建时间' })
  @CreateDateColumn()
  createdAt: Date;
}
