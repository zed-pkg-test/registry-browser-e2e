import {defineConfig,devices} from '@playwright/test';
export default defineConfig({testDir:'./tests/browser',use:{baseURL:process.env.TARGET_URL||'http://127.0.0.1:3000',trace:'retain-on-failure'},projects:[{name:'chromium',use:{...devices['Desktop Chrome']}},{name:'firefox',use:{...devices['Desktop Firefox']}},{name:'webkit',use:{...devices['Desktop Safari']}}]});
