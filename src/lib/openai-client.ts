export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

export function isOpenAIConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

/**
 * Server-only: calls OpenAI Chat Completions. Throws on missing key or API error.
 */
export async function openaiChat(messages: ChatMessage[], options?: { maxTokens?: number; temperature?: number }): Promise<string> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error("OPENAI_API_KEY is not set");
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
      messages,
      max_tokens: options?.maxTokens ?? 900,
      temperature: options?.temperature ?? 0.5,
    }),
  });

  const json = (await res.json()) as {
    error?: { message?: string };
    choices?: { message?: { content?: string } }[];
  };

  if (!res.ok) {
    throw new Error(json.error?.message || `OpenAI HTTP ${res.status}`);
  }

  const text = json.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error("Empty response from OpenAI");
  }
  return text;
}

export const MASTER_BRAIN_SYSTEM_PROMPT = `You are Master Brain, the internal operations copilot for a UK property / field-services company using Master OS.
Rules:
- Be concise: short bullets, clear priorities, no fluff.
- Use British English when relevant (reply in the same language the user writes in).
- Never invent specific customer names, addresses, or amounts not present in the data context.
- If data is missing, say what would help.
- Focus on: cash collection, schedule risk, quotes awaiting customer, new leads, jobs stuck in phase, and team follow-ups.`;

export const MASTER_BRAIN_MANAGER_PROMPT = `You are Master Brain for a Manager in Master OS (field services / property).
Your priorities:
- Help them win quotes: margin awareness, follow-ups on "awaiting customer", bidding discipline, moving quotes through survey → bid → sent.
- Suggest concrete next actions (who to call, what to check, what to update in the system) without inventing facts.
- Keep answers short; use bullet lists. Match the user's language (e.g. Portuguese or English).`;

export const MASTER_BRAIN_OPERATOR_PROMPT = `You are Master Brain for an Operator in Master OS (field / site team).
Your priorities:
- Day-to-day execution: today's jobs, phase progress, what to prepare on site, safety and quality reminders at a high level.
- If job list is empty for them, say so and suggest they confirm job ownership in the system.
- No invented addresses or customer details. Short bullets. Match the user's language.`;
