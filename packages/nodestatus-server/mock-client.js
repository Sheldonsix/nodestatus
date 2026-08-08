import WebSocket from 'ws';
import { encode } from '@msgpack/msgpack';

const ws = new WebSocket('ws://127.0.0.1:35601/connect');
const INTERVAL = 2000;
const KiB = 1024;
const MiB = KiB * KiB;

const startedAt = Date.now();
let rx = 8 * MiB * 1024;
let tx = 2 * MiB * 1024;
let memoryUsed = 3 * MiB;
let hddUsed = 64 * KiB;

const random = (min, max) => min + Math.random() * (max - min);
const jitter = (value, amount, min, max) => Math.min(max, Math.max(min, value + random(-amount, amount)));

const createStatus = () => {
  const networkIn = random(1 * MiB, 30 * MiB);
  const networkOut = random(256 * KiB, 8 * MiB);
  const cpu = random(8, 90);

  rx += networkIn * (INTERVAL / 1000);
  tx += networkOut * (INTERVAL / 1000);
  memoryUsed = jitter(memoryUsed, 128 * KiB, 512 * KiB, 7 * MiB);
  hddUsed = Math.min(120 * KiB, hddUsed + random(0, 20));

  return {
    online4: true,
    online6: true,
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    load: Number((cpu / 32 + random(0, 0.8)).toFixed(2)),
    cpu: Math.round(cpu),
    network_rx: Math.round(rx),
    network_tx: Math.round(tx),
    network_in: Math.round(networkIn),
    network_out: Math.round(networkOut),
    memory_total: 8 * MiB,
    memory_used: Math.round(memoryUsed),
    swap_total: 2 * MiB,
    swap_used: Math.round(random(0, 256 * KiB)),
    hdd_total: 120 * KiB,
    hdd_used: Math.round(hddUsed),
    custom: 'mock-client'
  };
};

ws.on('open', () => {
  console.log('已连接，正在发送认证信息...');
  ws.send(encode({ username: 'test', password: '123' }));
});

ws.on('message', data => {
  const msg = data.toString();
  console.log('服务端返回:', msg);
  if (msg.includes('Authentication successful')) {
    console.log('认证成功！开始推送模拟带宽数据...');
    setInterval(() => {
      ws.send(encode(createStatus()));
    }, INTERVAL);
  } else if (msg.includes('Wrong username and/or password')) {
    console.error('【错误】认证失败！请先在网页端后台添加账号为 test 密码为 123 的节点！');
    process.exit(1);
  }
});

ws.on('close', () => console.log('连接被关闭'));
ws.on('error', err => console.error('WebSocket Error:', err.message));
