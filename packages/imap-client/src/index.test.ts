import { describe, expect, it } from "vitest";

import { gmailSourceExternalId, mimeFetchCommand } from "./gmail";
import { parseMime } from "./mime";
import { searchUids, selectedExistsCount } from "./protocol";
import { recentSinceDate, uidSearchCommand } from "./search";
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

  it("decodes MIME headers and quoted-printable text as UTF-8", () => {
    const parsed = parseMime(
      [
        "Subject: =?UTF-8?Q?Pok=C3=A9mon_=E2=9C=A8?=",
        "From: =?UTF-8?B?Sm9zw6kg8J+YgA==?= <jose@example.test>",
        "To: Receiver <receiver@example.test>",
        "Content-Type: text/plain; charset=UTF-8",
        "Content-Transfer-Encoding: quoted-printable",
        "",
        "Pok=C3=A9mon, caf=C3=A9, =E4=BD=A0=E5=A5=BD, =D7=A9=D7=9C=D7=95=D7=9D, emoji =F0=9F=9A=80"
      ].join("\r\n")
    );
    expect(parsed.subject).toBe("Pokémon ✨");
    expect(parsed.from).toContain("José 😀");
    expect(parsed.plainText).toBe("Pokémon, café, 你好, שלום, emoji 🚀");
  });

  it("decodes ISO-8859-1 encoded words without double-decoding UTF-8", () => {
    const parsed = parseMime(
      [
        "Subject: =?ISO-8859-1?Q?Caf=E9?=",
        "From: Pokémon <poke@example.test>",
        "Content-Type: text/plain; charset=ISO-8859-1",
        "Content-Transfer-Encoding: quoted-printable",
        "",
        "Caf=E9"
      ].join("\r\n")
    );
    expect(parsed.subject).toBe("Café");
    expect(parsed.from).toBe("Pokémon <poke@example.test>");
    expect(parsed.plainText).toBe("Café");
  });

  it("builds rolling IMAP since dates", () => {
    expect(recentSinceDate("2026-07-14T12:00:00.000Z", 1)).toBe("13-Jul-2026");
  });

  it("bounds IMAP MIME body fetches", () => {
    expect(mimeFetchCommand("42")).toContain("BODY.PEEK[]<0.65536>");
  });

  it("builds UID range searches when a prior UID is known", () => {
    expect(uidSearchCommand("13-Jul-2026", "11")).toBe("UID SEARCH UID 12:*");
    expect(uidSearchCommand("13-Jul-2026", null)).toBe("UID SEARCH SINCE 13-Jul-2026");
    expect(uidSearchCommand("13-Jul-2026", "not-a-uid")).toBe("UID SEARCH SINCE 13-Jul-2026");
  });
});
