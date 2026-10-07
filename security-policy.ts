/** Production-only policy; the development server needs its own HMR scripts. */
export function productionSecurityPolicy(gateway = ''): string {
  const connections = ["'self'", 'https://openlibrary.org https://covers.openlibrary.org https://*.us.archive.org https://books.google.com', 'https://generativelanguage.googleapis.com https://api.groq.com', 'https://maya-n8n.duckdns.org https://m.media-amazon.com https://images-na.ssl-images-amazon.com https://i.gr-assets.com https://images.gr-assets.com https://s.gr-assets.com'];
  if (gateway) {
    const url = new URL(gateway);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Invalid catalog gateway origin for CSP.');
    connections.push(url.origin);
  }
  return ["default-src 'none'", "script-src 'self' 'wasm-unsafe-eval'", "style-src 'self' 'unsafe-inline'", "img-src 'self' blob: data:", "font-src 'self'", 'connect-src ' + connections.join(' '), "worker-src 'self'", 'media-src blob:', "manifest-src 'self'", "base-uri 'self'", "object-src 'none'", "form-action 'none'"].join('; ');
}
