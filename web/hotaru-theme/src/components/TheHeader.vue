<template>
  <div class="ui vertical masthead center aligned" id="header">
    <button
      class="theme-toggle"
      type="button"
      :aria-label="isDark ? '切换到浅色模式' : '切换到深色模式'"
      :title="isDark ? '切换到浅色模式' : '切换到深色模式'"
      @click="toggleDark"
    >
      <span aria-hidden="true">{{ isDark ? '☀' : '☾' }}</span>
    </button>
    <div class="header__content">
      <h1 class="ui inverted header">
        {{ config.title }}
      </h1>
      <p>{{ config.subTitle }}</p>
    </div>
  </div>
</template>
<script lang="ts">
import { defineComponent } from 'vue';
import useConfig from '@nodestatus/web-utils/vue/hooks/useConfig';
import { useDarkMode } from '../composables/useDarkMode';

export default defineComponent({
  name: 'TheHeader',
  setup() {
    const config = useConfig()!;
    const { isDark, toggleDark } = useDarkMode();

    return {
      config,
      isDark,
      toggleDark
    };
  }
});
</script>
<style>
#header {
  height: 25rem;
  position: relative;
  /*Replace your header image at this place!*/
  background: url("../assets/img/cover.png") no-repeat center center;
}

#header::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  right: 0;
  z-index: 1;
  width: 100%;
  background: rgba(66, 64, 64, .15);
}

#header::after {
  content: 'Pixiv: 86597206';
  position: absolute;
  right: 15px;
  bottom: 0;
  z-index: 2;
  color: #CDCDCD;
  text-shadow: 1px 1px 1px #666;
}

.theme-toggle {
  position: absolute;
  top: 1.25rem;
  right: 1.25rem;
  z-index: 4;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  height: 2.75rem;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, .55);
  border-radius: 50%;
  background: rgba(17, 24, 39, .35);
  color: #fff;
  box-shadow: 0 8px 24px rgba(0, 0, 0, .18);
  cursor: pointer;
  transition: background .2s ease, border-color .2s ease, transform .2s ease;
}

.theme-toggle:hover,
.theme-toggle:focus {
  background: rgba(17, 24, 39, .55);
  border-color: rgba(255, 255, 255, .85);
}

.theme-toggle:focus {
  outline: 2px solid rgba(255, 255, 255, .78);
  outline-offset: 3px;
}

.theme-toggle:active {
  transform: scale(.96);
}

.theme-toggle span {
  font-size: 1.3rem;
  line-height: 1;
}

.header__content {
  position: absolute;
  z-index: 3;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-shadow: 2px 2px 2px #666;
  text-align: center;
}

#header h1 {
  font-size: 3.57rem;
  white-space: nowrap;
}

#header p {
  font-size: 1.5rem;
  color: aliceblue;
}
</style>
