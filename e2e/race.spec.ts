import { devices, expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

// Plays a full 2-round match between two browser windows against the real Supabase project in .env.local.
// Skipped when those settings are missing.
try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local
}
const hasSupabase = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

type Pair = { start: { title: string }; goal: { title: string }; samplePath: string[]; samplePaths?: string[][] };
const pairs: Pair[] = JSON.parse(readFileSync(path.join(__dirname, "../data/pairs.json"), "utf8"));

const ONE_PX_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// exact names: "Hop to Doctor Strange" must not also match "Doctor Strange in the Multiverse of Madness"
const personButton = (name: string) => new RegExp("^Choose " + esc(name) + " (Cast|Director)$");
const filmButton = (title: string) => new RegExp("^Hop to " + esc(title) + "( \\(\\d{4}\\))?$");

async function newPlayer(browser: import("@playwright/test").Browser) {
  const ctx = await browser.newContext({ ...devices["Pixel 7"] });
  await ctx.route("https://image.tmdb.org/**", (r) => r.fulfill({ contentType: "image/png", body: ONE_PX_PNG }));
  return { ctx, page: await ctx.newPage() };
}

/** Walks the first shortest route of the round's pair through the UI. */
async function playRound(page: Page) {
  await expect(page.getByTestId("start-title")).toBeVisible({ timeout: 20_000 });
  const start = (await page.getByTestId("start-title").textContent())!;
  const goal = (await page.getByTestId("goal-title").textContent())!;
  const pair = pairs.find((p) => p.start.title === start && p.goal.title === goal)!;
  expect(pair, `pair ${start} -> ${goal} should be in pairs.json`).toBeDefined();
  const route = (pair.samplePaths ?? [pair.samplePath])[0];
  for (let i = 1; i < route.length - 1; i += 2) {
    await page.getByRole("button", { name: personButton(route[i]) }).click();
    await page.getByRole("button", { name: filmButton(route[i + 1]) }).click();
  }
}

test.describe("race (two players, real Supabase)", () => {
  test.skip(!hasSupabase, "needs NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local");

  test("joining an unknown room shows a friendly error", async ({ page }) => {
    await page.goto("/race");
    await page.getByLabel("Room code").fill("ZZZZ2");
    await page.getByTestId("join-by-code").click();
    await expect(page.getByText("couldn't find that room")).toBeVisible();
  });

  test("a full 2-round match: picks, countdown, hop counts, results, rematch", async ({ browser }) => {
    test.setTimeout(300_000);
    const host = await newPlayer(browser);
    const guest = await newPlayer(browser);
    try {
      // host creates a room
      await host.page.goto("/race");
      await host.page.getByLabel("Your nickname").fill("Hosty");
      await host.page.getByTestId("create-room").click();
      await expect(host.page.getByTestId("room-code")).toBeVisible({ timeout: 20_000 });
      const code = (await host.page.getByTestId("room-code").textContent())!.trim();
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);

      // guest joins with the code
      await guest.page.goto("/race");
      await guest.page.getByLabel("Your nickname").fill("Guesty");
      await guest.page.getByLabel("Room code").fill(code);
      await guest.page.getByTestId("join-by-code").click();
      await expect(guest.page).toHaveURL(new RegExp(`/race/${code}$`));

      // ---- round 1: whoever the coin flip chose picks "Surprise me"
      const pickerOf = async () =>
        Promise.race([
          host.page.getByRole("heading", { name: "Your pick" }).waitFor({ timeout: 30_000 }).then(() => ({ picker: host, other: guest })),
          guest.page.getByRole("heading", { name: "Your pick" }).waitFor({ timeout: 30_000 }).then(() => ({ picker: guest, other: host })),
        ]);
      let { picker, other } = await pickerOf();
      await expect(other.page.getByText("is choosing the genre")).toBeVisible();
      await picker.page.getByRole("button", { name: "Surprise me" }).click();

      for (const p of [host, guest]) await p.page.getByTestId("ready-button").click();

      // both see the countdown, then the board
      await expect(host.page.getByTestId("countdown")).toBeVisible({ timeout: 15_000 });
      await expect(host.page.getByTestId("start-title")).toBeVisible({ timeout: 20_000 });
      await expect(guest.page.getByTestId("start-title")).toBeVisible({ timeout: 20_000 });

      // same start and goal for both
      expect(await host.page.getByTestId("start-title").textContent()).toBe(await guest.page.getByTestId("start-title").textContent());
      expect(await host.page.getByTestId("goal-title").textContent()).toBe(await guest.page.getByTestId("goal-title").textContent());

      // host races; the guest sees only a hop count that goes up
      await playRound(host.page);
      await expect(guest.page.getByTestId("opponent-moves")).toContainText(/[1-9]\d* hop/, { timeout: 15_000 });
      await expect(host.page.getByTestId("my-time")).toBeVisible({ timeout: 15_000 });

      // guest gives up: the round ends with the host winning
      await guest.page.getByRole("button", { name: "Give up" }).click();
      await expect(host.page.getByTestId("round-winner")).toBeVisible({ timeout: 20_000 });
      await expect(host.page.getByTestId("round-winner")).toHaveText("You won the round!");
      await expect(guest.page.getByTestId("round-winner")).toHaveText("Hosty won the round", { timeout: 20_000 });

      // ---- round 2: the OTHER player picks
      for (const p of [host, guest]) await p.page.getByTestId("next-round").click();
      await expect(other.page.getByRole("heading", { name: "Your pick" })).toBeVisible({ timeout: 20_000 });
      [picker, other] = [other, picker];
      await picker.page.getByRole("button", { name: "Surprise me" }).click();
      for (const p of [host, guest]) await p.page.getByTestId("ready-button").click();
      await expect(host.page.getByTestId("start-title")).toBeVisible({ timeout: 25_000 });
      await expect(guest.page.getByTestId("start-title")).toBeVisible({ timeout: 25_000 });

      // both finish this time
      await Promise.all([playRound(host.page), playRound(guest.page)]);
      await expect(host.page.getByTestId("round-winner")).toBeVisible({ timeout: 20_000 });

      // ---- match over: both see a winner, then a rematch needs both
      for (const p of [host, guest]) await p.page.getByTestId("next-round").click();
      await expect(host.page.getByTestId("match-winner")).toBeVisible({ timeout: 20_000 });
      await expect(guest.page.getByTestId("match-winner")).toBeVisible({ timeout: 20_000 });

      await host.page.getByTestId("rematch").click();
      await expect(host.page.getByTestId("rematch")).toContainText("Waiting for Guesty");
      await guest.page.getByTestId("rematch").click();
      await expect(host.page.getByText("is choosing the genre").or(host.page.getByRole("heading", { name: "Your pick" }))).toBeVisible({
        timeout: 20_000,
      });
    } finally {
      await host.ctx.close();
      await guest.ctx.close();
    }
  });
});
