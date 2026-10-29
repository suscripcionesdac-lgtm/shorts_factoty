import { defineConfig } from '@playwright/test';
import { PORT } from './tests-ui/setup';

// Pruebas de la app en el navegador: `npm run test:ui`. Usan el Edge instalado (no descargan navegadores).
export default defineConfig({
  testDir: 'tests-ui',
  testMatch: '*.pw.ts',
  globalSetup: './tests-ui/setup.ts',
  timeout: 300_000,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${PORT}`, channel: process.env.CLIPPER_UI_BROWSER || 'msedge', viewport: { width: 1440, height: 900 }, colorScheme: 'dark' },
});
