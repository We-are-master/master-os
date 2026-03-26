import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { isOpenAIConfigured } from "@/lib/openai-client";

type Body = {
  jobReference?: string;
  fileUrl?: string;
  mimeType?: string;
  notes?: string;
};

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  if (!isOpenAIConfigured()) {
    return NextResponse.json({ error: "OpenAI is not configured." }, { status: 503 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const fileUrl = (body.fileUrl ?? "").trim();
  const mimeType = (body.mimeType ?? "").trim().toLowerCase();
  const notes = (body.notes ?? "").trim().slice(0, 2000); // cap operator notes
  const jobReference = (body.jobReference ?? "").trim().slice(0, 100) || "job";

  if (!fileUrl) return NextResponse.json({ error: "fileUrl is required." }, { status: 400 });

  // Only allow files hosted on our own Supabase storage to prevent SSRF and
  // to avoid sending arbitrary external URLs to the OpenAI vision API.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const allowedPrefixes = [
    supabaseUrl ? `${supabaseUrl}/storage/v1/object/` : null,
    supabaseUrl ? `${supabaseUrl}/storage/v1/render/` : null,
  ].filter(Boolean) as string[];

  const urlIsAllowed =
    allowedPrefixes.length > 0 &&
    allowedPrefixes.some((prefix) => fileUrl.startsWith(prefix));

  if (!urlIsAllowed) {
    return NextResponse.json(
      { error: "fileUrl must point to a file stored in this application's storage bucket." },
      { status: 400 },
    );
  }

  const isImage = mimeType.startsWith("image/");
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return NextResponse.json({ error: "OPENAI_API_KEY is missing." }, { status: 503 });
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";

  const system = [
    "You are an operations QA assistant for field-service job reports.",
    "Return concise JSON only with keys:",
    "summary, issues, risks, next_actions, confidence.",
    "Where possible identify completion evidence, quality concerns, safety concerns, and missing information.",
    "Keep each list short and practical for ops.",
  ].join(" ");

  const userText = [
    `Job reference: ${jobReference}.`,
    `Report file URL: ${fileUrl}`,
    `Report mime type: ${mimeType || "unknown"}.`,
    notes ? `Operator notes: ${notes}` : "No additional operator notes.",
  ].join("\n");

  const messages = isImage
    ? [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            { type: "text", text: userText },
            { type: "image_url", image_url: { url: fileUrl } },
          ],
        },
      ]
    : [
        { role: "system", content: system },
        {
          role: "user",
          content: `${userText}\n\nThis is a non-image file. Analyse using notes/metadata and clearly mention limitations.`,
        },
      ];

  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.25,
      max_tokens: 900,
      response_format: { type: "json_object" },
    }),
  });

  const json = (await res.json()) as {
    error?: { message?: string };
    choices?: { message?: { content?: string } }[];
  };
  if (!res.ok) {
    return NextResponse.json({ error: json.error?.message || `OpenAI HTTP ${res.status}` }, { status: 502 });
  }

  const content = json.choices?.[0]?.message?.content?.trim();
  if (!content) return NextResponse.json({ error: "Empty AI response." }, { status: 502 });

  return NextResponse.json({ analysis: content });
}
