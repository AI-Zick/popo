import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

const KEY = 'aegis.theme';

function initialTheme(): 'light' | 'dark' {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* ignore */
  }
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  return (
    <button
      type="button"
      onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      className="flex size-9 items-center justify-center rounded-lg border border-line text-muted transition hover:bg-raised hover:text-ink"
    >
      {theme === 'dark' ? <Sun size={16} aria-hidden /> : <Moon size={16} aria-hidden />}
    </button>
  );
}
