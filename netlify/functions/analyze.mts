import type { Context, Config } from "@netlify/functions";

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const apiKey = Netlify.env.get("OPENAI_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "OpenAI API key not configured" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const { songName, audioData } = body || {};

    if (!songName) {
      return new Response(
        JSON.stringify({ error: "songName is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const systemPrompt = [
      "You are a professional vocal coach and music producer.",
      "Listen carefully to the audio provided and analyze the singer's vocal performance in detail.",
      "Base your analysis ONLY on what you actually hear in the audio.",
    ].join(" ");

    const userPrompt = [
      `Song name: ${songName}`,
      "",
      "Listen to this singing demo and provide a detailed vocal analysis across these dimensions (score each 0–10 and give detailed explanation to your scoring - 100 words per dimension):",
      "- Breath control & support",
      "- Tone quality & timbre",
      "- Emotional delivery & storytelling",
      "- Pitch & intonation",
      "- Vocal technique (register balance, chest/head voice quality, mixed voice use, etc.)",
      "- Rhythm & time feel",
      "- Dynamics & control",
      "- Diction & articulation",
      "- Musical phrasing",
      "- Style & genre awareness",
      "- Vocal health & tension",
      "- Professional readiness",
      "",
      "Then:",
      "1) Give a final score (average).",
      "2) List 3–5 vocal strengths and 3–5 weaknesses based on what you heard.",
      "3) Suggest a weekly practice plan with concrete exercises tailored to the issues you identified.",
      "4) For each exercise, include 1–2 external references (YouTube query terms or article titles).",
      "",
      "Output format: clean markdown with headings and bullet lists.",
    ].join("\n");

    let messages: any[];
    let model: string;

    if (audioData) {
      model = "gpt-4o-audio-preview";
      messages = [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            {
              type: "input_audio",
              input_audio: {
                data: audioData,
                format: "mp3",
              },
            },
          ],
        },
      ];
    } else {
      model = Netlify.env.get("OPENAI_MODEL") || "gpt-4o";
      messages = [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content:
            userPrompt +
            "\n\n(Note: No audio was provided. Please provide a template analysis.)",
        },
      ];
    }

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.7,
        max_tokens: 4000,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      console.error("OpenAI API error:", resp.status, errText);
      return new Response(
        JSON.stringify({
          error: `OpenAI error (${resp.status})`,
          details: errText.slice(0, 4000),
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const data = await resp.json();
    const analysis = data?.choices?.[0]?.message?.content || "";
    return new Response(JSON.stringify({ analysis }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("Analysis error:", e);
    return new Response(
      JSON.stringify({ error: String(e?.message || e) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

export const config: Config = {
  path: "/api/analyze",
};

