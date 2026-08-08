import prisma from '../lib/prisma';
import type { BandwidthHistoryPoint } from '../../types/server';

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

export async function readServerHistory(username: string, since: Date): Promise<BandwidthHistoryPoint[]> {
  const rows = await prisma.serverHistory.findMany({
    where: {
      created_at: { gte: since },
      server: { username }
    },
    orderBy: { created_at: 'asc' }
  });

  return rows.map(item => ({
    time: item.created_at.getTime(),
    in: item.network_in,
    out: item.network_out,
    rx: item.network_rx,
    tx: item.network_tx
  }));
}

export async function deleteServerHistoryBefore(before: Date): Promise<void> {
  await prisma.serverHistory.deleteMany({
    where: {
      created_at: { lt: before }
    }
  });
}
