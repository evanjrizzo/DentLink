import { describe, expect, it } from "vitest";

import { aiPackage, normalizeEmailBody, parseEmailAiOutput, trimEmailThread } from "./index";

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
});
