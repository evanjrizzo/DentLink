import { describe, expect, it } from "vitest";

import { gmailSourceExternalId } from "./gmail";
import { parseMime } from "./mime";
import { searchUids, selectedExistsCount } from "./protocol";
import { recentSinceDate } from "./search";
import { xoauth2InitialResponse } from "./xoauth2";

describe("@dentlink/imap-client", () => {
  it("formats XOAUTH2 initial responses", () => {
    expect(atob(xoauth2InitialResponse("user@example.test", "token"))).toBe(
      "user=user@example.test\x01auth=Bearer token\x01\x01"
    );
  });

  it("parses search and select responses", () => {
    expect(selectedExistsCount("* 42 EXISTS\r\nD0001 OK SELECT completed")).toBe(42);
    expect(searchUids("* SEARCH 10 11 12\r\nD0002 OK SEARCH completed")).toEqual([
      "10",
      "11",
      "12"
    ]);
  });

  it("prefers stable Gmail identity values", () => {
    expect(
      gmailSourceExternalId({
        xGmMsgId: "gm-1",
        messageId: "<message@example.test>",
        uid: "10",
        uidValidity: "999",
        internalDate: "date"
      })
    ).toBe("x-gm-msgid:gm-1");
    expect(
      gmailSourceExternalId({
        xGmMsgId: null,
        messageId: "<message@example.test>",
        uid: "10",
        uidValidity: "999",
        internalDate: "date"
      })
    ).toBe("message-id:<message@example.test>");
  });

  it("parses simple MIME messages", () => {
    const parsed = parseMime(
      [
        "Subject: Hello",
        "From: Sender <sender@example.test>",
        "To: Receiver <receiver@example.test>",
        "Message-ID: <id@example.test>",
        "Content-Type: text/plain",
        "",
        "Body text"
      ].join("\r\n")
    );
    expect(parsed.subject).toBe("Hello");
    expect(parsed.messageId).toBe("<id@example.test>");
    expect(parsed.plainText).toBe("Body text");
  });

  it("builds rolling IMAP since dates", () => {
    expect(recentSinceDate("2026-07-14T12:00:00.000Z", 1)).toBe("13-Jul-2026");
  });
});
