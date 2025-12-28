import type { Context, Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

export default async (req: Request, context: Context) => {
  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    const type = url.searchParams.get("type") || "audio"; // 'audio' or 'cover'

    if (!id) {
      return new Response(
        JSON.stringify({ error: "Demo ID is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const audioStore = getStore("demo-audio");
    const key = type === "cover" ? `cover-${id}` : `audio-${id}`;
    
    const blob = await audioStore.get(key, { type: "arrayBuffer" });
    const metadata = await audioStore.getMetadata(key);

    if (!blob) {
      return new Response("Not Found", { status: 404 });
    }

    const contentType = metadata?.contentType || (type === "cover" ? "image/jpeg" : "audio/mpeg");

    return new Response(blob, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (e: any) {
    console.error("Error fetching file:", e);
    return new Response(
      JSON.stringify({ error: String(e?.message || e) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

export const config: Config = {
  path: "/api/demo-audio",
};

