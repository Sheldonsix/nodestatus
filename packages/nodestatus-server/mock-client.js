import os from 'os';
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
let gpuUsed = 12;
let temperature = 42;
let tcpConnCount = 80;
let udpConnCount = 12;
let processCount = 140;

const cpuList = os.cpus();
const cpuCount = Math.max(cpuList.length, 1);
const cpuInfo = [cpuList[0]?.model || 'Mock CPU'];
const platform = process.platform === 'win32' ? 'Windows' : os.platform();

const random = (min, max) => min + Math.random() * (max - min);
const jitter = (value, amount, min, max) => Math.min(max, Math.max(min, value + random(-amount, amount)));

const createStatus = () => {
  const networkIn = random(1 * MiB, 30 * MiB);
  const networkOut = random(256 * KiB, 8 * MiB);
  const cpu = random(8, 90);
  const load1 = Number(((cpu / 100) * cpuCount + random(0, 0.3)).toFixed(2));
  const load5 = Number(((cpu / 100) * cpuCount * 0.85 + random(0, 0.2)).toFixed(2));
  const load15 = Number(((cpu / 100) * cpuCount * 0.7 + random(0, 0.15)).toFixed(2));

  rx += networkIn * (INTERVAL / 1000);
  tx += networkOut * (INTERVAL / 1000);
  memoryUsed = jitter(memoryUsed, 128 * KiB, 512 * KiB, 7 * MiB);
  hddUsed = Math.min(120 * KiB, hddUsed + random(0, 20));
  gpuUsed = jitter(gpuUsed, 8, 0, 95);
  temperature = jitter(temperature, 2, 32, 82);
  tcpConnCount = jitter(tcpConnCount, 12, 20, 240);
  udpConnCount = jitter(udpConnCount, 4, 1, 50);
  processCount = jitter(processCount, 10, 80, 260);

  return {
    online4: true,
    online6: true,
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    load: load1,
    load1,
    load5,
    load15,
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
    platform,
    platform_version: os.release(),
    arch: os.arch(),
    virtualization: 'mock',
    cpu_info: cpuInfo,
    gpu_info: ['Mock GPU'],
    version: 'mock-client',
    tcp_conn_count: Math.round(tcpConnCount),
    udp_conn_count: Math.round(udpConnCount),
    process_count: Math.round(processCount),
    temperatures: Number(temperature.toFixed(1)),
    gpu: Math.round(gpuUsed),
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
