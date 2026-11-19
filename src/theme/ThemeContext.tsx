import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { setGlobalTheme, type Theme } from './store';

export type { Theme };

const STORAGE_KEY = 'algo3d:theme';

type Value = {
  theme: Theme;
  setTheme: (next: Theme) => void;
  toggle: () => void;
};

const ThemeCtx = createContext<Value | null>(null);

/** index.html paints the saved (or system) theme before React mounts, so the
 *  document already carries the answer by the time this runs. */
function startTheme(): Theme {
  const painted = document.documentElement.dataset.theme;
  if (painted === 'light' || painted === 'dark') return painted;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* storage can be blocked */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function remember(next: Theme) {
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* storage can be blocked */
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(startTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    setGlobalTheme(theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#15120e' : '#f7f3ea');
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    remember(next);
    setThemeState(next);
  }, []);

  const toggle = useCallback(() => {
    setThemeState((now) => {
      const next: Theme = now === 'dark' ? 'light' : 'dark';
      remember(next);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ theme, setTheme, toggle }), [theme, setTheme, toggle]);

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): Value {
  const value = useContext(ThemeCtx);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4L17 7M7 17l-1.6 1.6" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.4 14.2A8.4 8.4 0 0 1 9.8 3.6a8.6 8.6 0 1 0 10.6 10.6Z" />
    </svg>
  );
}

/** Sun/moon button in the top bar; shows the mode it will switch to. */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';
  const label = dark ? 'Switch to light mode' : 'Switch to dark mode';

  return (
    <button className="theme-toggle" type="button" onClick={toggle} title={label} aria-label={label}>
      {dark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
