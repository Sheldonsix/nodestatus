import WebSocket from 'ws';
import { encode } from '@msgpack/msgpack';

const ws = new WebSocket('ws://127.0.0.1:35601/connect');

ws.on('open', () => {
  console.log('已连接，正在发送认证信息...');
  ws.send(encode({ username: 'test', password: '123' }));
});

ws.on('message', (data) => {
  const msg = data.toString();
  console.log('服务端返回:', msg);
  
  if (msg.includes('Authentication successful')) {
    console.log('认证成功！开始推送模拟带宽数据...');
    let rx = 1000;
    let tx = 2000;
    
    setInterval(() => {
      rx += Math.random() * 5000;
      tx += Math.random() * 5000;
      
      const status = {
        online4: true,
        online6: false,
        uptime: 10000,
        load: 1.5,
        cpu: 25,
        network_rx: rx,
        network_tx: tx,
        network_in: Math.random() * 1024 * 500, 
        network_out: Math.random() * 1024 * 200, 
        memory_total: 4096,
        memory_used: 1024,
        swap_total: 1024,
        swap_used: 0,
        hdd_total: 100000,
        hdd_used: 50000,
        custom: ''
      };
      
      ws.send(encode(status));
    }, 2000);
  } else if (msg.includes('Wrong username and/or password')) {
    console.error('【错误】认证失败！请先在网页端后台添加账号为 test 密码为 123 的节点！');
    process.exit(1);
  }
});

ws.on('close', () => console.log('连接被关闭'));
ws.on('error', (err) => console.error('WebSocket Error:', err.message));
