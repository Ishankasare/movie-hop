import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  // the database tests are slow and need the network: run them with `npm run test:db`
  test: { environment: "node", include: ["tests/**/*.test.ts"], exclude: ["tests/**/*.integration.test.ts", "node_modules/**"] },
});
