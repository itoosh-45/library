import { useEffect, useState } from 'react';
export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const changed = () => setOnline(navigator.onLine);
    window.addEventListener('online', changed); window.addEventListener('offline', changed);
    return () => { window.removeEventListener('online', changed); window.removeEventListener('offline', changed); };
  }, []);
  return online;
}
let registration: Promise<ServiceWorkerRegistration> | undefined;
export function registerOffline() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  if (!registration) {
    const clean = () => {
      const worker = navigator.serviceWorker.controller;
      if (worker) void workerMessage(worker, { type: 'CLEAN_OLD_SHELLS', shellModule: import.meta.url }).catch(() => {});
    };
    navigator.serviceWorker.addEventListener('controllerchange', clean);
    registration = navigator.serviceWorker.register(import.meta.env.BASE_URL + 'service-worker.js', { scope: import.meta.env.BASE_URL, updateViaCache: 'none' });
    void registration.then(clean).catch(() => { navigator.serviceWorker.removeEventListener('controllerchange', clean); registration = undefined; });
  }
  return registration;
}
export function workerMessage(worker: ServiceWorker, message: string | { type: string; shellModule: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); reject(new Error('לא התקבלה תשובה לעדכון. נסה שוב.')); }, 8000);
    channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(String(event.data)); };
    worker.postMessage(message, [channel.port2]);
  });
}
