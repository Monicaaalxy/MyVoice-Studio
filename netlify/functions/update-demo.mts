import type { Context, Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

interface Demo {
  id: number;
  name: string;
  audioFile: string;
  coverUrl: string | null;
  coverType: "uploaded" | "random";
  uploadDate: string;
}

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
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const formData = await req.formData();
    const rawId = formData.get("id");
    const idStr = rawId == null ? "" : String(rawId);
    const idNum = Number(idStr);
    const name = formData.get("name") as string | null;
    const coverFile = formData.get("cover") as File | null;
    const coverUrl = formData.get("coverUrl") as string | null;
    const coverType = formData.get("coverType") as "uploaded" | "random" | null;

    if (!idStr) {
      return new Response(
        JSON.stringify({ error: "Demo ID is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const demoStore = getStore("demos");
    const audioStore = getStore("demo-audio");

    // Get existing demos
    const demosJson = await demoStore.get("all-demos", { type: "json" });
    const demos: Demo[] = demosJson || [];

    const index = demos.findIndex((d: any) => String(d?.id) === idStr);
    if (index === -1) {
      return new Response(
        JSON.stringify({ error: "Demo not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // Update demo fields
    if (name) demos[index].name = name;
    if (coverType) demos[index].coverType = coverType;
    if (coverType === "random") {
      demos[index].coverUrl = coverUrl || null;
    } else if (coverUrl !== null) {
      demos[index].coverUrl = coverUrl;
    }

    // Store new cover file if uploaded
    if (coverFile) {
      const coverBuffer = await coverFile.arrayBuffer();
      const coverBlob = new Blob([coverBuffer], { type: coverFile.type || "image/jpeg" });
      await audioStore.set(`cover-${idStr}`, coverBlob);
      demos[index].coverType = "uploaded";
      demos[index].coverUrl = null;
    }

    await demoStore.setJSON("all-demos", demos);

    return new Response(
      JSON.stringify({ success: true, demo: demos[index] }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    console.error("Error updating demo:", e);
    return new Response(
      JSON.stringify({ error: String(e?.message || e) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

export const config: Config = {
  path: "/api/update-demo",
};

