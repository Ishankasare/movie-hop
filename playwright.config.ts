import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
// Set E2E_BASE_URL (e.g. https://movie-hop.vercel.app) to run the tests against a deployed site
// instead of building and serving the app locally.
const REMOTE = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  reporter: "list",
  use: { baseURL: REMOTE ?? `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "mobile-chromium", use: { ...devices["Pixel 7"] } }],
  webServer: REMOTE
    ? undefined
    : {
        command: `npm run build && npx next start -p ${PORT}`,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: !process.env.CI,
        timeout: 240_000,
        env: { NEXT_DIST_DIR: ".next-e2e" },
      },
});
