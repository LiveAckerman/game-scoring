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
import { PoolRound } from './pool-round.entity';

export const POOL_RECORD_TYPE = {
  GIVE: 'GIVE',
  TAKE: 'TAKE',
} as const;

export type PoolRecordType =
  (typeof POOL_RECORD_TYPE)[keyof typeof POOL_RECORD_TYPE];

@Entity('pool_records')
@Index('idx_pool_records_round_id', ['roundId'])
@Index('idx_pool_records_room_id', ['roomId'])
export class PoolRecord {
  @ApiProperty({ description: '记录ID' })
  @PrimaryGeneratedColumn()
  id: number;

  @ApiProperty({ description: '圈ID' })
  @Column()
  roundId: number;

  @ManyToOne(() => PoolRound, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'roundId' })
  round: PoolRound;

  @ApiProperty({ description: '房间ID' })
  @Column()
  roomId: number;

  @ApiProperty({ description: '操作成员ID' })
  @Column()
  memberId: number;

  @ApiProperty({ description: '操作类型 GIVE/TAKE' })
  @Column({ type: 'varchar', length: 8 })
  type: PoolRecordType;

  @ApiProperty({ description: '分值（正数）' })
  @Column()
  points: number;

  @ApiProperty({ description: '创建时间' })
  @CreateDateColumn()
  createdAt: Date;
}
