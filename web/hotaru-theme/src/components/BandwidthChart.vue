<template>
  <div class="bandwidth-chart">
    <div class="chart-controls">
      <button @click="setTimeframe(60)" :class="{ active: timeframe === 60 }">1 Min</button>
      <button @click="setTimeframe(600)" :class="{ active: timeframe === 600 }">10 Min</button>
      <button @click="setTimeframe(3600)" :class="{ active: timeframe === 3600 }">1h</button>
      <button @click="setTimeframe(86400)" :class="{ active: timeframe === 86400 }">1d</button>
      <button @click="setTimeframe(604800)" :class="{ active: timeframe === 604800 }">7d</button>
      <button @click="setTimeframe(2592000)" :class="{ active: timeframe === 2592000 }">30d</button>
    </div>
    <v-chart class="chart" :option="chartOption" autoresize />
  </div>
</template>

<script lang="ts">
import {
  computed, defineComponent, onBeforeUnmount, onMounted, ref, watch
} from 'vue';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { LineChart } from 'echarts/charts';
import {
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent
} from 'echarts/components';
import VChart from 'vue-echarts';
import { formatNetwork } from '@nodestatus/web-utils/shared';
import type { PropType } from 'vue';
import type { BandwidthHistoryPoint } from '@nodestatus/web-utils/types';

use([
  CanvasRenderer,
  LineChart,
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent
]);

type ChartPoint = [number, number | null];
type HistoryMetric = 'bandwidth' | 'traffic';

const HISTORY_REFRESH_INTERVAL = 2000;

const formatTime = (time: number): string => {
  const date = new Date(time);
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`;
};

const normalizeNetworkValue = (value: unknown): number | null => {
  if (value === null) return null;
  if (value === undefined) return 0;
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

export default defineComponent({
  name: 'BandwidthChart',
  components: {
    VChart
  },
  props: {
    username: {
      type: String,
      required: true
    },
    title: {
      type: String,
      default: '带宽'
    },
    metric: {
      type: String as PropType<HistoryMetric>,
      default: 'bandwidth'
    }
  },
  setup(props) {
    const historyData = ref<BandwidthHistoryPoint[]>([]);
    const timeframe = ref(3600); // in seconds
    let refreshTimer: number | undefined;
    let requestId = 0;

    const loadHistory = async () => {
      const currentRequestId = ++requestId;
      try {
        const params = new URLSearchParams({
          metric: props.metric,
          range: timeframe.value.toString()
        });
        const res = await fetch(`/api/server/${encodeURIComponent(props.username)}/history?${params.toString()}`);
        const json = await res.json();
        if (currentRequestId !== requestId) return;
        if (json.code === 0 && Array.isArray(json.data)) {
          historyData.value = json.data
            .map((item: any): BandwidthHistoryPoint => ({
              time: Number(item.time),
              in: normalizeNetworkValue(item.in),
              out: normalizeNetworkValue(item.out)
            }))
            .filter((item: BandwidthHistoryPoint) => Number.isFinite(item.time));
        }
      } catch (err) {
        console.error('Failed to fetch history', err);
      }
    };

    onMounted(() => {
      loadHistory();
      refreshTimer = window.setInterval(loadHistory, HISTORY_REFRESH_INTERVAL);
    });

    onBeforeUnmount(() => {
      if (refreshTimer !== undefined) {
        window.clearInterval(refreshTimer);
      }
    });

    watch(() => [props.username, props.metric], () => {
      historyData.value = [];
      loadHistory();
    });

    const setTimeframe = (seconds: number) => {
      timeframe.value = seconds;
      loadHistory();
    };

    const chartOption = computed(() => {
      const inData: ChartPoint[] = historyData.value.map(d => [d.time, d.in]);
      const outData: ChartPoint[] = historyData.value.map(d => [d.time, d.out]);

      return {
        title: {
          text: props.title,
          left: 36,
          top: 20
        },
        tooltip: {
          trigger: 'axis',
          formatter(params: any) {
            const list = Array.isArray(params) ? params : [params];
            const time = Number(list[0]?.axisValue ?? list[0]?.value?.[0]);
            let result = `${formatTime(time)}<br/>`;
            list.forEach((item: any) => {
              const value = Array.isArray(item.value) ? item.value[1] : item.value;
              result += `${item.marker + item.seriesName}: ${formatNetwork(value)}<br/>`;
            });
            return result;
          }
        },
        grid: {
          left: '3%',
          right: '4%',
          bottom: '3%',
          containLabel: true
        },
        xAxis: {
          type: 'time',
          boundaryGap: false,
          axisLabel: {
            color: '#666',
            formatter: (value: number) => formatTime(value)
          }
        },
        yAxis: {
          type: 'value',
          axisLabel: {
            color: '#666',
            formatter: (value: number) => formatNetwork(value)
          },
          splitLine: { lineStyle: { color: '#eee' } }
        },
        series: [
          {
            name: 'Download',
            type: 'line',
            data: inData,
            smooth: true,
            connectNulls: false,
            showSymbol: false,
            itemStyle: { color: '#00e676' },
            areaStyle: {
              color: 'rgba(0, 230, 118, 0.2)'
            }
          },
          {
            name: 'Upload',
            type: 'line',
            data: outData,
            smooth: true,
            connectNulls: false,
            showSymbol: false,
            itemStyle: { color: '#2979ff' },
            areaStyle: {
              color: 'rgba(41, 121, 255, 0.2)'
            }
          }
        ]
      };
    });

    return {
      timeframe,
      setTimeframe,
      chartOption
    };
  }
});
</script>

<style scoped>
.bandwidth-chart {
  width: 100%;
  padding: 10px;
}

.chart-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 10px;
  justify-content: center;
}

.chart-controls button {
  padding: 4px 12px;
  border: 1px solid #ddd;
  background: #f9f9f9;
  border-radius: 4px;
  cursor: pointer;
  color: #666;
}

.chart-controls button.active {
  background: #2979ff;
  color: white;
  border-color: #2979ff;
}

.chart {
  height: 250px;
  width: 100%;
}
</style>
