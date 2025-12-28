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
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const formData = await req.formData();
    const name = String(formData.get("name") || "").trim();
    const audioFileName = String(formData.get("audioFile") || "").trim();
    const requestedCoverType = formData.get("coverType")
      ? String(formData.get("coverType"))
      : null;
    const coverUrl = formData.get("coverUrl") ? String(formData.get("coverUrl")) : null;
    const coverPart = formData.get("cover");
    const coverFile = coverPart instanceof File ? coverPart : null;

    if (!name || !audioFileName) {
      return new Response(JSON.stringify({ error: "Name and audioFile are required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const coverType: "uploaded" | "random" =
      requestedCoverType === "uploaded" && coverFile ? "uploaded" : "random";

    const demoStore = getStore("demos");
    const audioStore = getStore("demo-audio");

    const demosJson = await demoStore.get("all-demos", { type: "json" });
    const demos: Demo[] = (demosJson as any) || [];

    const newId = Date.now();
    const idStr = String(newId);
    const newDemo: Demo = {
      id: newId,
      name,
      audioFile: audioFileName,
      coverUrl: coverType === "random" ? coverUrl : null,
      coverType,
      uploadDate: new Date().toISOString(),
    };

    // Store cover (small) if provided
    if (coverFile) {
      const coverBuffer = await coverFile.arrayBuffer();
      const coverBlob = new Blob([coverBuffer], { type: coverFile.type || "image/jpeg" });
      await audioStore.set(`cover-${idStr}`, coverBlob);
      newDemo.coverType = "uploaded";
      newDemo.coverUrl = null;
    }

    demos.unshift(newDemo);
    await demoStore.setJSON("all-demos", demos);

    return new Response(JSON.stringify({ success: true, demo: newDemo }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("Error init upload:", e);
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const config: Config = {
  path: "/api/upload-demo-init",
};


