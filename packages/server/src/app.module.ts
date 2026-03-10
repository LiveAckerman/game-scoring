import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { User } from './user/entities/user.entity';
import { GuestModule } from './guest/guest.module';
import { RoomModule } from './room/room.module';
import { RealtimeModule } from './realtime/realtime.module';
import { AppInfoModule } from './app-info/app-info.module';
import { GuestUser } from './guest/entities/guest-user.entity';
import { Room, RoomMember, RoomScoreRecord, PoolRound, PoolRecord } from './room/entities';

@Module({
  imports: [
    // 环境变量配置
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // 数据库配置（支持 SQLite / MySQL 切换）
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const dbType = configService.get<string>('DB_TYPE', 'sqlite');

        if (dbType === 'mysql') {
          return {
            type: 'mysql',
            host: configService.get<string>('DB_HOST', 'localhost'),
            port: configService.get<number>('DB_PORT', 3306),
            username: configService.get<string>('DB_USERNAME', 'root'),
            password: configService.get<string>('DB_PASSWORD', ''),
            database: configService.get<string>(
              'DB_DATABASE',
              'happy_score_hall',
            ),
            entities: [User, GuestUser, Room, RoomMember, RoomScoreRecord, PoolRound, PoolRecord],
            synchronize: true, // 开发环境自动同步，生产环境请关闭
            charset: 'utf8mb4',
          };
        }

        // 默认使用 SQLite
        return {
          type: 'better-sqlite3',
          database: configService.get<string>(
            'DB_DATABASE',
            'happy_score_hall.sqlite',
          ),
          entities: [User, GuestUser, Room, RoomMember, RoomScoreRecord, PoolRound, PoolRecord],
          synchronize: true,
        };
      },
    }),

    AuthModule,
    GuestModule,
    UserModule,
    RoomModule,
    RealtimeModule,
    AppInfoModule,
  ],
})
export class AppModule { }
