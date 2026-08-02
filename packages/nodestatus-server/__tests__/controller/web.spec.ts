import { expect, test } from 'vitest';
import {
  downsampleHistoryData,
  parseHistoryRange,
  resolveHistoryStep
} from '../../server/controller/web';
import type { BandwidthHistoryPoint } from '../../types/server';

const baseTime = 1700000000000;

const createPoint = (seconds: number, input: number | null, output: number | null): BandwidthHistoryPoint => ({
  time: baseTime + seconds * 1000,
  in: input,
  out: output
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
