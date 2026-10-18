import AxeBuilder from "@axe-core/playwright";
import { devices, expect, test, type Browser, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

// Races with 3 and 4 players: four browser windows at once against the real Supabase project in .env.local.
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
const personButton = (name: string) => new RegExp("^Choose " + esc(name) + " (Cast|Director)$");
const filmButton = (title: string) => new RegExp("^Hop to " + esc(title) + "( \\(\\d{4}\\))?$");

type Player = { name: string; page: Page; close: () => Promise<void> };

async function newPlayer(browser: Browser, name: string): Promise<Player> {
  const ctx = await browser.newContext({ ...devices["Pixel 7"] });
  await ctx.route("https://image.tmdb.org/**", (r) => r.fulfill({ contentType: "image/png", body: ONE_PX_PNG }));
  return { name, page: await ctx.newPage(), close: () => ctx.close() };
}

/** Walks the first shortest route of the round's pair through the UI. */
async function playRound(page: Page) {
  await expect(page.getByTestId("start-title")).toBeVisible({ timeout: 25_000 });
  const start = (await page.getByTestId("start-title").textContent())!;
  const goal = (await page.getByTestId("goal-title").textContent())!;
  const pair = pairs.find((p) => p.start.title === start && p.goal.title === goal)!;
  const route = (pair.samplePaths ?? [pair.samplePath])[0];
  for (let i = 1; i < route.length - 1; i += 2) {
    await page.getByRole("button", { name: personButton(route[i]) }).click();
    await page.getByRole("button", { name: filmButton(route[i + 1]) }).click();
  }
}

async function host4(host: Player, rounds: "2 rounds" | "4 rounds" | "8 rounds", players = "4 players") {
  await host.page.goto("/race");
  await host.page.getByLabel("Your nickname").fill(host.name);
  await host.page.getByRole("button", { name: players, exact: true }).click();
  await host.page.getByRole("button", { name: rounds, exact: true }).click();
  await host.page.getByTestId("create-room").click();
  await expect(host.page.getByTestId("room-code")).toBeVisible({ timeout: 25_000 });
  return (await host.page.getByTestId("room-code").textContent())!.trim();
}

async function join(p: Player, code: string) {
  await p.page.goto("/race");
  await p.page.getByLabel("Your nickname").fill(p.name);
  await p.page.getByLabel("Room code").fill(code);
  await p.page.getByTestId("join-by-code").click();
  await expect(p.page).toHaveURL(new RegExp(`/race/${code}$`), { timeout: 25_000 }); // first visit signs in anonymously
}

/** Whoever the coin flip (or rotation) chose picks "Surprise me". */
async function pickWithWhoever(players: Player[]) {
  const picker = await Promise.race(
    players.map((p) =>
      p.page.getByRole("heading", { name: "Your pick" }).waitFor({ timeout: 30_000 }).then(() => p),
    ),
  );
  await picker.page.getByRole("button", { name: "Surprise me" }).click();
  return picker;
}

/** Accessibility check (WCAG A/AA + best practice) of whatever screen the page is showing. */
async function scan(page: Page, what: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]).analyze();
  const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s), e.g. ${v.nodes[0]?.target.join(" ")}`);
  expect(summary, `${what}: ${summary.join("; ")}`).toEqual([]);
}

async function everyoneReady(players: Player[]) {
  for (const p of players) await p.page.getByTestId("ready-button").click();
}

test.describe("race with 3 and 4 players (real Supabase)", () => {
  test.skip(!hasSupabase, "needs NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local");

  test("4 players: the lobby fills and starts by itself, everyone races, ranked results, rematch", async ({ browser }) => {
    test.setTimeout(420_000);
    const ps = [await newPlayer(browser, "Aria"), await newPlayer(browser, "Ben"), await newPlayer(browser, "Cleo"), await newPlayer(browser, "Dev")];
    const [aria, , , dev] = ps;
    try {
      const code = await host4(aria, "2 rounds");
      await join(ps[1], code);
      await join(ps[2], code);

      // three of four seats filled: still a lobby, with one empty seat, and the host may start early
      const list = aria.page.getByTestId("lobby-players").locator("li");
      await expect(list.filter({ hasText: "Ben" })).toBeVisible({ timeout: 20_000 });
      await expect(list.filter({ hasText: "Cleo" })).toBeVisible({ timeout: 20_000 });
      await expect(list).toHaveCount(4); // 3 players + 1 empty seat
      await expect(aria.page.getByText("Waiting for a player…")).toHaveCount(1);
      await expect(aria.page.getByTestId("start-match")).toContainText("Start with 3 players");
      await expect(ps[1].page.getByText(/Waiting for Aria to start/)).toBeVisible();
      await scan(aria.page, "lobby (host)");
      await scan(ps[1].page, "lobby (guest)");

      await join(dev, code); // the fourth player fills the room: the match starts by itself
      const picker = await pickWithWhoever(ps);
      await scan(picker.page, "ready screen");

      await everyoneReady(ps);
      for (const p of ps) await expect(p.page.getByTestId("start-title")).toBeVisible({ timeout: 30_000 });
      await scan(aria.page, "race board with three opponents");

      // everyone sees the other three players' hop counts, and nothing else about them
      for (const p of ps) await expect(p.page.getByTestId("opponent-moves").locator("li")).toHaveCount(3);

      // three of them race to the goal; Dev gives up
      await Promise.all([aria, ps[1], ps[2]].map((p) => playRound(p.page)));
      // a finished player keeps watching the others: Ben's waiting screen shows who is done, by name
      await expect(ps[1].page.getByTestId("waiting-opponents")).toContainText("Aria", { timeout: 20_000 });
      await expect(ps[1].page.getByTestId("waiting-opponents").locator("li").filter({ hasText: "Cleo" })).toContainText("done", {
        timeout: 20_000,
      });
      await scan(ps[1].page, "waiting screen");
      await dev.page.getByRole("button", { name: "Give up" }).click();

      // ranked results for all four, with the gave-up player last
      for (const p of ps) await expect(p.page.getByTestId("round-winner")).toBeVisible({ timeout: 30_000 });
      const rows = aria.page.getByRole("list", { name: "Round results, fastest first" }).locator("li");
      await expect(rows).toHaveCount(4);
      await expect(rows.last()).toContainText("Dev");
      await expect(rows.last()).toContainText("gave up");
      await expect(dev.page.getByText("You finished 4th of 4.")).toBeVisible();
      await scan(aria.page, "round results");

      // round 2: the next player in turn picks; everybody gives up quickly
      for (const p of ps) await p.page.getByTestId("next-round").click();
      await pickWithWhoever(ps);
      await everyoneReady(ps);
      for (const p of ps) await expect(p.page.getByTestId("start-title")).toBeVisible({ timeout: 30_000 });
      for (const p of ps) await p.page.getByRole("button", { name: "Give up" }).click();
      for (const p of ps) await expect(p.page.getByTestId("round-winner")).toBeVisible({ timeout: 30_000 });

      // final standings for all four, then a rematch needs everyone
      for (const p of ps) await p.page.getByTestId("next-round").click();
      for (const p of ps) await expect(p.page.getByTestId("match-winner")).toBeVisible({ timeout: 30_000 });
      await expect(aria.page.getByRole("list", { name: "Final standings" }).locator("li")).toHaveCount(4);
      await scan(aria.page, "final standings");

      for (const p of ps.slice(0, 3)) await p.page.getByTestId("rematch").click();
      await expect(aria.page.getByTestId("rematch")).toContainText("Waiting for Dev", { timeout: 15_000 });
      await dev.page.getByTestId("rematch").click();
      for (const p of ps) {
        await expect(p.page.getByText("is choosing the genre").or(p.page.getByRole("heading", { name: "Your pick" }))).toBeVisible({ timeout: 25_000 });
      }
    } finally {
      await Promise.all(ps.map((p) => p.close()));
    }
  });

  test("3 players: the host starts early, and a player who leaves mid-race doesn't stop the others", async ({ browser }) => {
    test.setTimeout(360_000);
    const ps = [await newPlayer(browser, "Host"), await newPlayer(browser, "Eve"), await newPlayer(browser, "Finn")];
    const [host, eve, finn] = ps;
    try {
      const code = await host4(host, "2 rounds");
      await join(eve, code);
      await join(finn, code);
      await expect(host.page.getByTestId("start-match")).toContainText("Start with 3 players", { timeout: 20_000 });
      await expect(host.page.getByTestId("start-match")).toBeEnabled();
      await host.page.getByTestId("start-match").click(); // not full (3 of 4), so the host starts it

      await pickWithWhoever(ps);
      await everyoneReady(ps);
      for (const p of ps) await expect(p.page.getByTestId("start-title")).toBeVisible({ timeout: 30_000 });

      // Finn leaves mid-race (asks twice before leaving a match)
      await finn.page.getByRole("button", { name: "← Leave" }).click();
      await finn.page.getByTestId("confirm-leave").click();
      await expect(finn.page).toHaveURL(/\/race$/);

      // the other two race on; the round closes once they are done
      await Promise.all([host, eve].map((p) => playRound(p.page)));
      for (const p of [host, eve]) await expect(p.page.getByTestId("round-winner")).toBeVisible({ timeout: 30_000 });
      const rows = host.page.getByRole("list", { name: "Round results, fastest first" }).locator("li");
      await expect(rows).toHaveCount(3);
      await expect(rows.last()).toContainText("Finn");
      await expect(rows.last()).toContainText("left the match");

      // the leaver is out of the rotation: round 2 is picked by one of the two who stayed
      for (const p of [host, eve]) await p.page.getByTestId("next-round").click();
      await pickWithWhoever([host, eve]);
    } finally {
      await Promise.all(ps.map((p) => p.close()));
    }
  });
});
