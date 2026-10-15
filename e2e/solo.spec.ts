import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

type Pair = {
  start: { title: string };
  goal: { title: string };
  minHops: number;
  samplePath: string[];
  samplePaths?: string[][];
};
const pairs: Pair[] = JSON.parse(readFileSync(path.join(__dirname, "../data/pairs.json"), "utf8"));
const pair = pairs[0]; // Math.random is pinned to 0 below, so the first pair is served
const route = (pair.samplePaths ?? [pair.samplePath])[0]; // [film, person, film, person, ..., goal]

const ONE_PX_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function setup(page: Page) {
  await page.addInitScript(() => {
    Math.random = () => 0;
    localStorage.clear();
  });
  await page.route("https://image.tmdb.org/**", (r) => r.fulfill({ contentType: "image/png", body: ONE_PX_PNG }));
  await page.goto("/play");
  await expect(page.getByTestId("start-title")).toHaveText(pair.start.title);
  await expect(page.getByTestId("goal-title")).toHaveText(pair.goal.title);
}

/** Choose route[i] (a person) on the current film, then hop to route[i + 1] (a film). */
async function hopVia(page: Page, i: number) {
  await page.getByRole("button", { name: new RegExp(`^Choose ${esc(route[i])}`) }).click();
  await page.getByRole("button", { name: new RegExp(`^Hop to ${esc(route[i + 1])}`) }).click();
}

test("plays a round film → person → film to the win screen, and Back costs a move", async ({ page }) => {
  await setup(page);
  await expect(page.getByTestId("hop-count")).toHaveText("0");

  // choosing a person and closing the list is free
  await page.getByRole("button", { name: new RegExp(`^Choose ${esc(route[1])}`) }).click();
  await page.getByRole("button", { name: "Back to cast" }).click();
  await expect(page.getByTestId("hop-count")).toHaveText("0");

  await hopVia(page, 1); // 1
  await expect(page.getByTestId("hop-count")).toHaveText("1");
  await page.getByRole("button", { name: "Back", exact: true }).click(); // 2: Back counts
  await expect(page.getByTestId("current-title")).toContainText(pair.start.title);
  await expect(page.getByTestId("hop-count")).toHaveText("2");

  for (let i = 1; i < route.length - 1; i += 2) await hopVia(page, i);

  await expect(page.getByRole("heading", { name: "You made it!" })).toBeVisible();
  await expect(page.getByTestId("result-hops")).toHaveText(String(pair.minHops + 2));
  await expect(page.getByTestId("result-best")).toHaveText(String(pair.minHops));
  await expect(page.getByTestId("your-route")).toContainText(route[1]);
  const routes = page.getByTestId("routes").locator("li");
  expect(await routes.count()).toBeGreaterThanOrEqual(1);
  await expect(routes.first()).toContainText(route[1]);
});

test("the hint can be used once, costs a hop, and is marked on the result", async ({ page }) => {
  await setup(page);
  const hint = page.getByRole("button", { name: /^Hint/ });
  await hint.click();
  await expect(page.getByTestId("hint-text")).toContainText("One shortest route ends through");
  await expect(page.getByTestId("hop-count")).toHaveText("1");
  await expect(page.getByRole("button", { name: "Hint used" })).toBeDisabled();

  for (let i = 1; i < route.length - 1; i += 2) await hopVia(page, i);
  await expect(page.getByRole("heading", { name: "You made it!" })).toBeVisible();
  await expect(page.getByTestId("result-hops")).toHaveText(String(pair.minHops + 1));
  await expect(page.getByText("You used the hint")).toBeVisible();
});

test("Give up shows the shortest routes", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "Give up" }).click();
  await expect(page.getByRole("heading", { name: "You gave up" })).toBeVisible();
  await expect(page.getByTestId("routes").locator("li").first()).toContainText(pair.goal.title);
});
