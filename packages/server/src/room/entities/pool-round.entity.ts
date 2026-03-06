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

export const POOL_ROUND_STATUS = {
  IN_PROGRESS: 'IN_PROGRESS',
  ENDED: 'ENDED',
} as const;

export type PoolRoundStatus =
  (typeof POOL_ROUND_STATUS)[keyof typeof POOL_ROUND_STATUS];

@Entity('pool_rounds')
@Index('idx_pool_rounds_room_id', ['roomId'])
export class PoolRound {
  @ApiProperty({ description: '圈ID' })
  @PrimaryGeneratedColumn()
  id: number;

  @ApiProperty({ description: '房间ID' })
  @Column()
  roomId: number;

  @ManyToOne(() => Room, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'roomId' })
  room: Room;

  @ApiProperty({ description: '圈序号（从1开始）' })
  @Column()
  roundNumber: number;

  @ApiProperty({ description: '分数池当前余额' })
  @Column({ default: 0 })
  poolBalance: number;

  @ApiProperty({ description: '圈状态' })
  @Column({ type: 'varchar', length: 16, default: POOL_ROUND_STATUS.IN_PROGRESS })
  status: PoolRoundStatus;

  @ApiProperty({ description: '创建时间' })
  @CreateDateColumn()
  createdAt: Date;

  @ApiProperty({ description: '结束时间' })
  @Column({ type: 'datetime', nullable: true })
  endedAt: Date | null;
}
