import type { Context } from 'hono';
import type { BandwidthHistoryPoint, ResourceHistoryPoint } from '../../types/server';
import config from '../lib/config';
import { nodeStatusInstance } from '../lib/core';
import { createRes } from '../lib/utils';
import { deleteAllEvents, deleteEvent, readEvents } from '../model/event';
import { readServerHistory, readServerResourceHistory } from '../model/history';
import {
  bulkCreateServer,
  createServer,
  deleteServer,
  readServersList,
  updateOrder,
  updateServer,
} from '../model/server';

const DEFAULT_HISTORY_RANGE = 3600;
const MAX_HISTORY_RANGE = 30 * 24 * 3600;
const HISTORY_STEPS = [
  { range: 60, step: 2 },
  { range: 600, step: 10 },
  { range: 1800, step: 30 },
  { range: 3600, step: 60 },
  { range: 86400, step: 300 },
  { range: 604800, step: 1800 },
  { range: MAX_HISTORY_RANGE, step: 3600 },
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

async function handleRequest<T>(c: Context, handler: Promise<T>): Promise<Response> {
  try {
    return c.json(createRes({ data: await handler }));
  }
  catch (err: any) {
    return c.json(createRes(1, err.message), 500);
  }
}

function parseHistoryRange(value: unknown): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const range = Number(raw);
  if (!Number.isFinite(range) || range <= 0)
    return DEFAULT_HISTORY_RANGE;
  return Math.min(Math.ceil(range), MAX_HISTORY_RANGE);
}

function resolveHistoryStep(range: number): number {
  return HISTORY_STEPS.find(item => range <= item.range)?.step || HISTORY_STEPS[HISTORY_STEPS.length - 1].step;
}

function parseHistoryMetric(value: unknown): HistoryMetric {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === 'resource')
    return 'resource';
  return raw === 'traffic' ? 'traffic' : 'bandwidth';
}

function getMetricValues(item: BandwidthHistoryPoint, metric: HistoryMetric): [number | null, number | null] {
  if (metric === 'traffic')
    return [item.rx ?? null, item.tx ?? null];
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
  metric: HistoryMetric = 'bandwidth',
): BandwidthHistoryPoint[] {
  if (!history.length)
    return [];

  const step = resolveHistoryStep(range);
  const cutoff = history[history.length - 1].time - range * 1000;
  const filtered = history.filter(item => item.time >= cutoff);

  if (step <= 2)
    return filtered.map(item => createMetricPoint(item, metric));

  const stepMs = step * 1000;
  const data: BandwidthHistoryPoint[] = [];
  let bucket: HistoryBucket | null = null;

  const flushBucket = () => {
    if (!bucket)
      return;
    data.push({
      time: bucket.time,
      in: metric === 'traffic' ? bucket.in : bucket.in / bucket.count,
      out: metric === 'traffic' ? bucket.out : bucket.out / bucket.count,
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
        count: 1,
      };
      continue;
    }

    bucket.time = item.time;
    bucket.in += input;
    bucket.out += output;
    if (metric !== 'traffic')
      bucket.count += 1;
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
    network_tx: null,
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
  if (!history.length)
    return [];

  const step = resolveHistoryStep(range);
  const cutoff = history[history.length - 1].time - range * 1000;
  const filtered = history.filter(item => item.time >= cutoff);

  if (step <= 2)
    return filtered;

  const stepMs = step * 1000;
  const data: ResourceHistoryPoint[] = [];
  let bucket: ResourceHistoryBucket | null = null;

  const flushBucket = () => {
    if (!bucket)
      return;
    data.push({
      time: bucket.time,
      cpu: bucket.cpu / bucket.count,
      memory_used: bucket.memory_used / bucket.count,
      memory_total: bucket.memory_total / bucket.count,
      network_in: bucket.network_in / bucket.count,
      network_out: bucket.network_out / bucket.count,
      network_rx: bucket.network_rx,
      network_tx: bucket.network_tx,
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
        count: 1,
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

async function getListServers(c: Context) {
  return handleRequest(c, readServersList().then(data => data.sort((x, y) => y.order - x.order)));
}

async function setServer(c: Context) {
  let body: any;
  try {
    body = await c.req.json();
  }
  catch {
    body = {};
  }
  const { username, data } = body;
  if (!username || !data) {
    return c.json(createRes(1, 'Wrong request'), 400);
  }
  if (username === data.username)
    delete data.username;
  return handleRequest(c, updateServer(username, data));
}

async function addServer(c: Context) {
  let data: any;
  try {
    data = await c.req.json();
  }
  catch {
    return c.json(createRes(1, 'Wrong request'), 400);
  }
  if (!data) {
    return c.json(createRes(1, 'Wrong request'), 400);
  }
  if (Object.hasOwnProperty.call(data, 'data')) {
    try {
      const d = JSON.parse(data.data);
      return handleRequest(c, bulkCreateServer(d));
    }
    catch {
      return c.json(createRes(1, 'Wrong request'), 400);
    }
  }
  return handleRequest(c, createServer(data));
}

async function removeServer(c: Context) {
  const username = c.req.param('username') || '';
  if (!username) {
    return c.json(createRes(1, 'Wrong request'), 400);
  }
  return handleRequest(c, deleteServer(username));
}

async function modifyOrder(c: Context) {
  let body: any;
  try {
    body = await c.req.json();
  }
  catch {
    body = {};
  }
  const { order = [] } = body as { order: number[] };
  if (!order.length) {
    return c.json(createRes(1, 'Wrong request'), 400);
  }
  return handleRequest(c, updateOrder(order.join(',')));
}

async function queryEvents(c: Context) {
  const size = Number(c.req.query('size')) || 10;
  const offset = Number(c.req.query('offset')) || 0;
  return handleRequest(c, readEvents(size, offset).then(([count, list]) => ({ count, list })));
}

async function removeEvent(c: Context) {
  const id = c.req.param('id');
  if (id) {
    return handleRequest(c, deleteEvent(Number(id)));
  }
  return handleRequest(c, deleteAllEvents());
}

async function queryConfig(c: Context) {
  return c.json({
    title: config.webTitle,
    subTitle: config.webSubtitle,
    headTitle: config.webHeadtitle,
  });
}

async function queryStatus(c: Context) {
  return c.json({
    servers: nodeStatusInstance?.serversPub || [],
    updated: ~~(Date.now() / 1000),
  });
}

async function getServerHistory(c: Context) {
  const username = c.req.param('username') || '';
  if (!username) {
    return c.json(createRes(1, 'Wrong request'), 400);
  }
  const range = parseHistoryRange(c.req.query('range'));
  const metric = parseHistoryMetric(c.req.query('metric'));
  return handleRequest(c, (async () => {
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
}

export {
  addServer,
  downsampleHistoryData,
  downsampleResourceHistoryData,
  getListServers,
  getServerHistory,
  mergeHistoryData,
  modifyOrder,
  parseHistoryMetric,
  parseHistoryRange,
  queryConfig,
  queryEvents,
  queryStatus,
  removeEvent,
  removeServer,
  resolveHistoryStep,
  setServer,
};
