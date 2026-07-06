import { io, Socket } from 'socket.io-client';
import { getAccessToken } from './api';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (socket) {
    // If socket gave up retrying (active=false), kick it back to life with fresh token
    if (!socket.active) {
      (socket as any).auth = { token: getAccessToken() ?? '' };
      socket.connect();
    }
    return socket;
  }
  socket = io(import.meta.env.VITE_API_URL ?? '', {
    // Dynamic auth: called on EVERY connection/reconnection attempt
    // so it always picks up the latest in-memory access token
    auth: (cb: (data: Record<string, string>) => void) => { cb({ token: getAccessToken() ?? '' }); },
    transports: ['polling', 'websocket'],
    reconnectionDelay: 2000,
    reconnectionDelayMax: 10_000,
    // Default reconnectionAttempts is Infinity - keep trying until token refreshes
  });
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
