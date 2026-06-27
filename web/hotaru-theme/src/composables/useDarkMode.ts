import { ref, watch } from 'vue';

const THEME_STORAGE_KEY = 'theme';
const DARK_MODE_CLASS = 'dark-mode';

function getStorage(): Storage | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  try {
    return window.localStorage || undefined;
  } catch {
    return undefined;
  }
}

function getBody(): HTMLElement | undefined {
  if (typeof document !== 'undefined' && document.body) {
    return document.body;
  }

  if (typeof window !== 'undefined' && window.document?.body) {
    return window.document.body;
  }

  return undefined;
}

function readSavedTheme(): string | undefined {
  const storage = getStorage();

  if (!storage) {
    return undefined;
  }

  try {
    return storage.getItem(THEME_STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function persistTheme(isDark: boolean) {
  const storage = getStorage();

  if (!storage) {
    return;
  }

  try {
    storage.setItem(THEME_STORAGE_KEY, isDark ? 'dark' : 'light');
  } catch {
    // Ignore storage errors so the visible theme can still change.
  }
}

function syncBodyClass(isDark: boolean) {
  const body = getBody();

  if (!body) {
    return;
  }

  if (isDark) {
    body.classList.add(DARK_MODE_CLASS);
  } else {
    body.classList.remove(DARK_MODE_CLASS);
  }
}

export function useDarkMode() {
  const isDark = ref(readSavedTheme() === 'dark');

  watch(isDark, (newValue) => {
    syncBodyClass(newValue);
    persistTheme(newValue);
  }, { immediate: true, flush: 'sync' });

  const toggleDark = () => {
    isDark.value = !isDark.value;
  };

  return {
    isDark,
    toggleDark
  };
}
