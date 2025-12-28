import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const app = express();
// Increase limit to handle audio files (up to 25MB for longer songs)
app.use(express.json({ limit: "25mb" }));

// Serve the static PWA files from repo root
app.use(express.static(rootDir));

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

app.post("/api/analyze", async (req, res) => {
  try {
    const apiKey = requireEnv("OPENAI_API_KEY");
    const { songName, audioData } = req.body || {};

    if (!songName) {
      return res.status(400).json({ error: "songName is required" });
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

    let messages;
    let model;

    if (audioData) {
      // Use GPT-4o-audio-preview model which can process audio input
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
                format: "mp3"
              }
            }
          ]
        }
      ];
    } else {
      // Fallback: no audio provided, use regular GPT-4o
      model = process.env.OPENAI_MODEL || "gpt-4o";
      messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt + "\n\n(Note: No audio was provided. Please provide a template analysis.)" }
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
      return res.status(500).json({ error: `OpenAI error (${resp.status})`, details: errText.slice(0, 4000) });
    }

    const data = await resp.json();
    const analysis = data?.choices?.[0]?.message?.content || "";
    return res.json({ analysis });
  } catch (e) {
    console.error("Analysis error:", e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

// Voice Report endpoint - generates comprehensive vocal report based on all demos
app.post("/api/voice-report", async (req, res) => {
  try {
    const apiKey = requireEnv("OPENAI_API_KEY");
    const { demos } = req.body || {};

    if (!demos || !Array.isArray(demos) || demos.length < 3) {
      return res.status(400).json({ error: "At least 3 demos are required for a voice report" });
    }

    const demoList = demos.map(d => d.name || "Untitled").join(", ");
    const model = process.env.OPENAI_MODEL || "gpt-4o";

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
      "1. 'talent': Assessment of whether this person has vocal talent. Discuss their natural abilities, musicality, and potential. Be honest but encouraging.",
      "",
      "2. 'genre': Their general genre/style. What type of music does their voice naturally suit? Consider timbre, range, and stylistic tendencies.",
      "",
      "3. 'directionGo': The direction they SHOULD go. What genres, styles, or artistic paths would best showcase their voice? What collaborations or projects should they pursue?",
      "",
      "4. 'directionAvoid': The direction they should AVOID. What genres or styles might not suit their voice or could harm their vocal health?",
      "",
      "5. 'similar': Recommend 5-8 professional singers and their songs that have similar vocal qualities. Explain WHY each artist is relevant.",
      "",
      "6. 'strengths': Their top 5 vocal strengths with detailed explanations of how these manifest in their singing.",
      "",
      "7. 'weaknesses': Their top 5 areas for improvement with specific, constructive feedback.",
      "",
      "8. 'exercises': The most important weekly vocal exercises tailored to their specific needs. Include specific routines, durations, and external resources (YouTube search terms, article titles).",
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
          { role: "user", content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 6000,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      console.error("OpenAI API error:", resp.status, errText);
      return res.status(500).json({ error: `OpenAI error (${resp.status})`, details: errText.slice(0, 4000) });
    }

    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content || "";

    // Try to parse as JSON
    try {
      // Remove any markdown code block markers if present
      const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const report = JSON.parse(cleanContent);
      return res.json(report);
    } catch (parseErr) {
      console.error("Failed to parse report JSON:", parseErr);
      // Return the raw content as a single section
      return res.json({
        talent: content,
        genre: "See above",
        directionGo: "See above",
        directionAvoid: "See above",
        similar: "See above",
        strengths: "See above",
        weaknesses: "See above",
        exercises: "See above"
      });
    }
  } catch (e) {
    console.error("Voice report error:", e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

// SPA-ish fallback: open home
app.get("/", (_req, res) => {
  res.sendFile(path.join(rootDir, "index.html"));
});

const port = Number(process.env.PORT || 8787);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`MyVoice Studio server running on http://localhost:${port}`);
});


