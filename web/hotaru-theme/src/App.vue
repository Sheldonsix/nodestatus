<template>
  <global-context>
    <the-header />
    <the-error v-show="!servers" />
    <div class="container">
      <servers-table :servers="servers" />
      <update-time :updated="updated" />
      <servers-card :servers="servers" />
    </div>
    <the-footer />
  </global-context>
</template>

<script lang="ts">
import { defineComponent, ref, onBeforeUnmount } from 'vue';

import TheError from '@nodestatus/web-utils/vue/components/TheError.vue';
import UpdateTime from '@nodestatus/web-utils/vue/components/UpdateTime.vue';
import GlobalContext from '@nodestatus/web-utils/vue/components/GlobalContext.vue';
import TheHeader from './components/TheHeader.vue';
import ServersTable from './components/ServersTable.vue';
import ServersCard from './components/ServersCard.vue';
import TheFooter from './components/TheFooter.vue';
import type { ServerItem } from './types';

/* Semantic UI Style */
import 'semantic-ui-css/semantic.min.css';

export default defineComponent({
  name: 'App',
  components: {
    TheHeader,
    TheError,
    ServersTable,
    ServersCard,
    TheFooter,
    UpdateTime,
    GlobalContext
  },
  setup() {
    const servers = ref<Array<ServerItem>>();
    const updated = ref<number>();

    const loadStatus = async () => {
      const resp = await fetch('/api/status');
      if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
      const data = await resp.json() as { servers: Array<ServerItem>, updated: number };
      servers.value = data.servers;
      updated.value = data.updated;
    };
    const pollStatus = () => loadStatus().catch(error => console.error('An error occurred while connecting to the backend', error));

    pollStatus();
    const id = window.setInterval(pollStatus, 1500);
    onBeforeUnmount(() => clearInterval(id));

    return {
      servers,
      updated
    };
  }
});
</script>

<style>
body {
  /* Replace your background image at this place! */
  background: url('./assets/img/bg_parts.png') repeat-y left top, url('./assets/img/bg.png') repeat left top;
}

/* Global */
div.bar {
  min-width: 0 !important;
}

body.dark-mode {
  background: #141414;
  color: #e8eaed;
}

body.dark-mode #app {
  min-height: 100vh;
}

body.dark-mode #table {
  background: rgba(23, 23, 23, .88);
  color: #e8eaed;
}

body.dark-mode #table thead tr th {
  color: #bfc8c2;
}

body.dark-mode #table.ui.basic.table tbody tr,
body.dark-mode #table tr.tableRow {
  background-color: rgba(32, 33, 36, .9);
}

body.dark-mode #table.ui.basic.table tbody tr:hover,
body.dark-mode #table tr.tableRow:hover {
  background-color: rgba(49, 50, 54, .94);
}

body.dark-mode #table.ui.table tr td,
body.dark-mode #table tr td {
  color: #e8eaed;
  border-color: rgba(191, 200, 194, .22) !important;
}

body.dark-mode #table .expandRow td > div {
  color: #cfd8d3;
}

body.dark-mode #cards .card__wrapper .ui.card {
  background-color: rgba(32, 33, 36, .92);
  box-shadow: 5px 5px 25px 0 rgba(0, 0, 0, .32);
  color: #e8eaed;
}

body.dark-mode #cards .card__wrapper .ui.card .card__header p,
body.dark-mode #cards .card__wrapper .ui.card .card__content p {
  color: #cfd8d3;
}

body.dark-mode #cards .card__wrapper .ui.card .card__content p:last-child {
  color: #66b7ff !important;
}

body.dark-mode .bandwidth-chart {
  color: #cfd8d3;
}

body.dark-mode .bandwidth-chart .chart-controls button {
  border-color: rgba(191, 200, 194, .42);
  background: rgba(20, 20, 20, .9);
  color: #cfd8d3;
}

body.dark-mode .bandwidth-chart .chart-controls button.active {
  border-color: #66b7ff;
  background: #1f6feb;
  color: #fff;
}

body.dark-mode .updated,
body.dark-mode .footer p {
  color: #cfd8d3;
}

body.dark-mode .footer p a {
  color: #8cc8ff;
}

body.dark-mode .footer p a:hover {
  color: #ff9fc4;
}

/* Responsive */
@media only screen and (min-width: 1200px) {
  .container {
    margin: 0 auto;
    width: 1155px;
  }
}

@media only screen and (max-width: 1200px) {
  #app .container {
    margin: 0 .8rem;
    width: auto;
  }

  #table thead tr th,
  #table tr.tableRow td {
    padding: .7em;
  }
}

@media only screen and (max-width: 1075px) {
  #type,
  tr td:nth-child(3) {
    display: none;
  }
}

@media only screen and (max-width: 992px) {
  html,
  body {
    font-size: 13px;
  }
}

@media only screen and (max-width: 910px) {
  #location,
  tr td:nth-child(4) {
    display: none;
  }
}

@media (max-width: 768px) {
  html,
  body {
    font-size: 12px;
  }

  #servers div.progress {
    width: 40px;
  }

  #cards .card .card__header span {
    font-size: 1.5rem;
  }

  #cards .card .card__content p {
    margin-bottom: .6rem;
    font-size: 1.2rem;
  }

  #header {
    height: 20rem;

    /* Replace your header image (for mobile use) at this place! */
    background: url('assets/img/cover_mobile.png') no-repeat center center;
  }
}

@media only screen and (max-width: 720px) {
  #uptime,
  tr td:nth-child(5) {
    display: none;
  }
}

@media only screen and (max-width: 660px) {
  #load,
  tr td:nth-child(6) {
    display: none;
  }
}

@media only screen and (max-width: 600px) {
  #traffic,
  tr td:nth-child(8) {
    display: none;
  }
}

@media only screen and (max-width: 533px) {
  #name,
  tr td:nth-child(2) {
    overflow: hidden;
    min-width: 20px;
    max-width: 60px;
    text-overflow: ellipsis;
  }

  #hdd,
  tr td:nth-child(11) {
    display: none;
  }

  #cpu,
  #ram {
    min-width: 20px;
    max-width: 40px;
  }
}
</style>
