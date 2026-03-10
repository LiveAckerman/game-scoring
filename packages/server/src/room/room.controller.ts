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
  KickMemberDto,
  LeaveRoomResponseDto,
  ListRoomHistoryQueryDto,
  TransferOwnerDto,
  PoolGiveDto,
  PoolTakeDto,
  PoolTableTakeDto,
  ToggleTableFeeDto,
  SetSpectatorsDto,
} from './dto';

@ApiTags('房间')
@Controller({ path: 'rooms', version: '1' })
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

  @Post(':roomId/leave')
  @ApiOperation({ summary: '当前成员退出房间' })
  @ApiParam({ name: 'roomId', description: '房间ID' })
  @ApiResponse({ status: 200, description: '退出成功', type: LeaveRoomResponseDto })
  leaveRoom(@Req() req: Request, @Param('roomId', ParseIntPipe) roomId: number) {
    return this.roomService.leaveRoom(req, roomId);
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

  @Post(':roomId/kick-member')
  @ApiOperation({ summary: '桌主踢出成员并原路退回积分' })
  @ApiParam({ name: 'roomId', description: '房间ID' })
  @ApiBody({ type: KickMemberDto })
  @ApiResponse({ status: 200, description: '踢出成功' })
  kickMember(
    @Req() req: Request,
    @Param('roomId', ParseIntPipe) roomId: number,
    @Body() dto: KickMemberDto,
  ) {
    return this.roomService.kickMember(req, roomId, dto);
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

  // ───────── 分数池 API ─────────

  @Post(':roomId/pool/round')
  @ApiOperation({ summary: '开启新的一圈（仅桌主）' })
  @ApiParam({ name: 'roomId', description: '房间ID' })
  @ApiResponse({ status: 201, description: '开启成功' })
  startPoolRound(
    @Req() req: Request,
    @Param('roomId', ParseIntPipe) roomId: number,
  ) {
    return this.roomService.startPoolRound(req, roomId);
  }

  @Get(':roomId/pool/round/current')
  @ApiOperation({ summary: '获取当前进行中的圈' })
  @ApiParam({ name: 'roomId', description: '房间ID' })
  @ApiResponse({ status: 200, description: '查询成功' })
  getCurrentPoolRound(
    @Req() req: Request,
    @Param('roomId', ParseIntPipe) roomId: number,
  ) {
    return this.roomService.getCurrentPoolRound(req, roomId);
  }

  @Get(':roomId/pool/round/:roundId')
  @ApiOperation({ summary: '获取指定圈信息' })
  @ApiParam({ name: 'roomId', description: '房间ID' })
  @ApiParam({ name: 'roundId', description: '圈ID' })
  @ApiResponse({ status: 200, description: '查询成功' })
  getPoolRound(
    @Req() req: Request,
    @Param('roomId', ParseIntPipe) roomId: number,
    @Param('roundId', ParseIntPipe) roundId: number,
  ) {
    return this.roomService.getPoolRound(req, roomId, roundId);
  }

  @Get(':roomId/pool/rounds')
  @ApiOperation({ summary: '获取所有圈摘要' })
  @ApiParam({ name: 'roomId', description: '房间ID' })
  @ApiResponse({ status: 200, description: '查询成功' })
  getPoolRounds(
    @Req() req: Request,
    @Param('roomId', ParseIntPipe) roomId: number,
  ) {
    return this.roomService.getPoolRounds(req, roomId);
  }

  @Post(':roomId/pool/give')
  @ApiOperation({ summary: '给分到分数池' })
  @ApiParam({ name: 'roomId', description: '房间ID' })
  @ApiBody({ type: PoolGiveDto })
  @ApiResponse({ status: 200, description: '给分成功' })
  poolGive(
    @Req() req: Request,
    @Param('roomId', ParseIntPipe) roomId: number,
    @Body() dto: PoolGiveDto,
  ) {
    return this.roomService.poolGive(req, roomId, dto);
  }

  @Post(':roomId/pool/take')
  @ApiOperation({ summary: '从分数池取分' })
  @ApiParam({ name: 'roomId', description: '房间ID' })
  @ApiBody({ type: PoolTakeDto })
  @ApiResponse({ status: 200, description: '取分成功' })
  poolTake(
    @Req() req: Request,
    @Param('roomId', ParseIntPipe) roomId: number,
    @Body() dto: PoolTakeDto,
  ) {
    return this.roomService.poolTake(req, roomId, dto);
  }

  @Post(':roomId/pool/table-take')
  @ApiOperation({ summary: '台板取分' })
  @ApiParam({ name: 'roomId', description: '房间ID' })
  @ApiBody({ type: PoolTableTakeDto })
  @ApiResponse({ status: 200, description: '台板取分成功' })
  poolTableTake(
    @Req() req: Request,
    @Param('roomId', ParseIntPipe) roomId: number,
    @Body() dto: PoolTableTakeDto,
  ) {
    return this.roomService.poolTableTake(req, roomId, dto);
  }

  @Post(':roomId/pool/round/:roundId/end')
  @ApiOperation({ summary: '结束本圈（仅桌主）' })
  @ApiParam({ name: 'roomId', description: '房间ID' })
  @ApiParam({ name: 'roundId', description: '圈ID' })
  @ApiResponse({ status: 200, description: '结束成功' })
  endPoolRound(
    @Req() req: Request,
    @Param('roomId', ParseIntPipe) roomId: number,
    @Param('roundId', ParseIntPipe) roundId: number,
  ) {
    return this.roomService.endPoolRound(req, roomId, roundId);
  }

  // ───────── 台板 / 旁观者 API ─────────

  @Post(':roomId/table-fee')
  @ApiOperation({ summary: '开关台板（仅桌主）' })
  @ApiParam({ name: 'roomId', description: '房间ID' })
  @ApiBody({ type: ToggleTableFeeDto })
  @ApiResponse({ status: 200, description: '操作成功' })
  toggleTableFee(
    @Req() req: Request,
    @Param('roomId', ParseIntPipe) roomId: number,
    @Body() dto: ToggleTableFeeDto,
  ) {
    return this.roomService.toggleTableFee(req, roomId, dto);
  }

  @Post(':roomId/spectators')
  @ApiOperation({ summary: '设置旁观者（仅桌主）' })
  @ApiParam({ name: 'roomId', description: '房间ID' })
  @ApiBody({ type: SetSpectatorsDto })
  @ApiResponse({ status: 200, description: '设置成功' })
  setSpectators(
    @Req() req: Request,
    @Param('roomId', ParseIntPipe) roomId: number,
    @Body() dto: SetSpectatorsDto,
  ) {
    return this.roomService.setSpectators(req, roomId, dto);
  }
}
