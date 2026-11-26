import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { registerSW } from 'virtual:pwa-register';

if (import.meta.env.DEV && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  Promise.all([
    navigator.serviceWorker.getRegistrations().then((registrations) =>
      Promise.all(registrations.map((reg) => reg.unregister()))
    ),
    typeof caches !== 'undefined'
      ? caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      : Promise.resolve(),
  ])
    .then(([unregistered]) => {
      const removedAny = Array.isArray(unregistered) && unregistered.some(Boolean);
      if (hadController && removedAny && typeof sessionStorage !== 'undefined') {
        const key = '__sw_dev_cleaned';
        if (!sessionStorage.getItem(key)) {
          sessionStorage.setItem(key, '1');
          window.location.reload();
        }
      }
    })
    .catch(() => {});
} else {
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
}

createRoot(document.getElementById('root')!).render(<App />);
