import { describe, expect, it } from "vitest";

import {
  aiPackage,
  normalizeAssistantAnswer,
  normalizeEmailBody,
  parseAssistantAiOutput,
  parseEmailAiOutput,
  trimEmailThread
} from "./index";

describe("@dentlink/ai", () => {
  it("declares the AI package boundary", () => {
    expect(aiPackage.name).toBe("@dentlink/ai");
  });

  it("normalizes plain text before HTML and trims signatures and quoted threads", () => {
    expect(
      normalizeEmailBody({
        plainText: "Please review this.\n-- \nSignature\nOn Tue, Someone wrote:\nold text",
        html: "<p>Ignored</p>"
      })
    ).toBe("Please review this.");
  });

  it("falls back to cleaned HTML text and caps body length", () => {
    const text = normalizeEmailBody({
      plainText: null,
      html: "<style>bad</style><p>Hello&nbsp;<strong>there</strong></p><script>x()</script>",
      maxChars: 5
    });
    expect(text).toBe("Hello");
  });

  it("removes quoted prior-thread lines", () => {
    expect(trimEmailThread("New answer\n> quoted\nFrom: old@example.test")).toBe("New answer");
  });

  it("validates structured AI output strictly", () => {
    expect(
      parseEmailAiOutput(
        JSON.stringify({
          summary: "Short summary",
          importance: 80,
          category: "action_required",
          requiresAction: true,
          suggestedAction: "Reply",
          deadline: null,
          reason: "Sender asked for a response."
        })
      )
    ).toMatchObject({ category: "action_required", requiresAction: true });
    expect(() => parseEmailAiOutput(JSON.stringify({ summary: "missing fields" }))).toThrow(
      /invalid/i
    );
  });

  it("puts inline assistant numbered lists on separate lines", () => {
    expect(
      normalizeAssistantAnswer(
        "To use DentLink: 1) Open Home. 2) Check Notifications. 3) Use Notes."
      )
    ).toBe("To use DentLink:\n1) Open Home.\n2) Check Notifications.\n3) Use Notes.");
  });

  it("puts inline assistant bullet lists on separate lines", () => {
    expect(normalizeAssistantAnswer("Try these: - Home - Notifications - Calendar")).toBe(
      "Try these:\n- Home\n- Notifications\n- Calendar"
    );
  });

  it("normalizes assistant output after parsing structured JSON", () => {
    expect(
      parseAssistantAiOutput(
        JSON.stringify({
          answer: "Use DentLink: 1) Home. 2) Notifications.",
          sourceIds: ["source_1"]
        })
      )
    ).toEqual({
      answer: "Use DentLink:\n1) Home.\n2) Notifications.",
      sourceIds: ["source_1"]
    });
  });
});
