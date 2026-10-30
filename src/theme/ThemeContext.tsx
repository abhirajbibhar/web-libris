import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';
import { PrimeReactContext } from 'primereact/api';

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'booklore.theme';
const THEME_LINK_ID = 'theme-link';
const THEME_FILE: Record<ThemeMode, string> = {
  light: 'lara-light-amber',
  dark: 'lara-dark-amber'
};
/** Browser-chrome colour (mobile address bar) per mode: the theme's card surface. */
const BROWSER_COLOR: Record<ThemeMode, string> = {
  light: '#ffffff',
  dark: '#1f2937'
};

interface ThemeContextValue {
  mode: ThemeMode;
  isDark: boolean;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** The stylesheet actually loaded is the source of truth (index.html chose it). */
function loadedMode(): ThemeMode {
  // The SPA shell is prerendered on the server, where there is no document.
  if (typeof document === 'undefined') return 'light';
  const href = document.getElementById(THEME_LINK_ID)?.getAttribute('href') ?? '';
  return href.includes(THEME_FILE.dark) ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { changeTheme } = useContext(PrimeReactContext);
  const [mode, setModeState] = useState<ThemeMode>(loadedMode);
  const swapping = useRef(false);
  const wanted = useRef<ThemeMode | null>(null);

  const applyStylesheet = useCallback(
    (next: ThemeMode) => {
      if (!changeTheme) return;
      if (swapping.current) {
        // A swap is still loading; remember the latest request and apply it after.
        wanted.current = next;
        return;
      }
      const current = loadedMode();
      if (current === next) return;
      swapping.current = true;
      changeTheme(THEME_FILE[current], THEME_FILE[next], THEME_LINK_ID, () => {
        swapping.current = false;
        const queued = wanted.current;
        wanted.current = null;
        if (queued && queued !== next) applyStylesheet(queued);
      });
    },
    [changeTheme]
  );

  const setMode = useCallback(
    (next: ThemeMode) => {
      setModeState(next);
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Private browsing: the choice just does not persist.
      }
      applyStylesheet(next);
    },
    [applyStylesheet]
  );

  const toggle = useCallback(() => setMode(mode === 'dark' ? 'light' : 'dark'), [mode, setMode]);

  useEffect(() => {
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', BROWSER_COLOR[mode]);
  }, [mode]);

  const value = useMemo(
    () => ({ mode, isDark: mode === 'dark', setMode, toggle }),
    [mode, setMode, toggle]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside ThemeProvider');
  return context;
}
