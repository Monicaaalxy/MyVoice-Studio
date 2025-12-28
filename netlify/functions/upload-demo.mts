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
    const name = String(formData.get("name") || "").trim();
    const audioPart = formData.get("audio");
    const coverPart = formData.get("cover");
    const coverUrl = formData.get("coverUrl") ? String(formData.get("coverUrl")) : null;
    const requestedCoverType = formData.get("coverType") ? String(formData.get("coverType")) : null;

    const audioFile = audioPart instanceof File ? audioPart : null;
    const coverFile = coverPart instanceof File ? coverPart : null;
    const coverType: "uploaded" | "random" =
      requestedCoverType === "uploaded" && coverFile ? "uploaded" : "random";

    if (!name || !audioFile) {
      return new Response(
        JSON.stringify({ error: "Name and audio file are required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const demoStore = getStore("demos");
    const audioStore = getStore("demo-audio");

    // Get existing demos
    const demosJson = await demoStore.get("all-demos", { type: "json" });
    const demos: Demo[] = demosJson || [];

    // Create new demo
    const newId = Date.now(); // keep numeric for now, but treat keys as strings
    const newIdStr = String(newId);
    const newDemo: Demo = {
      id: newId,
      name: name,
      audioFile: audioFile.name,
      coverUrl: coverType === "random" ? coverUrl : null,
      coverType: coverType,
      uploadDate: new Date().toISOString(),
    };

    // Store audio file in blobs
    const audioBuffer = await audioFile.arrayBuffer();
    const audioBlob = new Blob([audioBuffer], { type: audioFile.type || "audio/mpeg" });
    await audioStore.set(`audio-${newIdStr}`, audioBlob);

    // Store cover file if uploaded
    if (coverFile) {
      const coverBuffer = await coverFile.arrayBuffer();
      const coverBlob = new Blob([coverBuffer], { type: coverFile.type || "image/jpeg" });
      await audioStore.set(`cover-${newIdStr}`, coverBlob);
    }

    // Add to demos list
    demos.unshift(newDemo);
    await demoStore.setJSON("all-demos", demos);

    return new Response(
      JSON.stringify({ success: true, demo: newDemo }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    console.error("Error uploading demo:", e);
    return new Response(
      JSON.stringify({ error: String(e?.message || e) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

export const config: Config = {
  path: "/api/upload-demo",
};

