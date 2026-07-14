import { expect, test, type APIRequestContext, type Page, type Route } from "@playwright/test";

const apiBaseUrl = process.env.DENTLINK_PREVIEW_API_URL ?? "http://127.0.0.1:5173";
const webOrigin = process.env.DENTLINK_PREVIEW_WEB_URL ?? "http://127.0.0.1:5173";

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
    await expect(page.getByRole("button", { name: "Connect Google Calendar" })).toBeVisible();
    await expect(page.getByText("No Gmail accounts connected.")).toBeVisible();
    await expect(page.getByText("No Google Calendar accounts connected.")).toBeVisible();

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

  test("refreshes Gmail notifications after Sync Now without reloading", async ({ page }) => {
    const now = new Date().toISOString();
    const user = {
      id: "user_browser_gmail_refresh",
      email: "gmail-refresh@example.invalid",
      createdAt: now
    };
    const session = {
      user,
      session: {
        token: "session_browser_gmail_refresh",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
      }
    };
    const gmailAccount = {
      id: "connector_gmail_browser_refresh",
      userId: user.id,
      connectorKey: "gmail",
      displayName: "Gmail gmail-refresh@example.invalid",
      status: "connected",
      healthStatus: "healthy",
      syncStatus: "idle",
      settings: { googleEmail: "gmail-refresh@example.invalid" },
      credentialRef: "credential_browser_refresh",
      credentialStatus: "configured",
      syncCursor: "history_100",
      lastSyncAt: null as string | null,
      nextSyncAt: null,
      lastHealthAt: now,
      errorCode: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
      version: 1
    };
    let notifications: unknown[] = [];

    await page.route("**/v1/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      const method = request.method();
      if (method === "OPTIONS") {
        await route.fulfill({ status: 204, headers: corsHeaders() });
        return;
      }
      if (method === "GET" && path === "/v1/auth/session") {
        await fulfillJson(route, { user, session: { expiresAt: session.session.expiresAt } });
        return;
      }
      if (method === "GET" && path === "/v1/notes") {
        await fulfillJson(route, { notes: [], folders: [], tags: [] });
        return;
      }
      if (method === "GET" && path === "/v1/notifications") {
        await fulfillJson(route, { notifications });
        return;
      }
      if (method === "GET" && path === "/v1/calendar/events") {
        await fulfillJson(route, { events: [] });
        return;
      }
      if (method === "GET" && path === "/v1/webhooks") {
        await fulfillJson(route, { webhooks: [] });
        return;
      }
      if (method === "GET" && path === "/v1/connectors/accounts") {
        await fulfillJson(route, { accounts: [gmailAccount] });
        return;
      }
      if (method === "POST" && path === `/v1/connectors/gmail/${gmailAccount.id}/sync`) {
        const syncedAt = new Date().toISOString();
        gmailAccount.lastSyncAt = syncedAt;
        gmailAccount.lastHealthAt = syncedAt;
        gmailAccount.syncCursor = "history_101";
        gmailAccount.updatedAt = syncedAt;
        gmailAccount.version += 1;
        notifications = [
          notificationFixture({
            id: "notification_gmail_synced",
            title: "Gmail synced message",
            summary: "From browser-controlled Gmail sync",
            createdAt: syncedAt,
            updatedAt: syncedAt
          })
        ];
        await fulfillJson(route, {
          account: gmailAccount,
          processed: 1,
          createdNotifications: 1
        });
        return;
      }
      await route.fulfill({
        status: 404,
        headers: corsHeaders(),
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "not_found", message: "Not found" } })
      });
    });

    await page.addInitScript((storedSession) => {
      window.localStorage.setItem("dentlink.auth.session.v1", JSON.stringify(storedSession));
    }, session);

    await page.goto("/");
    await expect(page.getByText(user.email)).toBeVisible();
    await page.getByRole("button", { name: "Connectors" }).click();
    await expect(page.getByText(gmailAccount.displayName)).toBeVisible();
    await expect(page.getByText("Last sync: Never")).toBeVisible();

    await page.getByRole("button", { name: "Sync Now" }).click();
    await expect(notificationCard(page, "Gmail synced message")).toBeVisible();
    await page.getByRole("button", { name: "Connectors" }).click();
    await expect(page.getByText("Last sync: Never")).toHaveCount(0);

    notifications = [
      ...notifications,
      notificationFixture({
        id: "notification_gmail_refresh",
        title: "Gmail refresh message",
        summary: "Loaded by the normal Refresh control"
      })
    ];
    await page.getByRole("button", { name: "Notifications" }).click();
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(notificationCard(page, "Gmail refresh message")).toBeVisible();
  });

  test("renders Google Calendar events after Sync Now without reloading", async ({ page }) => {
    const now = new Date().toISOString();
    const user = {
      id: "user_browser_calendar_refresh",
      email: "calendar-refresh@example.invalid",
      createdAt: now
    };
    const session = {
      user,
      session: {
        token: "session_browser_calendar_refresh",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
      }
    };
    const calendarAccount = {
      id: "connector_calendar_browser_refresh",
      userId: user.id,
      connectorKey: "google-calendar",
      displayName: "Google Calendar Primary calendar",
      status: "connected",
      healthStatus: "healthy",
      syncStatus: "idle",
      settings: { googleCalendarId: "primary", googleCalendarSummary: "Primary calendar" },
      credentialRef: "credential_calendar_refresh",
      credentialStatus: "configured",
      syncCursor: "calendar-sync-100",
      lastSyncAt: null as string | null,
      nextSyncAt: null,
      lastHealthAt: now,
      errorCode: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
      version: 1
    };
    let events: unknown[] = [];

    await page.route("**/v1/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      const method = request.method();
      if (method === "OPTIONS") {
        await route.fulfill({ status: 204, headers: corsHeaders() });
        return;
      }
      if (method === "GET" && path === "/v1/auth/session") {
        await fulfillJson(route, { user, session: { expiresAt: session.session.expiresAt } });
        return;
      }
      if (method === "GET" && path === "/v1/notes") {
        await fulfillJson(route, { notes: [], folders: [], tags: [] });
        return;
      }
      if (method === "GET" && path === "/v1/notifications") {
        await fulfillJson(route, { notifications: [] });
        return;
      }
      if (method === "GET" && path === "/v1/calendar/events") {
        const source = url.searchParams.get("source");
        await fulfillJson(route, {
          events:
            source === "local" || source === "google-calendar"
              ? events.filter((event) => (event as { source?: string }).source === source)
              : events
        });
        return;
      }
      if (method === "GET" && path === "/v1/webhooks") {
        await fulfillJson(route, { webhooks: [] });
        return;
      }
      if (method === "GET" && path === "/v1/connectors/accounts") {
        await fulfillJson(route, { accounts: [calendarAccount] });
        return;
      }
      if (
        method === "POST" &&
        path === `/v1/connectors/google-calendar/${calendarAccount.id}/sync`
      ) {
        const syncedAt = new Date().toISOString();
        calendarAccount.lastSyncAt = syncedAt;
        calendarAccount.lastHealthAt = syncedAt;
        calendarAccount.syncCursor = "calendar-sync-101";
        calendarAccount.updatedAt = syncedAt;
        calendarAccount.version += 1;
        const existingById = new Map(
          events.map((event) => [(event as { id?: string }).id, event as { annotation?: unknown }])
        );
        const syncedEvents = [
          calendarEventFixture({
            id: "calendar_event_all_day",
            title: "Calendar all-day planning",
            allDay: true,
            startAt: "2026-07-15T00:00:00.000Z",
            endAt: "2026-07-16T00:00:00.000Z",
            startDate: "2026-07-15",
            endDate: "2026-07-16",
            version: 1
          }),
          calendarEventFixture({
            id: "calendar_event_timed",
            title: "Calendar timed consult",
            allDay: false,
            location: "Operatory 2",
            startAt: "2026-07-15T18:00:00.000Z",
            endAt: "2026-07-15T18:30:00.000Z",
            version: 1
          })
        ];
        events = [
          ...events.filter((event) => (event as { source?: string }).source === "local"),
          ...syncedEvents.map((event) => ({
            ...event,
            annotation: existingById.get(event.id)?.annotation ?? event.annotation
          }))
        ];
        await fulfillJson(route, {
          account: calendarAccount,
          processed: 2,
          upsertedEvents: 2
        });
        return;
      }
      if (method === "PATCH" && path === "/v1/calendar/events/calendar_event_timed") {
        events = events.filter(
          (event) =>
            !(
              typeof event === "object" &&
              event !== null &&
              "id" in event &&
              event.id === "calendar_event_timed"
            )
        );
        await fulfillJson(route, {
          ...calendarEventFixture({
            id: "calendar_event_timed",
            title: "Calendar timed consult",
            allDay: false,
            location: "Operatory 2",
            startAt: "2026-07-15T18:00:00.000Z",
            endAt: "2026-07-15T18:30:00.000Z",
            version: 2
          }),
          status: "dismissed",
          dismissedAt: new Date().toISOString()
        });
        return;
      }
      if (method === "POST" && path === "/v1/calendar/events") {
        const input = request.postDataJSON() as Record<string, unknown>;
        const event = calendarEventFixture({
          id: "calendar_event_local",
          title: String(input.title),
          allDay: Boolean(input.allDay),
          location: typeof input.location === "string" ? input.location : null,
          startAt: String(input.startAt),
          endAt: String(input.endAt),
          version: 1
        });
        const localEvent = {
          ...event,
          source: "local",
          provider: null,
          providerEventId: null,
          connectorAccountId: null,
          calendarSummary: "DentLink Local",
          recurrenceRule: input.recurrenceRule ?? null,
          category: input.category ?? null,
          color: input.color ?? null,
          reminderMinutes: input.reminderMinutes ?? null,
          importedUid: null,
          annotation: null
        };
        events = [...events, localEvent];
        await fulfillJson(route, localEvent, 201);
        return;
      }
      if (method === "PATCH" && path === "/v1/calendar/local-events/calendar_event_local") {
        events = events.map((event) =>
          typeof event === "object" &&
          event !== null &&
          "id" in event &&
          event.id === "calendar_event_local"
            ? { ...event, title: "Browser local event updated", version: 2 }
            : event
        );
        await fulfillJson(
          route,
          events.find((event) => (event as { id?: string }).id === "calendar_event_local")
        );
        return;
      }
      if (method === "DELETE" && path === "/v1/calendar/local-events/calendar_event_local") {
        const deleted = events.find(
          (event) => (event as { id?: string }).id === "calendar_event_local"
        );
        events = events.filter((event) => (event as { id?: string }).id !== "calendar_event_local");
        await fulfillJson(route, { ...(deleted as object), status: "deleted", version: 3 });
        return;
      }
      if (method === "PATCH" && path === "/v1/calendar/events/calendar_event_all_day/annotation") {
        events = events.map((event) =>
          (event as { id?: string }).id === "calendar_event_all_day"
            ? {
                ...(event as object),
                annotation: {
                  id: "annotation_calendar_all_day",
                  userId: user.id,
                  eventId: "calendar_event_all_day",
                  notes: "DentLink note",
                  pinned: true,
                  completed: false,
                  hidden: false,
                  tagIds: [],
                  tags: [],
                  version: 1,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString()
                }
              }
            : event
        );
        await fulfillJson(route, (events[0] as { annotation?: unknown }).annotation);
        return;
      }
      if (method === "POST" && path === "/v1/calendar/ics/import") {
        const imported = {
          ...calendarEventFixture({
            id: "calendar_event_ics",
            title: "ICS browser import",
            allDay: false,
            startAt: "2026-07-17T15:00:00.000Z",
            endAt: "2026-07-17T15:30:00.000Z",
            version: 1
          }),
          source: "local",
          provider: null,
          providerEventId: null,
          connectorAccountId: null,
          calendarSummary: "DentLink Local",
          recurrenceRule: "RRULE:FREQ=DAILY;COUNT=2",
          category: null,
          color: null,
          reminderMinutes: null,
          importedUid: "browser-ics",
          annotation: null
        };
        events = [...events, imported];
        await fulfillJson(
          route,
          { imported: 1, skippedDuplicates: 0, events: [imported], warnings: [] },
          201
        );
        return;
      }
      if (method === "GET" && path === "/v1/calendar/ics/export") {
        await route.fulfill({
          status: 200,
          headers: { ...corsHeaders(), "Content-Type": "text/calendar" },
          body: "BEGIN:VCALENDAR\r\nSUMMARY:Browser local event updated\r\nEND:VCALENDAR\r\n"
        });
        return;
      }
      await route.fulfill({
        status: 404,
        headers: corsHeaders(),
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "not_found", message: "Not found" } })
      });
    });

    await page.addInitScript((storedSession) => {
      window.localStorage.setItem("dentlink.auth.session.v1", JSON.stringify(storedSession));
    }, session);

    await page.goto("/");
    await expect(page.getByText(user.email)).toBeVisible();
    await page.getByRole("button", { name: "Agenda" }).click();
    await expect(page.getByText("No events in this range.")).toBeVisible();
    await expect(page.getByRole("textbox", { name: /^Title/ })).toBeVisible();
    await expect(page.getByRole("textbox", { name: /^Start/ })).toBeVisible();
    await expect(page.getByRole("textbox", { name: /^End/ })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Location" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Description" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Recurrence" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Category" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Color" })).toBeVisible();
    await expect(page.getByLabel("ICS file")).toHaveAttribute("accept", /text\/calendar/);
    await expect(page.getByRole("button", { name: "Export Local ICS" })).toBeVisible();
    await page.getByRole("button", { name: "Sync Now" }).click();
    await expect(calendarEventCard(page, "Calendar all-day planning")).toBeVisible();
    await expect(
      calendarEventCard(page, "Calendar all-day planning").getByText("All day")
    ).toBeVisible();
    await expect(calendarEventCard(page, "Calendar timed consult")).toBeVisible();
    await expect(
      calendarEventCard(page, "Calendar timed consult").getByText("Operatory 2")
    ).toBeVisible();
    await expect(
      calendarEventCard(page, "Calendar timed consult").getByText("Google Calendar", {
        exact: true
      })
    ).toBeVisible();
    await expect(
      calendarEventCard(page, "Calendar all-day planning").getByRole("link", {
        name: "Open in Google Calendar"
      })
    ).toHaveAttribute("href", /calendar\.google\.com/);

    events = [
      ...events,
      calendarEventFixture({
        id: "calendar_event_refresh",
        title: "Calendar refresh event",
        allDay: false,
        startAt: "2026-07-16T15:00:00.000Z",
        endAt: "2026-07-16T15:30:00.000Z",
        version: 1
      })
    ];
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(calendarEventCard(page, "Calendar refresh event")).toBeVisible();

    await page.getByLabel("Calendar date").fill("2026-07-15");
    await page
      .getByLabel("Calendar view")
      .getByRole("button", { name: "Day", exact: true })
      .click();
    await expect(page.getByRole("grid", { name: "Day schedule" })).toBeVisible();
    await expect(page.getByText("6 AM")).toBeVisible();
    await expect(calendarGridEvent(page, "Calendar all-day planning")).toBeVisible();
    await expect(calendarGridEvent(page, "Calendar timed consult")).toBeVisible();
    await page
      .getByLabel("Calendar view")
      .getByRole("button", { name: "Week", exact: true })
      .click();
    await expect(page.getByRole("button", { name: /Sunday, July 12/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Saturday, July 18/ })).toBeVisible();
    await expect(calendarGridEvent(page, "Calendar refresh event")).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText(/Jul 19-Jul 25/)).toBeVisible();
    await page.getByRole("button", { name: "Previous" }).click();
    await page
      .getByLabel("Calendar view")
      .getByRole("button", { name: "Month", exact: true })
      .click();
    await expect(page.getByText("July 2026")).toBeVisible();
    await expect(
      page.locator(".month-cell").filter({ hasText: "Calendar all-day planning" })
    ).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText("August 2026")).toBeVisible();
    await page.getByRole("button", { name: "Today" }).click();
    await expect(page.getByText("July 2026")).toBeVisible();
    await page
      .getByLabel("Calendar view")
      .getByRole("button", { name: "Agenda", exact: true })
      .click();
    await calendarEventCard(page, "Calendar timed consult")
      .getByRole("button", { name: "Dismiss" })
      .click();
    await expect(calendarEventCard(page, "Calendar timed consult")).toHaveCount(0);
    await page.getByRole("combobox", { name: "Source" }).selectOption("local");
    await page.getByRole("textbox", { name: /^Title/ }).fill("Browser local event");
    await page.getByRole("textbox", { name: "Location" }).fill("Room 3");
    await page.getByRole("button", { name: "Create Local Event" }).click();
    await expect(calendarEventCard(page, "Browser local event")).toBeVisible();
    await expect(
      calendarEventCard(page, "Browser local event").locator(".source-badge.local")
    ).toBeVisible();
    await calendarEventCard(page, "Browser local event")
      .getByRole("button", { name: "Edit" })
      .click();
    await expect(calendarEventCard(page, "Browser local event updated")).toBeVisible();

    await page.getByRole("combobox", { name: "Source" }).selectOption("google-calendar");
    await calendarEventCard(page, "Calendar all-day planning")
      .getByRole("button", { name: "Annotate" })
      .click();
    await expect(
      calendarEventCard(page, "Calendar all-day planning").getByText("Pinned")
    ).toBeVisible();
    await expect(
      calendarEventCard(page, "Calendar all-day planning").getByText("DentLink note")
    ).toBeVisible();
    await page.getByRole("button", { name: "Sync Now" }).click();
    await expect(
      calendarEventCard(page, "Calendar all-day planning").getByText("DentLink note")
    ).toBeVisible();

    await page.getByRole("combobox", { name: "Source" }).selectOption("local");
    await page.getByLabel("ICS file").setInputFiles({
      name: "browser-import.ics",
      mimeType: "text/calendar",
      buffer: Buffer.from("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n")
    });
    await expect(page.getByText("browser-import.ics")).toBeVisible();
    await page.getByRole("button", { name: "Import ICS" }).click();
    await expect(calendarEventCard(page, "ICS browser import")).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export Local ICS" }).click();
    expect((await downloadPromise).suggestedFilename()).toBe("dentlink-calendar.ics");
    await calendarEventCard(page, "Browser local event updated")
      .getByRole("button", { name: "Delete" })
      .click();
    await expect(
      page.getByRole("article").filter({ hasText: "Browser local event updated" })
    ).toHaveCount(0);

    await page.setViewportSize({ width: 760, height: 900 });
    await expect(
      page.getByLabel("Calendar view").getByRole("button", { name: "Agenda", exact: true })
    ).toBeVisible();
    await expect(page.getByRole("textbox", { name: /^Title/ })).toBeVisible();
  });
});

function noteCard(page: Page, title: string) {
  return page.getByRole("article", { name: `Note ${title}` });
}

function notificationCard(page: Page, title: string) {
  return page.locator(".notification-card").filter({ hasText: title });
}

function calendarEventCard(page: Page, title: string) {
  return page.getByRole("article", { name: `Calendar event ${title}` });
}

function calendarGridEvent(page: Page, title: string) {
  return page.locator(".event-chip, .timed-event").filter({ hasText: title });
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

function notificationFixture(input: {
  id: string;
  title: string;
  summary: string;
  createdAt?: string;
  updatedAt?: string;
}) {
  const timestamp = new Date().toISOString();
  return {
    id: input.id,
    userId: "user_browser_gmail_refresh",
    title: input.title,
    summary: input.summary,
    body: "",
    source: "connector",
    sourceLabel: "Gmail",
    sourceUrl: "https://mail.google.com/mail/u/0/#inbox/test-message",
    severity: "info",
    status: "active",
    pinned: false,
    rank: 0,
    globalOrder: 1000,
    version: 1,
    createdAt: input.createdAt ?? timestamp,
    updatedAt: input.updatedAt ?? timestamp,
    completedAt: null,
    dismissedAt: null
  };
}

function calendarEventFixture(input: {
  id: string;
  title: string;
  allDay: boolean;
  startAt: string;
  endAt: string;
  startDate?: string;
  endDate?: string;
  location?: string;
  version: number;
}) {
  const timestamp = new Date().toISOString();
  return {
    id: input.id,
    userId: "user_browser_calendar_refresh",
    source: "google-calendar",
    connectorAccountId: "connector_calendar_browser_refresh",
    provider: "google-calendar",
    providerEventId: input.id.replace("calendar_event_", "provider_event_"),
    calendarId: "primary",
    calendarSummary: "Primary calendar",
    title: input.title,
    description: "",
    location: input.location ?? null,
    sourceUrl: `https://calendar.google.com/event?eid=${input.id}`,
    startAt: input.startAt,
    endAt: input.endAt,
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
    timezone: "America/New_York",
    allDay: input.allDay,
    recurrenceRule: null,
    category: null,
    color: null,
    reminderMinutes: null,
    importedUid: null,
    annotation: null,
    status: "active",
    version: input.version,
    createdAt: timestamp,
    updatedAt: timestamp,
    dismissedAt: null
  };
}

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    headers: corsHeaders(),
    contentType: "application/json",
    body: JSON.stringify(body)
  });
}

function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": webOrigin,
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "authorization,content-type",
    vary: "Origin"
  };
}
