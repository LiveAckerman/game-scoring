import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { User } from './user/entities/user.entity';

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
            entities: [User],
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
          entities: [User],
          synchronize: true,
        };
      },
    }),

    AuthModule,
    UserModule,
  ],
})
export class AppModule { }
