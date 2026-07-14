import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const apiBaseUrl =
  process.env.DENTLINK_PREVIEW_API_URL ?? "https://dentlink-api-preview.evanjrizzo.workers.dev";
const webOrigin = process.env.DENTLINK_PREVIEW_WEB_URL ?? "https://dentlink-web-preview.pages.dev";

test.describe("Milestone 2.1 preview browser verification", () => {
  test("verifies auth, notes, notifications, and webhook lifecycle", async ({
    page,
    context,
    request
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: webOrigin });

    const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const email = `browser-${runId}@example.invalid`;
    const password = `browser-password-${runId}`;
    const leakedConsole: string[] = [];
    page.on("console", (message) => {
      const text = message.text();
      if (text.includes(password) || /webhook_[A-Za-z0-9_-]+|session_[A-Za-z0-9_-]+/.test(text)) {
        leakedConsole.push(text);
      }
    });

    await page.goto("/");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Register" }).click();
    await expect(page.getByText(email)).toBeVisible();

    await page.reload();
    await expect(page.getByText(email)).toBeVisible();
    const sessionStorage = await dentlinkStorage(page);
    expect(sessionStorage).toContain("session_");
    expect(sessionStorage).not.toContain(password);
    expect(sessionStorage).not.toMatch(/hash|salt|webhook_/i);

    await page.getByRole("button", { name: "Notes" }).click();
    const folderName = `Folder ${runId}`;
    const tagName = `Tag ${runId}`;
    const firstNote = `Task ${runId}`;
    const secondNote = `Reference ${runId}`;
    await page.getByLabel("New folder name").fill(folderName);
    await page.getByRole("button", { name: "Add" }).first().click();
    await expect(page.getByRole("button", { name: folderName })).toBeVisible();
    await page.getByLabel("New tag name").fill(tagName);
    await page.getByRole("button", { name: "Add" }).nth(1).click();
    await expect(page.getByText(tagName)).toBeVisible();

    await page.getByLabel("New note title").fill(firstNote);
    await page.getByRole("button", { name: "Add" }).nth(2).click();
    await expect(noteCard(page, firstNote)).toBeVisible();
    await page.getByLabel("New note title").fill(secondNote);
    await page.locator(".note-composer select").first().selectOption("reference");
    await page.getByRole("button", { name: "Add" }).nth(2).click();
    await expect(noteCard(page, secondNote)).toBeVisible();

    await noteCard(page, firstNote).getByLabel("Pin note").click();
    await settleMutation(page);
    await noteCard(page, firstNote).getByLabel(`Mark ${firstNote} done`).check();
    await settleMutation(page);
    await noteCard(page, firstNote).getByLabel(`Priority for ${firstNote}`).selectOption("high");
    await settleMutation(page);
    await noteCard(page, firstNote)
      .getByLabel(`Folder for ${firstNote}`)
      .selectOption({ label: folderName });
    await settleMutation(page);
    await noteCard(page, firstNote).getByLabel(`Due date for ${firstNote}`).fill("2026-08-15");
    await settleMutation(page);
    await noteCard(page, firstNote).getByLabel(`${tagName} tag for ${firstNote}`).check();
    await settleMutation(page);
    await page.getByLabel("Search").fill(firstNote);
    await expect(noteCard(page, firstNote)).toBeVisible();
    await expect(noteCard(page, secondNote)).toHaveCount(0);
    await page.getByLabel("Search").fill("");

    await makeNoteConflict(page, firstNote, "Server-side conflict title");
    await noteCard(page, firstNote).locator(".note-title").fill(`Stale ${runId}`);
    await expect(page.getByRole("alert")).toContainText("changed on the server");
    await resolveOpenConflict(page);

    await page.getByRole("button", { name: "Notifications" }).click();
    const firstNotification = `Alpha alert ${runId}`;
    const secondNotification = `Bravo alert ${runId}`;
    await createNotification(page, firstNotification, "medium");
    await createNotification(page, secondNotification, "high");
    await expect(notificationCard(page, firstNotification)).toBeVisible();
    await expect(page.getByRole("button", { name: "Dismiss" })).toHaveCount(0);
    await notificationCard(page, firstNotification).getByRole("button", { name: "Pin" }).click();
    await notificationCard(page, firstNotification).getByRole("button", { name: "Done" }).click();
    await page.getByRole("button", { name: "Ranking Mode" }).click();
    await notificationCard(page, secondNotification)
      .getByRole("button", { name: "Dismiss" })
      .click();
    await notificationCard(page, firstNotification).getByRole("button", { name: "Down" }).click();
    await page.reload();
    await expect(page.getByText(email)).toBeVisible();
    await page.getByRole("button", { name: "Notifications" }).click();
    await expect(notificationCard(page, firstNotification)).toBeVisible();
    await notificationCard(page, firstNotification).getByRole("button", { name: "Delete" }).click();
    await expect(notificationCard(page, firstNotification)).toHaveCount(0);

    await page.getByRole("button", { name: "Webhooks" }).click();
    const notificationSlug = `browser-notification-${runId}`.replaceAll(".", "-");
    const noteSlug = `browser-note-${runId}`.replaceAll(".", "-");
    const notificationWebhookSecret = await createWebhook(page, {
      name: `Browser notification ${runId}`,
      slug: notificationSlug,
      destination: "notification"
    });
    await page.getByRole("button", { name: "Copy secret" }).click();
    await expect(page.getByText("Secret copied")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      notificationWebhookSecret
    );

    await page.reload();
    await expect(page.getByText(email)).toBeVisible();
    await page.getByRole("button", { name: "Webhooks" }).click();
    await expect(page.getByText(notificationWebhookSecret)).toHaveCount(0);

    const notificationWebhook = webhookCard(page, notificationSlug);
    await notificationWebhook.getByRole("button", { name: "Disable" }).click();
    await expect(notificationWebhook.getByText("Disabled")).toBeVisible();
    await expect(
      deliverWebhook(request, notificationSlug, notificationWebhookSecret, {
        title: `Disabled delivery ${runId}`
      })
    ).resolves.toBe(404);
    await notificationWebhook.getByRole("button", { name: "Enable" }).click();
    await expect(notificationWebhook.getByText("Enabled")).toBeVisible();
    await expect(
      deliverWebhook(request, notificationSlug, "", { title: `Missing secret ${runId}` })
    ).resolves.toBe(401);
    await expect(
      deliverWebhook(request, notificationSlug, "wrong-secret", { title: `Wrong secret ${runId}` })
    ).resolves.toBe(404);

    const webhookNotification = `Webhook browser notification ${runId}`;
    await expect(
      deliverWebhook(request, notificationSlug, notificationWebhookSecret, {
        title: webhookNotification,
        summary: "From browser test"
      })
    ).resolves.toBe(202);
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(notificationWebhook.getByText(/Last triggered: (?!Never)/)).toBeVisible();
    await page.getByRole("button", { name: "Notifications" }).click();
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(notificationCard(page, webhookNotification)).toBeVisible();

    await page.getByRole("button", { name: "Webhooks" }).click();
    await notificationWebhook.getByRole("button", { name: "Delete" }).click();
    await expect(webhookCard(page, notificationSlug)).toHaveCount(0);
    await expect(
      deliverWebhook(request, notificationSlug, notificationWebhookSecret, {
        title: `Deleted delivery ${runId}`
      })
    ).resolves.toBe(404);

    const noteWebhookSecret = await createWebhook(page, {
      name: `Browser note ${runId}`,
      slug: noteSlug,
      destination: "note"
    });
    const webhookNote = `Webhook browser note ${runId}`;
    await expect(
      deliverWebhook(request, noteSlug, noteWebhookSecret, {
        title: webhookNote,
        body: "Created from webhook",
        kind: "task"
      })
    ).resolves.toBe(202);
    await page.reload();
    await expect(page.getByText(email)).toBeVisible();
    await page.getByRole("button", { name: "Notes" }).click();
    await expect(noteCard(page, webhookNote)).toBeVisible();

    await page.getByRole("button", { name: "Connectors" }).click();
    await expect(page.getByRole("button", { name: "Connect Gmail" })).toBeVisible();
    await expect(page.getByText("No Gmail accounts connected.")).toBeVisible();
    await page.getByRole("button", { name: "Connect Gmail" }).click();
    await expect(page.getByRole("alert")).toContainText(/GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET/);

    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page.getByRole("button", { name: "Register" })).toBeVisible();
    await page.evaluate(() => {
      window.localStorage.setItem(
        "dentlink.auth.session.v1",
        JSON.stringify({
          user: {
            id: "user_fake",
            email: "fake@example.invalid",
            createdAt: new Date().toISOString()
          },
          session: { token: "session_fake", expiresAt: new Date(Date.now() + 1000).toISOString() }
        })
      );
    });
    await page.reload();
    await expect(page.getByRole("button", { name: "Register" })).toBeVisible();

    expect(leakedConsole).toEqual([]);
  });
});

function noteCard(page: Page, title: string) {
  return page.getByRole("article", { name: `Note ${title}` });
}

function notificationCard(page: Page, title: string) {
  return page.locator(".notification-card").filter({ hasText: title });
}

function webhookCard(page: Page, slug: string) {
  return page.locator(".notification-card").filter({ hasText: `/v1/ingest/webhooks/${slug}` });
}

async function createNotification(page: Page, title: string, severity: string): Promise<void> {
  await page.getByLabel("New notification title").fill(title);
  await page.getByLabel("New notification summary").fill(`Summary for ${title}`);
  await page.getByLabel("New notification severity").selectOption(severity);
  await page.getByRole("button", { name: "Add" }).click();
}

async function createWebhook(
  page: Page,
  input: { name: string; slug: string; destination: "notification" | "note" }
): Promise<string> {
  await page.getByLabel("Webhook name").fill(input.name);
  await page.getByLabel("Webhook slug").fill(input.slug);
  await page.locator(".webhooks-shell select").selectOption(input.destination);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText("Webhook secret shown once")).toBeVisible();
  const secretText = await page.locator(".app-error code").last().innerText();
  expect(secretText).toMatch(/^webhook_/);
  return secretText;
}

async function deliverWebhook(
  request: APIRequestContext,
  slug: string,
  secret: string,
  body: unknown
): Promise<number> {
  const headers: Record<string, string> = {};
  if (secret) headers["X-DentLink-Webhook-Secret"] = secret;
  const response = await request.post(`${apiBaseUrl}/v1/ingest/webhooks/${slug}`, {
    headers,
    data: body
  });
  return response.status();
}

async function makeNoteConflict(page: Page, title: string, nextTitle: string): Promise<void> {
  const session = JSON.parse(await dentlinkStorage(page)) as { session: { token: string } };
  const notesResponse = await fetch(`${apiBaseUrl}/v1/notes?search=${encodeURIComponent(title)}`, {
    headers: { Authorization: `Bearer ${session.session.token}` }
  });
  const notes = (await notesResponse.json()) as { notes: Array<{ id: string; version: number }> };
  const note = notes.notes[0];
  expect(note).toBeTruthy();
  await fetch(`${apiBaseUrl}/v1/notes/${note.id}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${session.session.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ expectedVersion: note.version, patch: { title: nextTitle } })
  });
}

async function resolveOpenConflict(page: Page): Promise<void> {
  const session = JSON.parse(await dentlinkStorage(page)) as { session: { token: string } };
  const conflictsResponse = await fetch(`${apiBaseUrl}/v1/conflicts`, {
    headers: { Authorization: `Bearer ${session.session.token}` }
  });
  const conflicts = (await conflictsResponse.json()) as Array<{
    conflict: { id: string; version: number };
  }>;
  const conflict = conflicts[0]?.conflict;
  expect(conflict).toBeTruthy();
  await fetch(`${apiBaseUrl}/v1/conflicts/${conflict.id}/resolve`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.session.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ expectedVersion: conflict.version, resolution: "keep_theirs" })
  });
}

async function dentlinkStorage(page: Page): Promise<string> {
  return page.evaluate(() => window.localStorage.getItem("dentlink.auth.session.v1") ?? "");
}

async function settleMutation(page: Page): Promise<void> {
  await page.waitForTimeout(500);
  await expect(page.getByRole("alert")).toHaveCount(0);
}
