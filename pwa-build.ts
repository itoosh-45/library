import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Plugin } from 'vite';

export function offlineBuild(): Plugin {
  return {
    name: 'library-offline', apply: 'build', enforce: 'post',
    generateBundle(_options, bundle) {
      const publicFiles: string[] = [];
      function visit(directory: string) {
        for (const item of readdirSync(directory, { withFileTypes: true })) {
          const path = join(directory, item.name);
          if (item.isDirectory()) visit(path); else publicFiles.push(path);
        }
      }
      visit('public');
      const digest = createHash('sha256');
      const template = readFileSync('service-worker.js', 'utf8');
      digest.update(template);
      const assets = Object.keys(bundle).filter(name => !name.endsWith('.map')).sort();
      for (const name of assets) {
        const item = bundle[name]; digest.update(name); digest.update(item.type === 'chunk' ? item.code : item.source);
      }
      for (const path of publicFiles.sort()) { digest.update(path); digest.update(readFileSync(path)); }
      const urls = [...assets, ...publicFiles.map(path => relative('public', path).replaceAll('\\', '/'))].map(path => '/library/' + path);
      const source = template.replace('__BUILD_ID__', digest.digest('hex').slice(0, 20)).replace('const assets = __ASSET_LIST__;', 'const assets = ' + JSON.stringify(urls) + ';');
      this.emitFile({ type: 'asset', fileName: 'service-worker.js', source });
    },
  };
}
