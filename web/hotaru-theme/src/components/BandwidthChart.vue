<template>
  <div class="bandwidth-chart">
    <div class="chart-controls">
      <button @click="setTimeframe(60)" :class="{ active: timeframe === 60 }">1 Min</button>
      <button @click="setTimeframe(600)" :class="{ active: timeframe === 600 }">10 Min</button>
      <button @click="setTimeframe(1800)" :class="{ active: timeframe === 1800 }">30 Min</button>
      <button @click="setTimeframe(3600)" :class="{ active: timeframe === 3600 }">1 Hour</button>
    </div>
    <v-chart class="chart" :option="chartOption" autoresize />
  </div>
</template>

<script lang="ts">
import {
  defineComponent, ref, computed, watch, onMounted
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
import useStatus from '@nodestatus/web-utils/vue/hooks/useStatus';

use([
  CanvasRenderer,
  LineChart,
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent
]);

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
    status: {
      type: Object,
      required: true
    }
  },
  setup(props) {
    const historyData = ref<{ time: number, in: number, out: number }[]>([]);
    const timeframe = ref(3600); // in seconds
    const serverTimeOffset = ref(0);
    const { formatNetwork } = useStatus({ server: { status: {} } } as any);

    onMounted(async () => {
      try {
        const res = await fetch(`/api/server/${props.username}/history`);
        const json = await res.json();
        if (json.code === 0) {
          historyData.value = json.data || [];
          if (historyData.value.length > 0) {
            const serverTime = historyData.value[historyData.value.length - 1].time;
            serverTimeOffset.value = serverTime - Date.now();
          }
        }
      } catch (err) {
        console.error('Failed to fetch history', err);
      }
    });

    let lastPushTime = 0;
    watch(() => props.status, newStatus => {
      if (newStatus && newStatus.network_in !== undefined) {
        const now = Date.now();
        if (now - lastPushTime >= 2000) {
          lastPushTime = now;
          historyData.value.push({
            time: now + serverTimeOffset.value,
            in: newStatus.network_in,
            out: newStatus.network_out
          });
          if (historyData.value.length > 1800) {
            historyData.value.shift();
          }
        }
      }
    }, { deep: true });

    const setTimeframe = (seconds: number) => {
      timeframe.value = seconds;
    };

    const chartOption = computed(() => {
      const cutoff = Date.now() + serverTimeOffset.value - timeframe.value * 1000;
      const filtered = historyData.value.filter(d => d.time >= cutoff);

      const times = filtered.map(d => {
        const date = new Date(d.time);
        return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`;
      });
      const inData = filtered.map(d => d.in);
      const outData = filtered.map(d => d.out);

      return {
        tooltip: {
          trigger: 'axis',
          formatter(params: any) {
            let result = `${params[0].axisValueLabel}<br/>`;
            params.forEach((item: any) => {
              result += `${item.marker + item.seriesName}: ${formatNetwork.value(item.value)}<br/>`;
            });
            return result;
          }
        },
        legend: {
          data: ['Download', 'Upload'],
          textStyle: { color: '#666' }
        },
        grid: {
          left: '3%',
          right: '4%',
          bottom: '3%',
          containLabel: true
        },
        xAxis: {
          type: 'category',
          boundaryGap: false,
          data: times,
          axisLabel: { color: '#666' }
        },
        yAxis: {
          type: 'value',
          axisLabel: {
            color: '#666',
            formatter: (value: number) => formatNetwork.value(value)
          },
          splitLine: { lineStyle: { color: '#eee' } }
        },
        series: [
          {
            name: 'Download',
            type: 'line',
            data: inData,
            smooth: true,
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
