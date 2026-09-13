import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./tests/browser',
  workers:1,
  fullyParallel:false,
  use:{baseURL:'http://127.0.0.1:5179',channel:process.env.E2E_CHANNEL || undefined,trace:'retain-on-failure'},
  webServer:{command:'node scripts/e2e-server.js',url:'http://127.0.0.1:5179/api/health',reuseExistingServer:false,timeout:30000}
});
