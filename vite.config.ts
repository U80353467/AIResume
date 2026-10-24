import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Register only the repository's trusted SVG assets, without an SVG build dependency tree.
function localSvgIcons(): Plugin {
  const directory = fileURLToPath(new URL('./src/assets/icons', import.meta.url));
  return {
    name: 'local-svg-icons',
    transformIndexHtml() {
      const symbols = readdirSync(directory).filter(name => name.endsWith('.svg')).map(name => {
        const source = readFileSync(path.join(directory, name), 'utf8');
        const viewBox = source.match(/viewBox="([^"]+)"/)?.[1] || '0 0 1024 1024';
        const content = source.replace(/^[\s\S]*?<svg\b[^>]*>/, '').replace(/<\/svg>\s*$/, '');
        return `<symbol id="icon-${path.basename(name, '.svg')}" viewBox="${viewBox}">${content}</symbol>`;
      }).join('');
      return [{
        tag: 'svg',
        attrs: { xmlns: 'http://www.w3.org/2000/svg', 'aria-hidden': 'true', style: 'display:none' },
        children: symbols,
        injectTo: 'body-prepend',
      }];
    },
  };
}

export default defineConfig({
  plugins: [vue(), localSvgIcons()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  base: './',
  worker: {
    format: 'es',
  },
})
