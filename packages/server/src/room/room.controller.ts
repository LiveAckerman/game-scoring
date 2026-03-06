import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { RoomService } from './room.service';
import {
  AddMemberDto,
  AddScoreDto,
  CreateRoomDto,
  JoinRoomDto,
  ListRoomHistoryQueryDto,
  TransferOwnerDto,
} from './dto';

@ApiTags('房间')
@Controller('rooms')
export class RoomController {
  constructor(private readonly roomService: RoomService) { }

  @Post()
  @ApiOperation({ summary: '创建房间（多人记分）' })
  @ApiBody({ type: CreateRoomDto })
  @ApiResponse({ status: 201, description: '创建成功' })
  createRoom(@Req() req: Request, @Body() dto: CreateRoomDto) {
    return this.roomService.createRoom(req, dto);
  }

  @Post('join')
  @ApiOperation({ summary: '通过房间号加入房间' })
  @ApiBody({ type: JoinRoomDto })
  @ApiResponse({ status: 200, description: '加入成功' })
  joinRoom(@Req() req: Request, @Body() dto: JoinRoomDto) {
    return this.roomService.joinRoom(req, dto);
  }

  @Get('code/:roomCode')
  @ApiOperation({ summary: '按房间号获取房间详情' })
  @ApiParam({ name: 'roomCode', description: '6位房间号' })
  @ApiResponse({ status: 200, description: '查询成功' })
  getByCode(@Req() req: Request, @Param('roomCode') roomCode: string) {
    return this.roomService.getRoomByCode(req, roomCode);
  }

  @Get('history')
  @ApiOperation({ summary: '查询当前用户历史对局记录' })
  @ApiResponse({ status: 200, description: '查询成功' })
  getHistory(
    @Req() req: Request,
    @Query() query: ListRoomHistoryQueryDto,
  ) {
    return this.roomService.getHistory(req, query);
  }

  @Post(':roomId/members')
  @ApiOperation({ summary: '桌主添加虚拟成员' })
  @ApiParam({ name: 'roomId', description: '房间ID' })
  @ApiBody({ type: AddMemberDto })
  @ApiResponse({ status: 201, description: '添加成功' })
  addMember(
    @Req() req: Request,
    @Param('roomId', ParseIntPipe) roomId: number,
    @Body() dto: AddMemberDto,
  ) {
    return this.roomService.addMember(req, roomId, dto);
  }

  @Post(':roomId/score')
  @ApiOperation({ summary: '成员给分' })
  @ApiParam({ name: 'roomId', description: '房间ID' })
  @ApiBody({ type: AddScoreDto })
  @ApiResponse({ status: 200, description: '记分成功' })
  addScore(
    @Req() req: Request,
    @Param('roomId', ParseIntPipe) roomId: number,
    @Body() dto: AddScoreDto,
  ) {
    return this.roomService.addScore(req, roomId, dto);
  }

  @Post(':roomId/transfer-owner')
  @ApiOperation({ summary: '转移桌主' })
  @ApiParam({ name: 'roomId', description: '房间ID' })
  @ApiBody({ type: TransferOwnerDto })
  @ApiResponse({ status: 200, description: '转移成功' })
  transferOwner(
    @Req() req: Request,
    @Param('roomId', ParseIntPipe) roomId: number,
    @Body() dto: TransferOwnerDto,
  ) {
    return this.roomService.transferOwner(req, roomId, dto);
  }

  @Post(':roomId/end')
  @ApiOperation({ summary: '结束房间（仅桌主）' })
  @ApiParam({ name: 'roomId', description: '房间ID' })
  @ApiResponse({ status: 200, description: '结束成功' })
  endRoom(@Req() req: Request, @Param('roomId', ParseIntPipe) roomId: number) {
    return this.roomService.endRoom(req, roomId);
  }

  @Post(':roomId/invite-card/hide')
  @ApiOperation({ summary: '当前成员隐藏邀请卡片' })
  @ApiParam({ name: 'roomId', description: '房间ID' })
  @ApiResponse({ status: 200, description: '隐藏成功' })
  hideInviteCard(
    @Req() req: Request,
    @Param('roomId', ParseIntPipe) roomId: number,
  ) {
    return this.roomService.hideInviteCard(req, roomId);
  }
}
