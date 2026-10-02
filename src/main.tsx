import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary, StorageError } from './StorageError';
import { db, initializeLibrary } from './data/database';
import './style.css';
import { registerOffline } from './pwa';

const root = createRoot(document.getElementById('root')!);
root.render(<p className="loading" role="status">פותח את הספרייה…</p>);
initializeLibrary(db).then(() => {
  void registerOffline()?.catch(() => {});
  root.render(<StrictMode><ErrorBoundary><App /></ErrorBoundary></StrictMode>);
}).catch(() => { root.render(<StorageError />); });
