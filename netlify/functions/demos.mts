import type { Context, Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

interface Demo {
  id: number;
  name: string;
  audioFile: string;
  coverUrl: string | null;
  coverType: "uploaded" | "random";
  uploadDate: string;
  audioData?: string; // Base64 encoded audio for playback
  coverData?: string; // Base64 encoded cover image
}

function getOwnerPassword(): string | null {
  // Try environment variable first, fallback to default for testing
  return Netlify.env.get("OWNER_PASSWORD") || "MyVoiceStudio2026";
}

function isOwner(req: Request): boolean {
  const password = getOwnerPassword();
  if (!password) return false;
  
  const authHeader = req.headers.get("X-Owner-Password");
  return authHeader === password;
}

export default async (req: Request, context: Context) => {
  const store = getStore("demos");

  // GET - Public: Anyone can view demos
  if (req.method === "GET") {
    try {
      const demosJson = await store.get("all-demos", { type: "json" });
      const demos: Demo[] = demosJson || [];
      
      // Return demos without audio data for listing (too large)
      const demosForListing = demos.map((d) => ({
        ...d,
        audioData: undefined, // Don't send audio data in list
      }));
      
      return new Response(JSON.stringify({ demos: demosForListing }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (e: any) {
      console.error("Error fetching demos:", e);
      return new Response(JSON.stringify({ demos: [] }), {
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // POST - Owner only: Add new demo
  if (req.method === "POST") {
    if (!isOwner(req)) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    try {
      const body = await req.json();
      const { demo } = body;

      if (!demo || !demo.name) {
        return new Response(
          JSON.stringify({ error: "Demo name is required" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const demosJson = await store.get("all-demos", { type: "json" });
      const demos: Demo[] = demosJson || [];

      const newDemo: Demo = {
        id: Date.now(),
        name: demo.name,
        audioFile: demo.audioFile || "",
        coverUrl: demo.coverUrl || null,
        coverType: demo.coverType || "random",
        uploadDate: new Date().toISOString(),
        audioData: demo.audioData,
        coverData: demo.coverData,
      };

      demos.unshift(newDemo);
      await store.setJSON("all-demos", demos);

      // Also store the audio separately for playback
      if (demo.audioData) {
        await store.set(`audio:${newDemo.id}`, demo.audioData);
      }
      if (demo.coverData) {
        await store.set(`cover:${newDemo.id}`, demo.coverData);
      }

      return new Response(
        JSON.stringify({ success: true, demo: { ...newDemo, audioData: undefined } }),
        { headers: { "Content-Type": "application/json" } }
      );
    } catch (e: any) {
      console.error("Error adding demo:", e);
      return new Response(
        JSON.stringify({ error: String(e?.message || e) }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  // PUT - Owner only: Update demo
  if (req.method === "PUT") {
    if (!isOwner(req)) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    try {
      const body = await req.json();
      const { id, updates } = body;

      if (!id) {
        return new Response(
          JSON.stringify({ error: "Demo ID is required" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const demosJson = await store.get("all-demos", { type: "json" });
      const demos: Demo[] = demosJson || [];

      const index = demos.findIndex((d) => d.id === id);
      if (index === -1) {
        return new Response(
          JSON.stringify({ error: "Demo not found" }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        );
      }

      demos[index] = { ...demos[index], ...updates };
      
      // Update cover if provided
      if (updates.coverData) {
        await store.set(`cover:${id}`, updates.coverData);
      }

      await store.setJSON("all-demos", demos);

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
  }

  // DELETE - Owner only: Delete demo
  if (req.method === "DELETE") {
    if (!isOwner(req)) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    try {
      const url = new URL(req.url);
      const id = parseInt(url.searchParams.get("id") || "0");

      if (!id) {
        return new Response(
          JSON.stringify({ error: "Demo ID is required" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const demosJson = await store.get("all-demos", { type: "json" });
      let demos: Demo[] = demosJson || [];

      demos = demos.filter((d) => d.id !== id);

      // Clean up stored audio/cover
      await store.delete(`audio:${id}`);
      await store.delete(`cover:${id}`);

      await store.setJSON("all-demos", demos);

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { "Content-Type": "application/json" } }
      );
    } catch (e: any) {
      console.error("Error deleting demo:", e);
      return new Response(
        JSON.stringify({ error: String(e?.message || e) }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    headers: { "Content-Type": "application/json" },
  });
};

export const config: Config = {
  path: "/api/demos",
};

