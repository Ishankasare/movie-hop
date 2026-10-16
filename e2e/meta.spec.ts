import { expect, test } from "@playwright/test";

// Link preview image, icons and manifest: what social apps and phones fetch when the link is shared or installed.

const PNG = [0x89, 0x50, 0x4e, 0x47];

for (const [url, width, height] of [
  ["/opengraph-image", 1200, 630],
  ["/twitter-image", 1200, 630],
  ["/icon", 32, 32],
  ["/apple-icon", 180, 180],
  ["/pwa-icon/192", 192, 192],
  ["/pwa-icon/512", 512, 512],
] as const) {
  test(`${url} is a ${width}x${height} PNG`, async ({ request }) => {
    const res = await request.get(url);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/png");
    const body = await res.body();
    expect([...body.subarray(0, 4)]).toEqual(PNG);
    // width and height sit at fixed offsets in a PNG header
    expect(body.readUInt32BE(16)).toBe(width);
    expect(body.readUInt32BE(20)).toBe(height);
  });
}

test("the PWA icon route refuses other sizes", async ({ request }) => {
  expect((await request.get("/pwa-icon/999")).status()).toBe(404);
});

test("the manifest names the app and points at working icons", async ({ request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.status()).toBe(200);
  const manifest = await res.json();
  expect(manifest).toMatchObject({ name: "Movie Hop", display: "standalone", start_url: "/" });
  for (const icon of manifest.icons as { src: string }[]) expect((await request.get(icon.src)).status()).toBe(200);
});

test("pages advertise the preview image, and the footer links to About", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /opengraph-image/);
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
  await page.getByRole("link", { name: "About & credits" }).click();
  await expect(page.getByRole("heading", { name: "About & credits", level: 1 })).toBeVisible();
});
