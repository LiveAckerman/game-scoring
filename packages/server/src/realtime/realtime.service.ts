import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { IncomingMessage, Server } from 'http';
import { RawData, WebSocket, WebSocketServer } from 'ws';

interface RealtimeClientMessage {
  type?: string;
  roomCode?: string;
}

interface RealtimeServerMessage {
  type: 'connected' | 'subscribed' | 'unsubscribed' | 'room_updated' | 'pong' | 'error';
  roomCode?: string;
  event?: string;
  message?: string;
  ts: number;
}

interface TrackedWebSocket extends WebSocket {
  isAlive?: boolean;
}

@Injectable()
export class RealtimeService implements OnModuleDestroy {
  private readonly logger = new Logger(RealtimeService.name);
  private webSocketServer: WebSocketServer | null = null;
  private readonly roomSocketMap = new Map<string, Set<TrackedWebSocket>>();
  private readonly socketRoomMap = new Map<TrackedWebSocket, Set<string>>();
  private heartbeatTimer: NodeJS.Timeout | null = null;

  bindServer(server: Server) {
    if (this.webSocketServer) {
      return;
    }

    this.webSocketServer = new WebSocketServer({
      server,
      path: '/ws',
    });

    this.webSocketServer.on('connection', (socket: TrackedWebSocket, req: IncomingMessage) => {
      this.handleConnection(socket, req);
    });

    this.heartbeatTimer = setInterval(() => {
      this.heartbeat();
    }, 30000);

    this.logger.log('Realtime WebSocket server is ready at /ws');
  }

  notifyRoomUpdated(roomCodeRaw: string, event = 'room_changed') {
    const roomCode = this.normalizeRoomCode(roomCodeRaw);
    if (!roomCode) {
      return;
    }

    const sockets = this.roomSocketMap.get(roomCode);
    if (!sockets || sockets.size === 0) {
      return;
    }

    const payload: RealtimeServerMessage = {
      type: 'room_updated',
      roomCode,
      event,
      ts: Date.now(),
    };

    for (const socket of sockets) {
      this.safeSend(socket, payload);
    }
  }

  onModuleDestroy() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.webSocketServer) {
      this.webSocketServer.close();
      this.webSocketServer = null;
    }

    this.roomSocketMap.clear();
    this.socketRoomMap.clear();
  }

  private handleConnection(socket: TrackedWebSocket, req: IncomingMessage) {
    socket.isAlive = true;

    socket.on('pong', () => {
      socket.isAlive = true;
    });

    socket.on('message', (rawData: RawData) => {
      this.handleClientMessage(socket, rawData);
    });

    socket.on('close', () => {
      this.cleanupSocket(socket);
    });

    socket.on('error', () => {
      this.cleanupSocket(socket);
    });

    const initialRoomCode = this.parseRoomCodeFromRequest(req);

    this.safeSend(socket, {
      type: 'connected',
      ts: Date.now(),
    });

    if (initialRoomCode) {
      this.subscribeRoom(socket, initialRoomCode);
    }
  }

  private handleClientMessage(socket: TrackedWebSocket, rawData: RawData) {
    const messageText = this.toText(rawData);
    if (!messageText) {
      return;
    }

    let message: RealtimeClientMessage;
    try {
      message = JSON.parse(messageText) as RealtimeClientMessage;
    } catch (error) {
      this.safeSend(socket, {
        type: 'error',
        message: 'invalid_message',
        ts: Date.now(),
      });
      return;
    }

    if (message.type === 'ping') {
      this.safeSend(socket, {
        type: 'pong',
        ts: Date.now(),
      });
      return;
    }

    if (message.type === 'subscribe') {
      const roomCode = this.normalizeRoomCode(message.roomCode);
      if (!roomCode) {
        this.safeSend(socket, {
          type: 'error',
          message: 'invalid_room_code',
          ts: Date.now(),
        });
        return;
      }
      this.subscribeRoom(socket, roomCode);
      return;
    }

    if (message.type === 'unsubscribe') {
      const roomCode = this.normalizeRoomCode(message.roomCode);
      if (!roomCode) {
        return;
      }
      this.unsubscribeRoom(socket, roomCode);
      return;
    }
  }

  private subscribeRoom(socket: TrackedWebSocket, roomCode: string) {
    const socketRooms = this.socketRoomMap.get(socket) || new Set<string>();
    if (!socketRooms.has(roomCode)) {
      socketRooms.add(roomCode);
      this.socketRoomMap.set(socket, socketRooms);
    }

    const roomSockets = this.roomSocketMap.get(roomCode) || new Set<TrackedWebSocket>();
    if (!roomSockets.has(socket)) {
      roomSockets.add(socket);
      this.roomSocketMap.set(roomCode, roomSockets);
    }

    this.safeSend(socket, {
      type: 'subscribed',
      roomCode,
      ts: Date.now(),
    });
  }

  private unsubscribeRoom(socket: TrackedWebSocket, roomCode: string) {
    const socketRooms = this.socketRoomMap.get(socket);
    if (socketRooms) {
      socketRooms.delete(roomCode);
      if (socketRooms.size === 0) {
        this.socketRoomMap.delete(socket);
      }
    }

    const roomSockets = this.roomSocketMap.get(roomCode);
    if (roomSockets) {
      roomSockets.delete(socket);
      if (roomSockets.size === 0) {
        this.roomSocketMap.delete(roomCode);
      }
    }

    this.safeSend(socket, {
      type: 'unsubscribed',
      roomCode,
      ts: Date.now(),
    });
  }

  private cleanupSocket(socket: TrackedWebSocket) {
    const rooms = this.socketRoomMap.get(socket);
    if (rooms) {
      for (const roomCode of rooms) {
        const roomSockets = this.roomSocketMap.get(roomCode);
        if (!roomSockets) {
          continue;
        }

        roomSockets.delete(socket);
        if (roomSockets.size === 0) {
          this.roomSocketMap.delete(roomCode);
        }
      }
    }

    this.socketRoomMap.delete(socket);
  }

  private heartbeat() {
    if (!this.webSocketServer) {
      return;
    }

    for (const socket of this.webSocketServer.clients) {
      const tracked = socket as TrackedWebSocket;
      if (tracked.isAlive === false) {
        tracked.terminate();
        this.cleanupSocket(tracked);
        continue;
      }

      tracked.isAlive = false;
      tracked.ping();
    }
  }

  private safeSend(socket: TrackedWebSocket, payload: RealtimeServerMessage) {
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }

    socket.send(JSON.stringify(payload));
  }

  private parseRoomCodeFromRequest(req: IncomingMessage): string | null {
    if (!req.url) {
      return null;
    }

    try {
      const fullUrl = new URL(req.url, 'http://localhost');
      return this.normalizeRoomCode(fullUrl.searchParams.get('roomCode'));
    } catch (error) {
      return null;
    }
  }

  private normalizeRoomCode(roomCodeRaw?: string | null): string | null {
    const roomCode = String(roomCodeRaw || '').replace(/\D/g, '').slice(0, 6);
    if (!/^\d{6}$/.test(roomCode)) {
      return null;
    }
    return roomCode;
  }

  private toText(rawData: RawData): string {
    if (typeof rawData === 'string') {
      return rawData;
    }

    if (rawData instanceof Buffer) {
      return rawData.toString('utf8');
    }

    if (Array.isArray(rawData)) {
      return Buffer.concat(rawData).toString('utf8');
    }

    if (rawData instanceof ArrayBuffer) {
      return Buffer.from(new Uint8Array(rawData)).toString('utf8');
    }

    return Buffer.from(
      rawData.buffer,
      rawData.byteOffset,
      rawData.byteLength,
    ).toString('utf8');
  }
}
