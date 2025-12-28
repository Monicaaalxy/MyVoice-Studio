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
    const { demos } = body || {};

    if (!demos || !Array.isArray(demos) || demos.length < 3) {
      return new Response(
        JSON.stringify({ error: "At least 3 demos are required for a voice report" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const demoList = demos.map((d: any) => d.name || "Untitled").join(", ");
    const model = Netlify.env.get("OPENAI_MODEL") || "gpt-4o";

    const systemPrompt = [
      "You are a professional vocal coach, music producer, and talent scout with 20+ years of experience.",
      "You have analyzed thousands of singers and have a deep understanding of vocal development, genre suitability, and career guidance.",
      "Be encouraging but honest. Provide actionable, specific advice.",
    ].join(" ");

    const userPrompt = [
      `I have analyzed ${demos.length} vocal demos from a singer. The songs are: ${demoList}.`,
      "",
      "Based on these performances, please provide a comprehensive voice report with the following sections.",
      "Each section should be approximately 200 words with detailed, specific explanations.",
      "",
      "Respond in JSON format with these exact keys:",
      "",
      "1. 'talent': Assessment of whether this person has vocal talent.",
      "2. 'genre': Their general genre/style.",
      "3. 'directionGo': The direction they SHOULD go.",
      "4. 'directionAvoid': The direction they should AVOID.",
      "5. 'similar': Recommend 5-8 professional singers with similar vocal qualities.",
      "6. 'strengths': Their top 5 vocal strengths.",
      "7. 'weaknesses': Their top 5 areas for improvement.",
      "8. 'exercises': Weekly vocal exercises tailored to their needs.",
      "",
      "Return ONLY valid JSON, no markdown code blocks.",
    ].join("\n");

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 6000,
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
    const content = data?.choices?.[0]?.message?.content || "";

    try {
      const cleanContent = content
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();
      const report = JSON.parse(cleanContent);
      return new Response(JSON.stringify(report), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (parseErr) {
      console.error("Failed to parse report JSON:", parseErr);
      return new Response(
        JSON.stringify({
          talent: content,
          genre: "See above",
          directionGo: "See above",
          directionAvoid: "See above",
          similar: "See above",
          strengths: "See above",
          weaknesses: "See above",
          exercises: "See above",
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }
  } catch (e: any) {
    console.error("Voice report error:", e);
    return new Response(
      JSON.stringify({ error: String(e?.message || e) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

export const config: Config = {
  path: "/api/voice-report",
};

