import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { StoreProvider } from './state/store';
import './index.css';

// Apply the stored theme before first paint so the app never flashes.
try {
  const stored = localStorage.getItem('aegis.theme');
  document.documentElement.dataset.theme =
    stored === 'light' || stored === 'dark'
      ? stored
      : window.matchMedia('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark';
} catch {
  document.documentElement.dataset.theme = 'dark';
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </StrictMode>,
);
