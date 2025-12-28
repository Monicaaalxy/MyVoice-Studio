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
    const formData = await req.formData();
    const idStr = String(formData.get("id") || "").trim();
    const indexStr = String(formData.get("index") || "").trim();
    const totalStr = String(formData.get("total") || "").trim();
    const contentType = String(formData.get("contentType") || "audio/mpeg");

    const chunkPart = formData.get("chunk");
    const chunkFile = chunkPart instanceof File ? chunkPart : null;

    if (!idStr || !indexStr || !totalStr || !chunkFile) {
      return new Response(JSON.stringify({ error: "Missing id/index/total/chunk" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const index = Number(indexStr);
    const total = Number(totalStr);
    if (!Number.isFinite(index) || !Number.isFinite(total) || index < 0 || total <= 0) {
      return new Response(JSON.stringify({ error: "Invalid index/total" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const audioStore = getStore("demo-audio");
    const buf = await chunkFile.arrayBuffer();
    const blob = new Blob([buf], { type: contentType || "audio/mpeg" });
    await audioStore.set(`audio-tmp-${idStr}-${index}`, blob);

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("Error uploading chunk:", e);
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const config: Config = {
  path: "/api/upload-audio-chunk",
};


