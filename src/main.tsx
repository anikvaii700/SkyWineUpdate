import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { registerSW } from 'virtual:pwa-register';

// Keep new releases waiting until the user explicitly chooses to update.
// This avoids replacing the running app while the user is playing or using a form.
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    console.info('SkyWinBD: a new version is ready. Use the app update action to apply it.');
  },
  onOfflineReady() {
    console.log('SkyWinBD: ready for offline operation.');
  },
});

// The update action in the app menu is the only place that activates a waiting worker.
// Workbox will reload the page once after the user accepts the update.
if (typeof window !== 'undefined') {
  (window as any).__updateApp = () => {
    void updateSW(true);
  };
}

createRoot(document.getElementById('root')!).render(<App />);
