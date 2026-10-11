
























import { Hono } from "hono";
import { HonoEnv } from "../types/hono.ts";
import { ApiResponse } from "../utils/response.ts";

const staticRoutes = new Hono<HonoEnv>();


const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];


const ASSET_PATH = "/static/defaultapp.png";


staticRoutes.get("/defaultapp.png", async (c) => {
  if (!c.env?.ASSETS) {
    return ApiResponse.error(
      "Service Unavailable",
      503,
      "Static assets binding not configured"
    );
  }


  const assetUrl = new URL(c.req.url);
  assetUrl.pathname = ASSET_PATH;
  const asset = await c.env.ASSETS.fetch(new Request(assetUrl.toString()));

  if (asset.status !== 200) {
    return ApiResponse.error(
      "Not Found",
      404,
      "Default application image not found in static assets"
    );
  }

  const contentType = asset.headers.get("content-type") || "";
  if (contentType.includes("text/html")) {

    return ApiResponse.error(
      "Internal Server Error",
      500,
      "Default application image unavailable: static asset fallback returned HTML"
    );
  }

  const bytes = new Uint8Array(await asset.arrayBuffer());
  const isPng =
    bytes.length >= PNG_SIGNATURE.length &&
    PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
  if (!isPng) {
    return ApiResponse.error(
      "Internal Server Error",
      500,
      "Default application image unavailable: static asset is not a PNG"
    );
  }

  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=3600",
    },
  });
});

export { staticRoutes };
