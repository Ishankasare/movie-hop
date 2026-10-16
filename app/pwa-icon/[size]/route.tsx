import { ImageResponse } from "next/og";
import { BrandIcon } from "@/lib/brandIcon";

/** The 192 and 512 px icons listed in the web manifest (stable URLs: /pwa-icon/192 and /pwa-icon/512). */
export async function GET(_req: Request, ctx: RouteContext<"/pwa-icon/[size]">) {
  const { size } = await ctx.params;
  if (size !== "192" && size !== "512") return new Response("Not found", { status: 404 });
  const n = Number(size);
  return new ImageResponse(<BrandIcon size={n} />, { width: n, height: n });
}
