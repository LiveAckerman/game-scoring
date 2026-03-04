import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GuestController } from './guest.controller';
import { GuestService } from './guest.service';
import { GuestUser } from './entities/guest-user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([GuestUser])],
  controllers: [GuestController],
  providers: [GuestService],
  exports: [GuestService, TypeOrmModule],
})
export class GuestModule { }
