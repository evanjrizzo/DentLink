export const EMAIL_AI_PROMPT_VERSION = "email-summary-v1";
export const DEFAULT_EMAIL_AI_MODEL = "gpt-4.1-mini";
export const DEFAULT_EMAIL_AI_MAX_INPUT_CHARS = 6000;
export const aiPackage = {
  name: "@dentlink/ai",
  responsibility: "Optional provider-neutral AI boundary"
} as const;

export type EmailAiCategory =
  "action_required" | "personal" | "work" | "receipt" | "newsletter" | "system" | "other";

export type EmailAiInput = {
  sender: string;
  subject: string;
  body: string;
  receivedAt: string;
  labels: string[];
};

export type EmailAiResult = {
  summary: string;
  importance: number;
  category: EmailAiCategory;
  requiresAction: boolean;
  suggestedAction: string;
  deadline: string | null;
  reason: string;
  outputTokens: number | null;
};

export type EmailAiClient = {
  summarizeEmail(input: EmailAiInput): Promise<EmailAiResult>;
};

export class EmailAiError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "EmailAiError";
  }
}

export function normalizeEmailBody(input: {
  plainText: string | null;
  html: string | null;
  maxChars?: number;
}): string {
  const source =
    input.plainText && input.plainText.trim().length > 0
      ? input.plainText
      : htmlToText(input.html ?? "");
  return trimEmailThread(source).slice(0, input.maxChars ?? DEFAULT_EMAIL_AI_MAX_INPUT_CHARS);
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
}

export function trimEmailThread(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    if (/^On .+ wrote:$/i.test(line.trim())) break;
    if (/^-{2,}\s*Original Message\s*-{2,}$/i.test(line.trim())) break;
    if (/^From:\s.+/i.test(line.trim()) && kept.length > 0) break;
    if (/^>\s?/.test(line)) continue;
    if (/^--\s*$/.test(line.trim())) break;
    kept.push(line);
  }
  return kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function emailContentHash(input: {
  subject: string;
  body: string;
  sender: string;
  promptVersion?: string;
  model: string;
}): Promise<string> {
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      subject: input.subject.trim(),
      body: input.body.trim(),
      sender: input.sender.trim().toLowerCase(),
      promptVersion: input.promptVersion ?? EMAIL_AI_PROMPT_VERSION,
      model: input.model
    })
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createOpenAIEmailAiClient(input: {
  apiKey: string;
  model?: string;
  fetch?: typeof fetch;
}): EmailAiClient {
  const model = input.model ?? DEFAULT_EMAIL_AI_MODEL;
  const fetchImpl = input.fetch ?? fetch;
  return {
    async summarizeEmail(email): Promise<EmailAiResult> {
      const response = await fetchImpl("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          input: [
            {
              role: "system",
              content:
                "Summarize and classify one email for a personal notification dashboard. Return only valid JSON matching the schema. Importance is an integer from 0 through 100, where 100 means show immediately and 0 means likely noise."
            },
            {
              role: "user",
              content: JSON.stringify({
                sender: email.sender,
                subject: email.subject,
                receivedAt: email.receivedAt,
                labels: email.labels,
                body: email.body
              })
            }
          ],
          text: {
            format: {
              type: "json_schema",
              name: "email_notification_summary",
              strict: true,
              schema: {
                type: "object",
                additionalProperties: false,
                required: [
                  "summary",
                  "importance",
                  "category",
                  "requiresAction",
                  "suggestedAction",
                  "deadline",
                  "reason"
                ],
                properties: {
                  summary: { type: "string", maxLength: 600 },
                  importance: { type: "integer", minimum: 0, maximum: 100 },
                  category: {
                    type: "string",
                    enum: [
                      "action_required",
                      "personal",
                      "work",
                      "receipt",
                      "newsletter",
                      "system",
                      "other"
                    ]
                  },
                  requiresAction: { type: "boolean" },
                  suggestedAction: { type: "string", maxLength: 80 },
                  deadline: { anyOf: [{ type: "string" }, { type: "null" }] },
                  reason: { type: "string", maxLength: 300 }
                }
              }
            }
          }
        })
      });
      if (!response.ok) {
        throw new EmailAiError(
          response.status === 429 ? "ai_rate_limited" : "ai_upstream_failed",
          response.status === 429
            ? "OpenAI rate limited the email summary request."
            : "OpenAI could not summarize the email."
        );
      }
      const json = (await response.json()) as OpenAIResponsesShape;
      const text = extractResponseText(json);
      const parsed = parseEmailAiOutput(text);
      return { ...parsed, outputTokens: json.usage?.output_tokens ?? null };
    }
  };
}

type OpenAIResponsesShape = {
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  usage?: { output_tokens?: number };
};

function extractResponseText(json: OpenAIResponsesShape): string {
  if (typeof json.output_text === "string") return json.output_text;
  for (const output of json.output ?? []) {
    for (const content of output.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  throw new EmailAiError("ai_response_invalid", "OpenAI returned an invalid email summary.");
}

export function parseEmailAiOutput(text: string): Omit<EmailAiResult, "outputTokens"> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new EmailAiError("ai_response_invalid", "OpenAI returned invalid JSON.");
  }
  if (!value || typeof value !== "object") {
    throw new EmailAiError("ai_response_invalid", "OpenAI returned invalid JSON.");
  }
  const object = value as Record<string, unknown>;
  const category = object.category;
  if (
    typeof object.summary !== "string" ||
    typeof object.importance !== "number" ||
    !Number.isInteger(object.importance) ||
    object.importance < 0 ||
    object.importance > 100 ||
    !isEmailAiCategory(category) ||
    typeof object.requiresAction !== "boolean" ||
    typeof object.suggestedAction !== "string" ||
    !(typeof object.deadline === "string" || object.deadline === null) ||
    typeof object.reason !== "string"
  ) {
    throw new EmailAiError("ai_response_invalid", "OpenAI returned an invalid email summary.");
  }
  return {
    summary: object.summary.slice(0, 600),
    importance: object.importance,
    category,
    requiresAction: object.requiresAction,
    suggestedAction: object.suggestedAction.slice(0, 80),
    deadline: object.deadline,
    reason: object.reason.slice(0, 300)
  };
}

function isEmailAiCategory(value: unknown): value is EmailAiCategory {
  return (
    value === "action_required" ||
    value === "personal" ||
    value === "work" ||
    value === "receipt" ||
    value === "newsletter" ||
    value === "system" ||
    value === "other"
  );
}
