import prisma from '../lib/prisma';
import type { BandwidthHistoryPoint, ResourceHistoryPoint } from '../../types/server';

export type ServerHistoryInput = {
  server_id: number;
  created_at: Date;
  cpu: number;
  memory_used: number;
  memory_total: number;
  network_in: number;
  network_out: number;
  network_rx: number;
  network_tx: number;
};

export async function createServerHistory(items: ServerHistoryInput[]): Promise<void> {
  if (!items.length) return;
  await prisma.serverHistory.createMany({ data: items });
}

const findServerHistory = (username: string, since: Date) => prisma.serverHistory.findMany({
  where: {
    created_at: { gte: since },
    server: { username }
  },
  orderBy: { created_at: 'asc' }
});

export async function readServerHistory(username: string, since: Date): Promise<BandwidthHistoryPoint[]> {
  const rows = await findServerHistory(username, since);

  return rows.map(item => ({
    time: item.created_at.getTime(),
    in: item.network_in,
    out: item.network_out,
    rx: item.network_rx,
    tx: item.network_tx
  }));
}

export async function readServerResourceHistory(username: string, since: Date): Promise<ResourceHistoryPoint[]> {
  const rows = await findServerHistory(username, since);

  return rows.map(item => ({
    time: item.created_at.getTime(),
    cpu: item.cpu,
    memory_used: item.memory_used,
    memory_total: item.memory_total,
    network_in: item.network_in,
    network_out: item.network_out,
    network_rx: item.network_rx,
    network_tx: item.network_tx
  }));
}

export async function deleteServerHistoryBefore(before: Date): Promise<void> {
  await prisma.serverHistory.deleteMany({
    where: {
      created_at: { lt: before }
    }
  });
}
