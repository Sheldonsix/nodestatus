import { Context, Middleware } from 'koa';
import {
  bulkCreateServer,
  createServer,
  deleteServer,
  readServersList,
  updateServer,
  updateOrder
} from '../model/server';
import { createRes } from '../lib/utils';
import { deleteAllEvents, deleteEvent, readEvents } from '../model/event';
import { readServerHistory, readServerResourceHistory } from '../model/history';
import config from '../lib/config';

import { nodeStatusInstance } from '../lib/core';
import type { BandwidthHistoryPoint, ResourceHistoryPoint } from '../../types/server';

const DEFAULT_HISTORY_RANGE = 3600;
const MAX_HISTORY_RANGE = 30 * 24 * 3600;
const HISTORY_STEPS = [
  { range: 60, step: 2 },
  { range: 600, step: 10 },
  { range: 1800, step: 30 },
  { range: 3600, step: 60 },
  { range: 86400, step: 300 },
  { range: 604800, step: 1800 },
  { range: MAX_HISTORY_RANGE, step: 3600 }
];

type HistoryMetric = 'bandwidth' | 'traffic' | 'resource';

type HistoryBucket = {
  key: number;
  time: number;
  in: number;
  out: number;
  count: number;
};

type ResourceHistorySample = ResourceHistoryPoint & {
  cpu: number;
  memory_used: number;
  memory_total: number;
  network_in: number;
  network_out: number;
  network_rx: number;
  network_tx: number;
};

type ResourceHistoryBucket = Omit<ResourceHistorySample, 'time'> & {
  key: number;
  time: number;
  count: number;
};

async function handleRequest<T>(ctx: Context, handler: Promise<T>): Promise<void> {
  try {
    ctx.body = createRes({ data: await handler });
  } catch (err: any) {
    ctx.status = 500;
    ctx.body = createRes(1, err.message);
  }
}

function parseHistoryRange(value: unknown): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const range = Number(raw);
  if (!Number.isFinite(range) || range <= 0) return DEFAULT_HISTORY_RANGE;
  return Math.min(Math.ceil(range), MAX_HISTORY_RANGE);
}

function resolveHistoryStep(range: number): number {
  return HISTORY_STEPS.find(item => range <= item.range)?.step || HISTORY_STEPS[HISTORY_STEPS.length - 1].step;
}

function parseHistoryMetric(value: unknown): HistoryMetric {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === 'resource') return 'resource';
  return raw === 'traffic' ? 'traffic' : 'bandwidth';
}

function getMetricValues(item: BandwidthHistoryPoint, metric: HistoryMetric): [number | null, number | null] {
  if (metric === 'traffic') return [item.rx ?? null, item.tx ?? null];
  return [item.in, item.out];
}

function createMetricPoint(item: BandwidthHistoryPoint, metric: HistoryMetric): BandwidthHistoryPoint {
  const [input, output] = getMetricValues(item, metric);
  return { time: item.time, in: input, out: output };
}

function mergeHistoryData<T extends { time: number }>(stored: T[], memory: T[]): T[] {
  const lastStoredTime = stored[stored.length - 1]?.time || 0;
  return stored.concat(memory.filter(item => item.time > lastStoredTime)).sort((x, y) => x.time - y.time);
}

function downsampleHistoryData(
  history: BandwidthHistoryPoint[],
  range: number,
  metric: HistoryMetric = 'bandwidth'
): BandwidthHistoryPoint[] {
  if (!history.length) return [];

  const step = resolveHistoryStep(range);
  const cutoff = history[history.length - 1].time - range * 1000;
  const filtered = history.filter(item => item.time >= cutoff);

  if (step <= 2) return filtered.map(item => createMetricPoint(item, metric));

  const stepMs = step * 1000;
  const data: BandwidthHistoryPoint[] = [];
  let bucket: HistoryBucket | null = null;

  const flushBucket = () => {
    if (!bucket) return;
    data.push({
      time: bucket.time,
      in: metric === 'traffic' ? bucket.in : bucket.in / bucket.count,
      out: metric === 'traffic' ? bucket.out : bucket.out / bucket.count
    });
    bucket = null;
  };

  for (const item of filtered) {
    const [input, output] = getMetricValues(item, metric);
    if (input === null || output === null) {
      flushBucket();
      data.push({ time: item.time, in: null, out: null });
      continue;
    }

    const key = Math.floor(item.time / stepMs);
    if (!bucket || bucket.key !== key) {
      flushBucket();
      bucket = {
        key,
        time: item.time,
        in: input,
        out: output,
        count: 1
      };
      continue;
    }

    bucket.time = item.time;
    if (metric === 'traffic') {
      bucket.in += input;
      bucket.out += output;
    } else {
      bucket.in += input;
      bucket.out += output;
      bucket.count += 1;
    }
  }

  flushBucket();
  return data;
}

function createResourceGapPoint(time: number): ResourceHistoryPoint {
  return {
    time,
    cpu: null,
    memory_used: null,
    memory_total: null,
    network_in: null,
    network_out: null,
    network_rx: null,
    network_tx: null
  };
}

function hasResourceValues(item: ResourceHistoryPoint): item is ResourceHistorySample {
  return item.cpu !== null
    && item.memory_used !== null
    && item.memory_total !== null
    && item.network_in !== null
    && item.network_out !== null
    && item.network_rx !== null
    && item.network_tx !== null;
}

function downsampleResourceHistoryData(history: ResourceHistoryPoint[], range: number): ResourceHistoryPoint[] {
  if (!history.length) return [];

  const step = resolveHistoryStep(range);
  const cutoff = history[history.length - 1].time - range * 1000;
  const filtered = history.filter(item => item.time >= cutoff);

  if (step <= 2) return filtered;

  const stepMs = step * 1000;
  const data: ResourceHistoryPoint[] = [];
  let bucket: ResourceHistoryBucket | null = null;

  const flushBucket = () => {
    if (!bucket) return;
    data.push({
      time: bucket.time,
      cpu: bucket.cpu / bucket.count,
      memory_used: bucket.memory_used / bucket.count,
      memory_total: bucket.memory_total / bucket.count,
      network_in: bucket.network_in / bucket.count,
      network_out: bucket.network_out / bucket.count,
      network_rx: bucket.network_rx,
      network_tx: bucket.network_tx
    });
    bucket = null;
  };

  for (const item of filtered) {
    if (!hasResourceValues(item)) {
      flushBucket();
      data.push(createResourceGapPoint(item.time));
      continue;
    }

    const key = Math.floor(item.time / stepMs);
    if (!bucket || bucket.key !== key) {
      flushBucket();
      bucket = {
        key,
        time: item.time,
        cpu: item.cpu,
        memory_used: item.memory_used,
        memory_total: item.memory_total,
        network_in: item.network_in,
        network_out: item.network_out,
        network_rx: item.network_rx,
        network_tx: item.network_tx,
        count: 1
      };
      continue;
    }

    bucket.time = item.time;
    bucket.cpu += item.cpu;
    bucket.memory_used += item.memory_used;
    bucket.memory_total += item.memory_total;
    bucket.network_in += item.network_in;
    bucket.network_out += item.network_out;
    bucket.network_rx += item.network_rx;
    bucket.network_tx += item.network_tx;
    bucket.count += 1;
  }

  flushBucket();
  return data;
}

const getListServers: Middleware = async ctx => {
  await handleRequest(ctx, readServersList().then(data => data.sort((x, y) => y.order - x.order)));
};

const setServer: Middleware = async ctx => {
  const { username } = ctx.request.body;
  const { data } = ctx.request.body;
  if (!username || !data) {
    ctx.status = 400;
    ctx.body = createRes(1, 'Wrong request');
    return;
  }
  if (username === data.username) delete data.username;
  await handleRequest(ctx, updateServer(username, data));
};

const addServer: Middleware = async ctx => {
  const data = ctx.request.body;
  if (!data) {
    ctx.status = 400;
    ctx.body = createRes(1, 'Wrong request');
    return;
  }
  if (Object.hasOwnProperty.call(data, 'data')) {
    try {
      const d = JSON.parse(data.data);
      await handleRequest(ctx, bulkCreateServer(d));
    } catch (error: any) {
      ctx.status = 400;
      ctx.body = createRes(1, 'Wrong request');
    }
  } else {
    await handleRequest(ctx, createServer(data));
  }
};

const removeServer: Middleware = async ctx => {
  const { username = '' } = ctx.params;
  if (!username) {
    ctx.status = 400;
    ctx.body = createRes(1, 'Wrong request');
    return;
  }
  await handleRequest(ctx, deleteServer(username));
};

const modifyOrder: Middleware = async ctx => {
  const { order = [] } = ctx.request.body as { order: number[] };
  if (!order.length) {
    ctx.status = 400;
    ctx.body = createRes(1, 'Wrong request');
    return;
  }
  await handleRequest(ctx, updateOrder(order.join(',')));
};

const queryEvents: Middleware = async ctx => {
  const size = Number(ctx.query.size) || 10;
  const offset = Number(ctx.query.offset) || 0;
  await handleRequest(ctx, readEvents(size, offset).then(([count, list]) => ({ count, list })));
};

const removeEvent: Middleware = async ctx => {
  if (ctx.params.id) {
    await handleRequest(ctx, deleteEvent(Number(ctx.params.id)));
  } else {
    await handleRequest(ctx, deleteAllEvents());
  }
};

const queryConfig: Middleware = async ctx => ctx.body = {
  title: config.webTitle,
  subTitle: config.webSubtitle,
  headTitle: config.webHeadtitle
};

const queryStatus: Middleware = async ctx => {
  ctx.body = {
    servers: nodeStatusInstance?.serversPub || [],
    updated: ~~(Date.now() / 1000)
  };
};

const getServerHistory: Middleware = async ctx => {
  const { username } = ctx.params;
  if (!username) {
    ctx.status = 400;
    ctx.body = createRes(1, 'Wrong request');
    return;
  }
  const range = parseHistoryRange(ctx.query.range);
  const metric = parseHistoryMetric(ctx.query.metric);
  await handleRequest(ctx, (async () => {
    const since = Date.now() - range * 1000;
    if (metric === 'resource') {
      const stored = await readServerResourceHistory(username, new Date(since));
      const memory = (nodeStatusInstance?.resourceHistoryMap.get(username) || []).filter(item => item.time >= since);
      return downsampleResourceHistoryData(mergeHistoryData(stored, memory), range);
    }
    const stored = await readServerHistory(username, new Date(since));
    const memory = (nodeStatusInstance?.historyMap.get(username) || []).filter(item => item.time >= since);
    return downsampleHistoryData(mergeHistoryData(stored, memory), range, metric);
  })());
};

export {
  downsampleHistoryData,
  downsampleResourceHistoryData,
  mergeHistoryData,
  getListServers,
  parseHistoryMetric,
  parseHistoryRange,
  resolveHistoryStep,
  setServer,
  addServer,
  removeServer,
  modifyOrder,
  queryEvents,
  removeEvent,
  queryConfig,
  queryStatus,
  getServerHistory
};
