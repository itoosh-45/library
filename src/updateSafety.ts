let writes = 0;
export function beginWrite() { writes++; let ended = false; return () => { if (!ended) { ended = true; writes--; } }; }
export function updateBlocked() { return writes > 0 || !!document.querySelector('dialog[open], [data-update-blocked="true"]'); }
