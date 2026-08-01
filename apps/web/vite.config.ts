import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import typegpu from 'unplugin-typegpu/vite';

function audioIndex(): Plugin {
  const list = () => {
    try {
      const files = readdirSync(resolve(process.cwd(), 'public/audio'));
      return JSON.stringify(files.filter((f) => /\.(ogg|mp3|m4a|wav)$/i.test(f)));
    } catch {
      return '[]';
    }
  };
  return {
    name: 'audio-index',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0].endsWith('/audio/index.json')) {
          res.setHeader('Content-Type', 'application/json');
          res.end(list());
        } else {
          next();
        }
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'audio/index.json', source: list() });
    },
  };
}

/** The dev server falls back to index.html for unknown paths; asset probes must
 * see a real 404 so missing packs switch the engine to placeholders. */
function missingAssets404(): Plugin {
  return {
    name: 'missing-assets-404',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = decodeURIComponent(req.url?.split('?')[0] ?? '');
        if (
          (path.startsWith('/game/') || path.startsWith('/audio/')) &&
          !existsSync(resolve(process.cwd(), 'public', path.slice(1)))
        ) {
          res.statusCode = 404;
          res.end();
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  base: './',
  resolve: {
    alias: [
      {
        find: /^#platform\/(.*)$/,
        replacement: `${resolve(import.meta.dirname, 'src/platform')}/$1`,
      },
    ],
  },
  optimizeDeps: { exclude: ['@bonetide/engine'] },
  plugins: [
    typegpu({}),
    audioIndex(),
    missingAssets404(),
    {
      ...basicSsl(),
      apply(_, { command, mode }) {
        return command === 'serve' && mode === 'https';
      },
    },
  ],
});
