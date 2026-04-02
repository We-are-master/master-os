import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { isOpenAIConfigured } from "@/lib/openai-client";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MAX_BYTES = 4 * 1024 * 1024;

const SYSTEM = [
  "You read UK compliance documents: insurance certificates, licences, ID cards, proof of address, certifications.",
  "Find the single most relevant expiry / valid-until / renewal / end-of-cover date.",
  "Return JSON only, no markdown, shape:",
  '{"expiry_date":"YYYY-MM-DD"|null,"confidence":"high"|"medium"|"low"}',
  "Use null if no clear expiry is visible. Prefer the latest policy/certificate end date if several appear.",
].join(" ");

function parseJsonObject(text: string): { expiry_date?: string | null; confidence?: string } {
  const t = text.trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) return {};
  try {
    return JSON.parse(t.slice(start, end + 1)) as { expiry_date?: string | null; confidence?: string };
  } catch {
    return {};
  }
}

function normalizeIsoDate(s: string | null | undefined): string | null {
  if (!s || typeof s !== "string") return null;
  const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/**
 * POST multipart/form-data with field `file` (image/jpeg, png, webp, gif).
 * Returns { expiry_date: "YYYY-MM-DD" | null, confidence?: string }.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  if (!isOpenAIConfigured()) {
    return NextResponse.json(
      { error: "OpenAI is not configured.", expiry_date: null },
      { status: 503 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  const mime = (file.type || "").toLowerCase();
  if (!mime.startsWith("image/")) {
    return NextResponse.json(
      { error: "Only image files are supported for AI detection (use a photo or screenshot).", expiry_date: null },
      { status: 400 },
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length > MAX_BYTES) {
    return NextResponse.json({ error: "Image too large (max 4 MB).", expiry_date: null }, { status: 400 });
  }

  const b64 = buf.toString("base64");
  const dataUrl = `data:${mime || "image/jpeg"};base64,${b64}`;

  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    return NextResponse.json({ error: "OPENAI_API_KEY is missing.", expiry_date: null }, { status: 503 });
  }

  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";

  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 300,
      temperature: 0.2,
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Extract the expiry or valid-until date from this document image. Return only the JSON object.",
            },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
  });

  const json = (await res.json()) as {
    error?: { message?: string };
    choices?: { message?: { content?: string } }[];
  };

  if (!res.ok) {
    return NextResponse.json(
      { error: json.error?.message || `OpenAI HTTP ${res.status}`, expiry_date: null },
      { status: 502 },
    );
  }

  const raw = json.choices?.[0]?.message?.content?.trim() ?? "";
  const parsed = parseJsonObject(raw);
  const expiry_date = normalizeIsoDate(parsed.expiry_date ?? null);

  return NextResponse.json({
    expiry_date,
    confidence: parsed.confidence ?? "low",
    raw_note: raw.length > 200 ? raw.slice(0, 200) + "…" : raw,
  });
}
