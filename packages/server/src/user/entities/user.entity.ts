import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

@Entity('users')
export class User {
  @ApiProperty({ description: '用户ID' })
  @PrimaryGeneratedColumn()
  id: number;

  @ApiProperty({ description: '微信 OpenID' })
  @Column({ unique: true, length: 64 })
  openid: string;

  @ApiProperty({ description: '昵称', required: false })
  @Column({ length: 64, default: '' })
  nickname: string;

  @ApiProperty({ description: '头像 URL', required: false })
  @Column({ length: 512, default: '' })
  avatar: string;

  @ApiProperty({ description: '性别: 0-未知 1-男 2-女', required: false })
  @Column({ default: 0 })
  gender: number;

  @ApiProperty({ description: '称号', required: false })
  @Column({ length: 32, default: '' })
  title: string;

  @ApiProperty({ description: '场次数' })
  @Column({ default: 0 })
  totalGames: number;

  @ApiProperty({ description: '获胜次数' })
  @Column({ default: 0 })
  wins: number;

  @ApiProperty({ description: '微信 Session Key（不返回给前端）' })
  @Column({ length: 128, default: '', select: false })
  sessionKey: string;

  @ApiProperty({ description: '创建时间' })
  @CreateDateColumn()
  createdAt: Date;

  @ApiProperty({ description: '更新时间' })
  @UpdateDateColumn()
  updatedAt: Date;
}
