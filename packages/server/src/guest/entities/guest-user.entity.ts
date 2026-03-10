import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

@Entity('guest_users')
export class GuestUser {
  @ApiProperty({ description: '游客ID' })
  @PrimaryGeneratedColumn()
  id: number;

  @ApiProperty({ description: '游客会话Token' })
  @Column({ length: 80, unique: true })
  token: string;

  @ApiProperty({ description: '设备标识' })
  @Column({ length: 80, default: '' })
  deviceId: string;

  @ApiProperty({ description: '昵称' })
  @Column({ length: 64 })
  nickname: string;

  @ApiProperty({ description: '头像简写' })
  @Column({ length: 8, default: '' })
  avatarInitials: string;

  @ApiProperty({ description: '是否启用' })
  @Column({ default: true })
  isActive: boolean;

  @ApiProperty({ description: '创建时间' })
  @CreateDateColumn()
  createdAt: Date;

  @ApiProperty({ description: '更新时间' })
  @UpdateDateColumn()
  updatedAt: Date;
}
