import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Tests that talk to the real Supabase project (needs NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY in .env.local).
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: { environment: "node", include: ["tests/**/*.integration.test.ts"], testTimeout: 30_000 },
});
