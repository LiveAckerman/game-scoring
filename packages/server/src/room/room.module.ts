import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { GuestModule } from '../guest/guest.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { User } from '../user/entities/user.entity';
import { GuestUser } from '../guest/entities/guest-user.entity';
import { RoomController } from './room.controller';
import { RoomService } from './room.service';
import { Room, RoomMember, RoomScoreRecord } from './entities';

@Module({
  imports: [
    TypeOrmModule.forFeature([Room, RoomMember, RoomScoreRecord, User, GuestUser]),
    AuthModule,
    GuestModule,
    RealtimeModule,
  ],
  controllers: [RoomController],
  providers: [RoomService],
  exports: [RoomService],
})
export class RoomModule { }
