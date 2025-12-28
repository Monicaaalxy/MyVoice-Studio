import type { Context, Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

function getOwnerPassword(): string | null {
  return Netlify.env.get("OWNER_PASSWORD") || "MyVoiceStudio2026";
}

function isOwner(req: Request): boolean {
  const password = getOwnerPassword();
  if (!password) return false;
  const authHeader = req.headers.get("X-Owner-Password");
  return authHeader === password;
}

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  if (!isOwner(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const idStr = String(body?.id || "").trim();
    const total = Number(body?.total);
    const contentType = String(body?.contentType || "audio/mpeg");

    if (!idStr || !Number.isFinite(total) || total <= 0) {
      return new Response(JSON.stringify({ error: "Missing id/total" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const audioStore = getStore("demo-audio");

    // Load chunks, concatenate
    const parts: Uint8Array[] = [];
    let totalBytes = 0;

    for (let i = 0; i < total; i++) {
      const key = `audio-tmp-${idStr}-${i}`;
      const chunkBlob = await audioStore.get(key, { type: "blob" });
      if (!chunkBlob) {
        return new Response(JSON.stringify({ error: `Missing chunk ${i}` }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      const ab = await (chunkBlob as Blob).arrayBuffer();
      const u8 = new Uint8Array(ab);
      parts.push(u8);
      totalBytes += u8.byteLength;
    }

    const out = new Uint8Array(totalBytes);
    let offset = 0;
    for (const p of parts) {
      out.set(p, offset);
      offset += p.byteLength;
    }

    const finalBlob = new Blob([out], { type: contentType || "audio/mpeg" });
    await audioStore.set(`audio-${idStr}`, finalBlob);

    // Cleanup chunks
    for (let i = 0; i < total; i++) {
      await audioStore.delete(`audio-tmp-${idStr}-${i}`);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("Error completing upload:", e);
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const config: Config = {
  path: "/api/upload-audio-complete",
};


