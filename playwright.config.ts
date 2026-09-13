import { defineConfig } from "playwright/test";

export default defineConfig({
  testDir: "./spec/javascript",
  outputDir: "./tmp/playwright",
  use: {
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
});
