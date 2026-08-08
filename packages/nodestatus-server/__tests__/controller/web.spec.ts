import {
  afterEach, expect, test, vi
} from 'vitest';
import {
  downsampleHistoryData,
  parseHistoryMetric,
  parseHistoryRange,
  queryStatus,
  resolveHistoryStep
} from '../../server/controller/web';
import type { BandwidthHistoryPoint } from '../../types/server';

const baseTime = 1700000000000;

afterEach(() => {
  vi.restoreAllMocks();
});

const createPoint = (seconds: number, input: number | null, output: number | null): BandwidthHistoryPoint => ({
  time: baseTime + seconds * 1000,
  in: input,
  out: output
});

const createRawPoint = (
  seconds: number,
  input: number | null,
  output: number | null,
  rx: number | null,
  tx: number | null
): BandwidthHistoryPoint => ({
  time: baseTime + seconds * 1000,
  in: input,
  out: output,
  rx,
  tx
});

test('resolve bandwidth history step by selected range', () => {
  expect(resolveHistoryStep(60)).toBe(2);
  expect(resolveHistoryStep(600)).toBe(10);
  expect(resolveHistoryStep(1800)).toBe(30);
  expect(resolveHistoryStep(3600)).toBe(60);
});

test('parse bandwidth history range with defaults and max range', () => {
  expect(parseHistoryRange(undefined)).toBe(3600);
  expect(parseHistoryRange('600')).toBe(600);
  expect(parseHistoryRange(['1800'])).toBe(1800);
  expect(parseHistoryRange('-1')).toBe(3600);
  expect(parseHistoryRange('7200')).toBe(3600);
});

test('parse history metric with bandwidth as default', () => {
  expect(parseHistoryMetric(undefined)).toBe('bandwidth');
  expect(parseHistoryMetric('bandwidth')).toBe('bandwidth');
  expect(parseHistoryMetric('traffic')).toBe('traffic');
  expect(parseHistoryMetric(['traffic'])).toBe('traffic');
  expect(parseHistoryMetric('unknown')).toBe('bandwidth');
});

test('query public status in websocket payload shape', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(baseTime);
  const ctx = {} as any;
  await queryStatus(ctx, async () => undefined);
  expect(ctx.body).toEqual({
    servers: [],
    updated: 1700000000
  });
});

test('downsample bandwidth history by averaging each bucket', () => {
  const history = [
    createPoint(0, 10, 20),
    createPoint(2, 30, 40),
    createPoint(4, 50, 60),
    createPoint(10, 100, 200),
    createPoint(12, 120, 240)
  ];

  expect(downsampleHistoryData(history, 600)).toEqual([
    createPoint(4, 30, 40),
    createPoint(12, 110, 220)
  ]);
});

test('downsample bandwidth history preserves disconnect gaps', () => {
  const history = [
    createPoint(0, 10, 20),
    createPoint(2, 20, 40),
    createPoint(4, null, null),
    createPoint(6, 30, 60),
    createPoint(8, 40, 80)
  ];

  expect(downsampleHistoryData(history, 600)).toEqual([
    createPoint(2, 15, 30),
    createPoint(4, null, null),
    createPoint(8, 35, 70)
  ]);
});

test('downsample bandwidth history keeps only points in range', () => {
  const history = [
    createPoint(0, 10, 20),
    createPoint(70, 30, 40),
    createPoint(72, 50, 60)
  ];

  expect(downsampleHistoryData(history, 60)).toEqual([
    createPoint(70, 30, 40),
    createPoint(72, 50, 60)
  ]);
});

test('downsample traffic history by keeping the last value in each bucket', () => {
  const history = [
    createRawPoint(0, 10, 20, 1000, 2000),
    createRawPoint(2, 30, 40, 3000, 4000),
    createRawPoint(4, 50, 60, 5000, 6000),
    createRawPoint(10, 100, 200, 10000, 20000),
    createRawPoint(12, 120, 240, 12000, 24000)
  ];

  expect(downsampleHistoryData(history, 600, 'traffic')).toEqual([
    createPoint(4, 5000, 6000),
    createPoint(12, 12000, 24000)
  ]);
});

test('downsample traffic history preserves disconnect gaps', () => {
  const history = [
    createRawPoint(0, 10, 20, 1000, 2000),
    createRawPoint(2, 20, 40, 2000, 4000),
    createRawPoint(4, null, null, null, null),
    createRawPoint(6, 30, 60, 3000, 6000),
    createRawPoint(8, 40, 80, 4000, 8000)
  ];

  expect(downsampleHistoryData(history, 600, 'traffic')).toEqual([
    createPoint(2, 2000, 4000),
    createPoint(4, null, null),
    createPoint(8, 4000, 8000)
  ]);
});
