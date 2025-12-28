import type { Context, Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

export default async (req: Request, context: Context) => {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");

    if (!id) {
      return new Response(
        JSON.stringify({ error: "Demo ID is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const store = getStore("demos");
    const audioData = await store.get(`audio:${id}`);

    if (!audioData) {
      return new Response(
        JSON.stringify({ error: "Audio not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ audioData }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("Error fetching audio:", e);
    return new Response(
      JSON.stringify({ error: String(e?.message || e) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

export const config: Config = {
  path: "/api/demo-audio",
};

