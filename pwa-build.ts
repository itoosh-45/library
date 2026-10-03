import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Plugin } from 'vite';

export function offlineBuild(): Plugin {
  let base = '/library/', publicDirectory = 'public';
  return {
    name: 'library-offline', apply: 'build', enforce: 'post',
    configResolved(config) {
      if (!config.base.startsWith('/') || !config.base.endsWith('/') || !config.publicDir) throw new Error('Offline build requires an absolute path base and public directory.');
      base = config.base; publicDirectory = config.publicDir;
    },
    generateBundle(_options, bundle) {
      const publicFiles: string[] = [];
      function visit(directory: string) {
        for (const item of readdirSync(directory, { withFileTypes: true })) {
          const path = join(directory, item.name);
          if (item.isDirectory()) visit(path); else publicFiles.push(path);
        }
      }
      visit(publicDirectory);
      const digest = createHash('sha256');
      const template = readFileSync('service-worker.js', 'utf8');
      digest.update(template);
      const assets = Object.keys(bundle).filter(name => !name.endsWith('.map')).sort();
      for (const name of assets) {
        const item = bundle[name]; digest.update(name); digest.update(item.type === 'chunk' ? item.code : item.source);
      }
      for (const path of publicFiles.sort()) { digest.update(relative(publicDirectory, path)); digest.update(readFileSync(path)); }
      const urls = [...assets, ...publicFiles.map(path => relative(publicDirectory, path).replaceAll('\\', '/'))].map(path => base + path);
      const source = template.replace('__BUILD_ID__', digest.digest('hex').slice(0, 20)).replace('const assets = __ASSET_LIST__;', 'const assets = ' + JSON.stringify(urls) + ';');
      this.emitFile({ type: 'asset', fileName: 'service-worker.js', source });
    },
  };
}
