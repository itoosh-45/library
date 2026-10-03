import type { LibraryDatabase } from './database';

export type ConnectionNotice = 'blocked' | 'versionchange';
// Subscribe before open. A version-change request must not silently reload an editor.
export function watchDatabaseConnection(database: LibraryDatabase, notify: (notice: ConnectionNotice) => void) {
  const blocked = () => { notify('blocked'); return false; };
  const changed = () => {
    database.upgradePending = true;
    notify('versionchange');
    return false; // Keep the connection until the user explicitly releases it.
  };
  database.on('blocked', blocked);
  database.on('versionchange', changed);
  return () => {
    database.on('blocked').unsubscribe(blocked);
    database.on('versionchange').unsubscribe(changed);
  };
}
