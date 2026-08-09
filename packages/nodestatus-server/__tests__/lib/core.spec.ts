import {
  afterEach, expect, test, vi
} from 'vitest';
import NodeStatus from '../../server/lib/core';
import { getListServers } from '../../server/controller/status';

vi.mock('../../server/controller/status', () => ({
  authServer: vi.fn(),
  getListServers: vi.fn(),
  getServer: vi.fn()
}));

vi.mock('../../server/model/history', () => ({
  createServerHistory: vi.fn(),
  deleteServerHistoryBefore: vi.fn()
}));

const GetListServers = vi.mocked(getListServers);

afterEach(() => {
  GetListServers.mockReset();
});

const createInstance = () => new NodeStatus({ on: vi.fn() } as any, {
  interval: 1000,
  pingInterval: 10,
  reconnectTimeout: 10
});

test('public status includes last_active when recorded', async () => {
  GetListServers.mockResolvedValueOnce({
    code: 0,
    msg: 'ok',
    data: {
      username: {
        id: 1,
        name: 'name',
        order: 1,
        region: 'US',
        type: 'vm',
        location: 'location'
      }
    }
  });

  const instance = createInstance();
  (instance as any).lastActiveMap.set('username', 1700000000);
  await (instance as any).updateStatus();

  expect(instance.serversPub).toEqual([
    expect.objectContaining({
      username: 'username',
      last_active: 1700000000,
      status: {}
    })
  ]);
});

test('sample history keeps recent resource points in memory', () => {
  vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
  const instance = createInstance();
  (instance as any).userMap.set('username', {});
  instance.servers.username = {
    id: 1,
    username: 'username',
    name: 'name',
    order: 1,
    region: 'US',
    type: 'vm',
    location: 'location',
    status: {
      online4: true,
      online6: false,
      uptime: 1,
      load: 0.1,
      cpu: 20,
      network_rx: 1000,
      network_tx: 2000,
      network_in: 30,
      network_out: 40,
      memory_total: 100,
      memory_used: 50,
      swap_total: 0,
      swap_used: 0,
      hdd_total: 1000,
      hdd_used: 500,
      custom: ''
    }
  };

  (instance as any).sampleHistory();

  expect(instance.resourceHistoryMap.get('username')).toEqual([{
    time: 1700000000000,
    cpu: 20,
    memory_used: 50,
    memory_total: 100,
    network_in: 30,
    network_out: 40,
    network_rx: 0,
    network_tx: 0
  }]);
});
