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
import config from '../lib/config';

import { nodeStatusInstance } from '../lib/core';
import type { BandwidthHistoryPoint } from '../../types/server';

const DEFAULT_HISTORY_RANGE = 3600;
const MAX_HISTORY_RANGE = 3600;
const HISTORY_STEPS = [
  { range: 60, step: 2 },
  { range: 600, step: 10 },
  { range: 1800, step: 30 },
  { range: 3600, step: 60 }
];

type HistoryMetric = 'bandwidth' | 'traffic';

type HistoryBucket = {
  key: number;
  time: number;
  in: number;
  out: number;
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
      in: bucket.in / bucket.count,
      out: bucket.out / bucket.count
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
      bucket.in = input;
      bucket.out = output;
      bucket.count = 1;
    } else {
      bucket.in += input;
      bucket.out += output;
      bucket.count += 1;
    }
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
  const data = downsampleHistoryData(nodeStatusInstance?.historyMap.get(username) || [], range, metric);
  ctx.body = createRes({ data });
};

export {
  downsampleHistoryData,
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
