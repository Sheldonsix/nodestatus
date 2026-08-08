import { Server } from 'http';
import { isIPv4 } from 'net';
import timers from 'timers/promises';
import { WebSocketServer, WebSocket } from 'ws';
import { decode } from '@msgpack/msgpack';
import ipaddr, { IPv6 } from 'ipaddr.js';
import log4js from 'log4js';
import { authServer, getListServers, getServer } from '../controller/status';
import { createServerHistory, deleteServerHistoryBefore } from '../model/history';
import { logger, emitter } from './utils';
import setupHeartbeat from './heartbeat';
import type {
  BandwidthHistoryPoint,
  Box,
  ServerItem,
  BoxItem,
  IWebSocket
} from '../../types/server';

const { getLogger } = log4js;

const loggerConnected = getLogger('Connected');
const loggerConnecting = getLogger('Connecting');
const loggerDisconnected = getLogger('Disconnected');
const loggerBanned = getLogger('Banned');
const MAX_HISTORY_POINTS = 1800;
const HISTORY_SAMPLE_INTERVAL = 2000;
const HISTORY_FLUSH_INTERVAL = 5 * 60 * 1000;
const HISTORY_TTL = 30 * 24 * 60 * 60 * 1000;
const HISTORY_TTL_INTERVAL = 24 * 60 * 60 * 1000;

type Options = {
  interval: number;
  pingInterval: number;
  reconnectTimeout: number;
};

type CallbackType =
  | 'onServerConnect'
  | 'onServerBanned'
  | 'onServerConnected'
  | 'onServerDisconnected'
  | 'onServerFinish';
type CallbackFn = (...args: any) => unknown;
type CallbackFunction = {
  [key in CallbackType]: CallbackFn[];
};

type TrafficTotals = {
  rx: number;
  tx: number;
};

type HistoryAggregate = {
  server_id: number;
  time: number;
  cpu: number;
  memory_used: number;
  memory_total: number;
  network_in: number;
  network_out: number;
  network_rx: number;
  network_tx: number;
  count: number;
};

const toNumber = (value: unknown): number => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const pruneHistory = async (): Promise<void> => {
  try {
    await deleteServerHistoryBefore(new Date(Date.now() - HISTORY_TTL));
  } catch (error: any) {
    logger.error(`Failed to prune history: ${error.message || error}`);
  }
};

// eslint-disable-next-line import/no-mutable-exports
export let nodeStatusInstance: NodeStatus;

export default class NodeStatus {
  private readonly options!: Options;

  public server!: Server;

  private ioPub = new WebSocketServer({ noServer: true });

  private ioConn = new WebSocketServer({ noServer: true });

  /* username -> socket */
  private userMap = new Map<string, IWebSocket>();

  /* ip -> banned */
  private isBanned = new Map<string, boolean>();

  /* Username -> timer */
  private timerMap = new Map<string, NodeJS.Timeout>();

  private callbackFn: CallbackFunction = {
    onServerConnect: [],
    onServerBanned: [],
    onServerConnected: [],
    onServerDisconnected: [],
    onServerFinish: []
  };

  public servers: Record<string, ServerItem> = {};

  public historyMap = new Map<string, BandwidthHistoryPoint[]>();

  private historyAggregateMap = new Map<string, HistoryAggregate>();

  private trafficMap = new Map<string, TrafficTotals>();

  private isHistoryFlushing = false;

  public serversPub: ServerItem[] = [];

  constructor(server: Server, options: Options) {
    this.server = server;
    this.options = options;
    nodeStatusInstance = this;
    emitter.on('update', this.updateStatus.bind(this));
  }

  private registerCallback(type: CallbackType, fn: CallbackFn) {
    this.callbackFn[type].push(fn);
  }

  public onServerConnect(fn: (socket: IWebSocket) => unknown) {
    this.registerCallback('onServerConnect', fn);
  }

  public onServerBanned(fn: (socket: IWebSocket, address: string, reason: string) => unknown) {
    this.registerCallback('onServerBanned', fn);
  }

  public onServerConnected(fn: (socket: IWebSocket, username: string) => unknown) {
    this.registerCallback('onServerConnected', fn);
  }

  public onServerDisconnected(fn: (socket: IWebSocket, username: string) => unknown) {
    this.registerCallback('onServerDisconnected', fn);
  }

  public onServerFinish(fn: (socket: null, username: string) => unknown) {
    this.registerCallback('onServerFinish', fn);
  }

  private callHook(hook: CallbackType, ...args: any[]) {
    logger.debug(`[hook]: ${hook}`);
    try {
      const fns = this.callbackFn[hook];
      for (const fn of fns) fn.apply(this, args);
    } catch (error: any) {
      logger.error(`[hook]: ${hook} error: ${error.message || error}`);
    }
  }

  private setBan(socket: WebSocket, address: string, t: number, reason: string): void {
    socket.close();
    if (this.isBanned.get(address)) return;
    this.isBanned.set(address, true);
    loggerBanned.debug('Address:', address, '|', 'Reason:', reason);
    this.callHook('onServerBanned', socket, address, reason);
    setTimeout(() => this.isBanned.delete(address), t * 1000);
  }

  private pushHistoryPoint(username: string, point: BandwidthHistoryPoint): void {
    if (!this.historyMap.has(username)) {
      this.historyMap.set(username, []);
    }

    const arr = this.historyMap.get(username)!;
    arr.push(point);
    if (arr.length > MAX_HISTORY_POINTS) arr.shift();
  }

  private getTrafficDelta(username: string, status: ServerItem['status']): TrafficTotals {
    const current = {
      rx: toNumber(status.network_rx),
      tx: toNumber(status.network_tx)
    };
    const previous = this.trafficMap.get(username);
    this.trafficMap.set(username, current);
    if (!previous) return { rx: 0, tx: 0 };
    return {
      rx: current.rx >= previous.rx ? current.rx - previous.rx : 0,
      tx: current.tx >= previous.tx ? current.tx - previous.tx : 0
    };
  }

  private updateHistoryAggregate(username: string, status: ServerItem['status'], point: BandwidthHistoryPoint): void {
    const serverId = this.servers[username]?.id;
    if (!serverId) return;

    const aggregate = this.historyAggregateMap.get(username) || {
      server_id: serverId,
      time: point.time,
      cpu: 0,
      memory_used: 0,
      memory_total: 0,
      network_in: 0,
      network_out: 0,
      network_rx: 0,
      network_tx: 0,
      count: 0
    };

    aggregate.server_id = serverId;
    aggregate.time = point.time;
    aggregate.cpu += toNumber(status.cpu);
    aggregate.memory_used += toNumber(status.memory_used);
    aggregate.memory_total += toNumber(status.memory_total);
    aggregate.network_in += point.in ?? 0;
    aggregate.network_out += point.out ?? 0;
    aggregate.network_rx += point.rx ?? 0;
    aggregate.network_tx += point.tx ?? 0;
    aggregate.count += 1;

    this.historyAggregateMap.set(username, aggregate);
  }

  private sampleHistory(): void {
    const now = Date.now();
    for (const username of this.userMap.keys()) {
      const status = this.servers[username]?.status;
      if (!status) continue;
      if (
        status.network_in === undefined
        && status.network_out === undefined
        && status.network_rx === undefined
        && status.network_tx === undefined
      ) continue;

      const traffic = this.getTrafficDelta(username, status);
      const point = {
        time: now,
        in: toNumber(status.network_in),
        out: toNumber(status.network_out),
        rx: traffic.rx,
        tx: traffic.tx
      };

      this.pushHistoryPoint(username, point);
      this.updateHistoryAggregate(username, status, point);
    }
  }

  private async flushHistory(): Promise<void> {
    if (this.isHistoryFlushing) return;
    const entries = Array.from(this.historyAggregateMap.entries()).filter(([, item]) => item.count > 0);
    if (!entries.length) return;

    this.isHistoryFlushing = true;
    try {
      await createServerHistory(entries.map(([, item]) => ({
        server_id: item.server_id,
        created_at: new Date(item.time),
        cpu: item.cpu / item.count,
        memory_used: item.memory_used / item.count,
        memory_total: item.memory_total / item.count,
        network_in: item.network_in / item.count,
        network_out: item.network_out / item.count,
        network_rx: item.network_rx,
        network_tx: item.network_tx
      })));

      for (const [username, item] of entries) {
        if (this.historyAggregateMap.get(username) === item) {
          this.historyAggregateMap.delete(username);
        }
      }
    } catch (error: any) {
      logger.error(`Failed to persist history: ${error.message || error}`);
    } finally {
      this.isHistoryFlushing = false;
    }
  }

  public launch(): Promise<void> {
    const { interval, pingInterval } = this.options;

    setupHeartbeat(this.ioConn, pingInterval);
    setupHeartbeat(this.ioPub, pingInterval);

    this.server.on('upgrade', (request, socket, head) => {
      const pathname = request.url;
      if (pathname === '/connect') {
        this.ioConn.handleUpgrade(request, socket, head, (ws: IWebSocket) => {
          ws.ipAddress = (request.headers['x-forwarded-for'] as any)?.split(',')?.[0]?.trim() || request.socket.remoteAddress;
          this.ioConn.emit('connection', ws);
        });
      } else if (pathname === '/public') {
        this.ioPub.handleUpgrade(request, socket, head, ws => {
          this.ioPub.emit('connection', ws);
        });
      } else {
        socket.destroy();
      }
    });

    this.ioConn.on('connection', (socket: IWebSocket) => {
      const address = socket.ipAddress;
      if (typeof address === 'undefined') {
        return socket.close();
      }
      this.callHook('onServerConnect', socket);
      socket.send('Authentication required');
      loggerConnecting.debug(`Address: ${address}`);
      socket.once('message', async (buf: Buffer) => {
        if (this.isBanned.get(address)) {
          socket.send('You are banned. Please try connecting after 60 / 120 seconds');
          return socket.close();
        }
        let username = '',
          password = '';
        try {
          ({ username, password } = decode(buf) as any);
          username = username.trim();
          password = password.trim();
          if (!this.servers[username] || !(await authServer(username, password))) {
            socket.send('Wrong username and/or password.');
            return this.setBan(socket, address, 120, 'Wrong username and/or password.');
          }

          socket.status = 0;

          /*
           * 当客户端与服务端断开连接时，客户端会自动重连。但是服务端可能需要等待下一个心跳检测周期才能断开与客户端的连接
           * Temporary Fix
           * Work in Progress
           *   */
          if (Object.keys(this.servers[username]?.status || {}).length) {
            const preSocket = this.userMap.get(username);
            if (preSocket) {
              if (preSocket.ipAddress === address) {
                preSocket.status = 1;
                socket.status = 2;
                preSocket.terminate();
              } else {
                preSocket.isAlive = false;
                preSocket.ping();
                const ac = new AbortController();
                const promise = timers.setTimeout((pingInterval + 5) * 1000, null, { signal: ac.signal });
                preSocket.on('close', () => ac.abort());
                try {
                  await promise;
                  socket.send('Only one connection per user allowed.');
                  return this.setBan(socket, address, 120, 'Only one connection per user allowed.');
                  // eslint-disable-next-line no-empty
                } catch (error: any) { }
              }
            }
          }
        } catch (error: any) {
          socket.send('Please check your login details.');
          return this.setBan(socket, address, 120, 'it is an idiot.');
        }
        socket.send('Authentication successful. Access granted.');
        let ipType = 'IPv6';
        if (isIPv4(address) || (ipaddr.IPv6.parse(address) as IPv6).isIPv4MappedAddress()) {
          ipType = 'IPv4';
        }
        socket.send(`You are connecting via: ${ipType}`);
        loggerConnected.info(`Username: ${username} | Address: ${address}`);
        socket.on('message', (buf: Buffer) => (this.servers[username].status = decode(buf) as ServerItem['status']));
        this.userMap.set(username, socket);

        const timer = this.timerMap.get(username);
        if (timer) {
          clearTimeout(timer);
          this.timerMap.delete(username);
        } else if (socket.status !== 2) {
          this.callHook('onServerConnected', socket, username);
        }

        socket.once('close', () => {
          if (socket.status === 1) {
            return;
          }

          this.userMap.delete(username);
          this.servers[username] && (this.servers[username].status = {});
          this.trafficMap.delete(username);
          this.pushHistoryPoint(username, {
            time: Date.now(),
            in: null,
            out: null,
            rx: null,
            tx: null
          });
          loggerDisconnected.warn(`Username: ${username} | Address: ${address}`);

          this.callHook('onServerDisconnected', socket, username);

          const timer = setTimeout(() => {
            this.callHook('onServerFinish', null as any, username);
            this.timerMap.delete(username);
          }, this.options.reconnectTimeout * 1000);

          this.timerMap.set(username, timer);
        });
      });
    });

    this.ioPub.on('connection', socket => {
      const runPush = () => socket.send(
        JSON.stringify({
          servers: this.serversPub,
          updated: ~~(Date.now() / 1000)
        })
      );
      runPush();
      const id = setInterval(runPush, interval);
      socket.on('close', () => clearInterval(id));
    });

    setInterval(() => this.sampleHistory(), HISTORY_SAMPLE_INTERVAL);
    setInterval(() => this.flushHistory(), HISTORY_FLUSH_INTERVAL);
    pruneHistory();
    setInterval(pruneHistory, HISTORY_TTL_INTERVAL);

    return this.updateStatus();
  }

  private async updateStatus(username?: string, shouldDisconnect = false): Promise<void> {
    if (username) {
      const server = (await getServer(username)).data as BoxItem | null;
      if (!server) {
        delete this.servers[username];
        this.historyMap.delete(username);
        this.historyAggregateMap.delete(username);
        this.trafficMap.delete(username);
      } else {
        this.servers[username] = Object.assign(server, {
          status: this.servers?.[username]?.status || {},
          username
        });
      }
      shouldDisconnect && this.userMap.get(username)?.terminate() && this.userMap.delete(username);
    } else {
      const box = (await getListServers()).data as Box | null;
      if (!box) return;
      for (const k of Object.keys(box)) {
        if (!this.servers[k]) this.servers[k] = Object.assign(box[k], { status: {}, username: k });
        this.servers[k].order = box[k].order;
      }
      for (const k of Object.keys(this.servers)) {
        if (!box[k]) {
          delete this.servers[k];
          this.historyMap.delete(k);
          this.historyAggregateMap.delete(k);
          this.trafficMap.delete(k);
        }
      }
      if (shouldDisconnect) {
        for (const socket of this.userMap.values()) {
          socket.terminate();
        }
        this.userMap.clear();
      }
    }
    this.serversPub = Object.values(this.servers).sort((x, y) => y.order - x.order);
  }
}
