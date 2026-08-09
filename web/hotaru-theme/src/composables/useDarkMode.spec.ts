import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { useDarkMode } from './useDarkMode';

type StorageStore = Record<string, string>;

function createStorage(initial: StorageStore = {}) {
  const store: StorageStore = { ...initial };

  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    })
  };
}

function createDocument() {
  const classes = new Set<string>();

  return {
    body: {
      classList: {
        add: vi.fn((className: string) => {
          classes.add(className);
        }),
        remove: vi.fn((className: string) => {
          classes.delete(className);
        }),
        contains: vi.fn((className: string) => classes.has(className))
      }
    }
  };
}

function installBrowserGlobals(options: {
  storage?: ReturnType<typeof createStorage>;
  document?: ReturnType<typeof createDocument>;
} = {}) {
  const mockDocument = options.document ?? createDocument();
  const mockWindow: {
    document: ReturnType<typeof createDocument>;
    localStorage?: ReturnType<typeof createStorage>;
  } = {
    document: mockDocument
  };

  if (options.storage) {
    mockWindow.localStorage = options.storage;
    vi.stubGlobal('localStorage', options.storage);
  }

  vi.stubGlobal('document', mockDocument);
  vi.stubGlobal('window', mockWindow);

  return {
    document: mockDocument,
    storage: options.storage
  };
}

describe('useDarkMode', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to light mode when no theme is saved', () => {
    const storage = createStorage();
    const { document } = installBrowserGlobals({ storage });

    const { isDark } = useDarkMode();

    expect(isDark.value).toBe(false);
    expect(document.body.classList.remove).toHaveBeenCalledWith('dark-mode');
    expect(storage.setItem).toHaveBeenCalledWith('theme', 'light');
  });

  it('initializes dark mode from saved storage', () => {
    const storage = createStorage({ theme: 'dark' });
    const { document } = installBrowserGlobals({ storage });

    const { isDark } = useDarkMode();

    expect(isDark.value).toBe(true);
    expect(document.body.classList.add).toHaveBeenCalledWith('dark-mode');
    expect(storage.setItem).toHaveBeenCalledWith('theme', 'dark');
  });

  it('toggles body class and persisted theme', async () => {
    const storage = createStorage();
    const { document } = installBrowserGlobals({ storage });

    const { isDark, toggleDark } = useDarkMode();

    toggleDark();
    await nextTick();

    expect(isDark.value).toBe(true);
    expect(document.body.classList.add).toHaveBeenCalledWith('dark-mode');
    expect(storage.setItem).toHaveBeenLastCalledWith('theme', 'dark');

    toggleDark();
    await nextTick();

    expect(isDark.value).toBe(false);
    expect(document.body.classList.remove).toHaveBeenCalledWith('dark-mode');
    expect(storage.setItem).toHaveBeenLastCalledWith('theme', 'light');
  });

  it('toggles the body class even when localStorage is unavailable', async () => {
    const { document } = installBrowserGlobals();

    const { isDark, toggleDark } = useDarkMode();

    toggleDark();
    await nextTick();

    expect(isDark.value).toBe(true);
    expect(document.body.classList.add).toHaveBeenCalledWith('dark-mode');
  });
});
