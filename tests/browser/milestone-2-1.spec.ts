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
    await page.getByText("Filters").click();
    await page.getByText("Manage folders and tags").click();
    await page.getByLabel("New folder name").fill(folderName);
    await page.getByRole("button", { name: "Add" }).first().click();
    await expect(page.getByLabel("Folder filter")).toContainText(folderName);
    await page.getByLabel("New tag name").fill(tagName);
    await page.getByRole("button", { name: "Add" }).nth(1).click();
    await expect(page.getByText(tagName)).toBeVisible();

    await page.getByLabel("Create note").click();
    await page.getByLabel("New note title").fill(firstNote);
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(noteCard(page, firstNote)).toBeVisible();
    await page.getByLabel("Create note").click();
    await page.getByLabel("New note title").fill(secondNote);
    await page
      .getByRole("dialog", { name: "Create note" })
      .getByLabel("Type")
      .selectOption("reference");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(noteCard(page, secondNote)).toBeVisible();

    await noteCard(page, firstNote).getByLabel("Pin note").click();
    await settleMutation(page);
    await noteCard(page, firstNote).getByLabel(`Mark ${firstNote} done`).check();
    await settleMutation(page);
    await noteCard(page, firstNote)
      .getByRole("button", { name: new RegExp(firstNote) })
      .click();
    await page.getByText("More Options").click();
    await page.getByLabel(`Priority for ${firstNote}`).selectOption("high");
    await settleMutation(page);
    await page.getByLabel(`Folder for ${firstNote}`).selectOption({ label: folderName });
    await settleMutation(page);
    await page.getByLabel(`Due date for ${firstNote}`).fill("2026-08-15");
    await settleMutation(page);
    await page.getByLabel(`${tagName} tag for ${firstNote}`).check();
    await settleMutation(page);
    await page.getByRole("button", { name: "Close note details" }).click();
    await page.getByLabel("Search notes").click();
    await page.locator(".notes-search-field input").fill(firstNote);
    await expect(noteCard(page, firstNote)).toBeVisible();
    await expect(noteCard(page, secondNote)).toHaveCount(0);
    await page.locator(".notes-search-field input").fill("");

    await makeNoteConflict(page, firstNote, "Server-side conflict title");
    await noteCard(page, firstNote)
      .getByRole("button", { name: new RegExp(firstNote) })
      .click();
    await page.locator(".note-title").fill(`Stale ${runId}`);
    await expect(page.getByRole("alert")).toContainText("changed on the server");
    await resolveOpenConflict(page);
    await page.getByRole("button", { name: "Close note details" }).click();

    await page.getByRole("button", { name: "Notifications" }).click();
    await expect(page.getByRole("button", { name: "Notifications" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Agenda" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Notes" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Webhooks" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Connectors" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Refresh All" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Refresh", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Debug" }).click();
    await page.getByLabel("Debug Mode").check();
    await page.reload();
    await expect(page.getByText(email)).toBeVisible();
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Debug" }).click();
    await expect(page.getByLabel("Debug Mode")).toBeChecked();
    await page.getByRole("button", { name: "Notifications" }).click();
    const firstNotification = `Alpha alert ${runId}`;
    const secondNotification = `Bravo alert ${runId}`;
    await createNotification(page, firstNotification, "medium");
    await createNotification(page, secondNotification, "high");
    await expect(notificationCard(page, firstNotification)).toBeVisible();
    await notificationCard(page, firstNotification).getByRole("button", { name: "Pin" }).click();
    await expect(
      notificationCard(page, firstNotification).getByRole("button", { name: "Complete" })
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Ranking Mode" }).click();
    await notificationCard(page, secondNotification)
      .getByRole("button", { name: "Dismiss" })
      .click();
    await expect(notificationCard(page, secondNotification)).toHaveCount(0);
    await page.getByRole("button", { name: "History" }).click();
    await expect(notificationCard(page, secondNotification)).toBeVisible();
    await expect(notificationCard(page, secondNotification).getByText("Dismissed")).toBeVisible();
    await page.getByRole("button", { name: "Active" }).click();
    await page.reload();
    await expect(page.getByText(email)).toBeVisible();
    await page.getByRole("button", { name: "Notifications" }).click();
    await expect(notificationCard(page, firstNotification)).toBeVisible();
    await notificationCard(page, firstNotification).getByRole("button").first().click();
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(notificationCard(page, firstNotification)).toHaveCount(0);

    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Connections" }).click();
    await expect(page.getByText("Gmail Connections")).toBeVisible();
    await expect(page.getByText("Google Calendar Connections")).toBeVisible();
    await expect(page.getByText("Webhook Connections")).toBeVisible();
    await page.getByText("Webhook Connections").click();
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
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Connections" }).click();
    await page.getByText("Webhook Connections").click();
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
    await page.locator(".webhooks-shell").getByRole("button", { name: "Refresh" }).click();
    await expect(notificationWebhook.getByText(/Last triggered: (?!Never)/)).toBeVisible();
    await page.getByRole("button", { name: "Notifications" }).click();
    await page.getByRole("button", { name: "Refresh All" }).click();
    await expect(notificationCard(page, webhookNotification)).toBeVisible();

    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Connections" }).click();
    await page.getByText("Webhook Connections").click();
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

    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Connections" }).click();
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
      settings: {
        googleEmail: "gmail-refresh@example.invalid",
        gmailIngestionEngine: "gmail_api",
        gmailReadonlyGranted: true
      },
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
    const calendarAccount = {
      id: "connector_calendar_browser_refresh_all",
      userId: user.id,
      connectorKey: "google-calendar",
      displayName: "Google Calendar Primary calendar",
      status: "connected",
      healthStatus: "healthy",
      syncStatus: "idle",
      settings: {},
      credentialRef: "credential_calendar_refresh_all",
      credentialStatus: "configured",
      syncCursor: "calendar_sync_1",
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
    let calendarEvents: unknown[] = [];
    let engineUpdateAttempts = 0;
    let serveStaleConnectorList = false;
    let eventStreamOpened = false;
    let syncAllRequests = 0;
    let gmailDiagnostics = {
      account: gmailAccount,
      summary: {
        discovered: 0,
        examined: 0,
        created: 0,
        updated: 0,
        duplicate: 0,
        skipped: 0,
        filtered: 0,
        failed: 0
      },
      messages: [] as unknown[]
    };
    let gmailRules = [
      {
        id: "browser-rule-high-priority",
        name: "High priority example.com",
        enabled: true,
        priority: 1,
        matchMode: "all",
        senderDomain: "example.com",
        action: "high_priority"
      }
    ];

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
      if (method === "GET" && path === "/v1/ai/settings") {
        await fulfillJson(route, {
          enabled: true,
          available: true,
          provider: "openai",
          model: "gpt-test-mini",
          maxInputChars: 6000,
          unavailableReason: null,
          requestsThisMonth: 1,
          inputCharsThisMonth: 1200,
          outputTokensThisMonth: 42,
          failedRequestsThisMonth: 0,
          estimatedCostThisMonth: null
        });
        return;
      }
      if (method === "GET" && path === "/v1/events") {
        eventStreamOpened = true;
        await new Promise((resolve) => setTimeout(resolve, 250));
        notifications = [
          ...notifications,
          notificationFixture({
            id: "notification_auto_sse",
            title: "Gmail auto refresh message",
            summary: "Loaded by backend change notification"
          })
        ];
        await route.fulfill({
          status: 200,
          headers: { ...corsHeaders(), "Content-Type": "text/event-stream" },
          body:
            "event: dentlink_change\n" +
            'data: {"type":"notifications_updated","source":"gmail","accountId":"' +
            gmailAccount.id +
            '","revision":184}\n\n'
        });
        return;
      }
      if (method === "GET" && path === "/v1/calendar/events") {
        await fulfillJson(route, { events: calendarEvents });
        return;
      }
      if (method === "GET" && path === "/v1/webhooks") {
        await fulfillJson(route, { webhooks: [] });
        return;
      }
      if (method === "GET" && path === "/v1/connectors/accounts") {
        if (serveStaleConnectorList) {
          serveStaleConnectorList = false;
          await fulfillJson(route, {
            accounts: [
              {
                ...gmailAccount,
                version: gmailAccount.version - 1,
                settings: {
                  googleEmail: "gmail-refresh@example.invalid",
                  gmailIngestionEngine: "gmail_api",
                  gmailReadonlyGranted: true
                }
              },
              calendarAccount
            ]
          });
          return;
        }
        await fulfillJson(route, { accounts: [gmailAccount, calendarAccount] });
        return;
      }
      if (method === "GET" && path === `/v1/connectors/gmail/${gmailAccount.id}/diagnostics`) {
        await fulfillJson(route, gmailDiagnostics);
        return;
      }
      if (method === "GET" && path === `/v1/connectors/gmail/${gmailAccount.id}/rules`) {
        await fulfillJson(route, { account: gmailAccount, rules: gmailRules });
        return;
      }
      if (method === "PUT" && path === `/v1/connectors/gmail/${gmailAccount.id}/rules`) {
        const body = (await request.postDataJSON()) as { rules: unknown[] };
        gmailRules = body.rules;
        await fulfillJson(route, { account: gmailAccount, rules: gmailRules });
        return;
      }
      if (method === "PUT" && path === `/v1/connectors/gmail/${gmailAccount.id}/engine`) {
        const body = (await request.postDataJSON()) as {
          expectedVersion?: number;
          engine: "gmail_api" | "gmail_imap";
          comparisonMode?: boolean;
        };
        const updatedAt = new Date().toISOString();
        engineUpdateAttempts += 1;
        if (engineUpdateAttempts === 1 && body.engine === "gmail_imap") {
          await route.abort("failed");
          return;
        }
        if (
          typeof body.expectedVersion === "number" &&
          body.expectedVersion !== gmailAccount.version
        ) {
          await fulfillJson(
            route,
            {
              error: {
                code: "version_mismatch",
                message: "Connector account changed on the server"
              }
            },
            409
          );
          return;
        }
        gmailAccount.settings = {
          ...gmailAccount.settings,
          gmailRequestedIngestionEngine: body.engine,
          gmailIngestionEngine:
            body.engine === "gmail_imap" ? gmailAccount.settings.gmailIngestionEngine : "gmail_api",
          gmailImapComparisonMode: body.comparisonMode === true,
          gmailReconnectRequired: body.engine === "gmail_imap"
        };
        gmailAccount.healthStatus = body.engine === "gmail_imap" ? "degraded" : "healthy";
        gmailAccount.errorCode =
          body.engine === "gmail_imap" ? "gmail_imap_reconnect_required" : null;
        gmailAccount.errorMessage =
          body.engine === "gmail_imap"
            ? "Reconnect Gmail to grant full Gmail mailbox access required for IMAP sync."
            : null;
        gmailAccount.updatedAt = updatedAt;
        gmailAccount.version += 1;
        if (body.engine === "gmail_imap") serveStaleConnectorList = true;
        gmailDiagnostics = { ...gmailDiagnostics, account: gmailAccount };
        await new Promise((resolve) => setTimeout(resolve, 150));
        await fulfillJson(route, gmailAccount);
        return;
      }
      if (method === "POST" && path === `/v1/connectors/gmail/${gmailAccount.id}/sync`) {
        const syncedAt = new Date().toISOString();
        gmailAccount.lastSyncAt = syncedAt;
        gmailAccount.lastHealthAt = syncedAt;
        gmailAccount.syncCursor = "history_101";
        gmailAccount.settings = {
          ...gmailAccount.settings,
          gmailLastIncrementalAt: syncedAt,
          gmailLastIncrementalStatus: "partial",
          gmailLastIncrementalExamined: 142,
          gmailLastIncrementalCreated: 118,
          gmailLastIncrementalUpdated: 7,
          gmailLastIncrementalDuplicate: 12,
          gmailLastIncrementalSkipped: 3,
          gmailLastIncrementalFiltered: 0,
          gmailLastIncrementalFailed: 2,
          gmailLastSyncEngine: "gmail_api",
          gmailLastSyncAt: syncedAt,
          gmailLastSyncStatus: "partial",
          gmailLastSyncDurationMs: 612,
          gmailLastSyncScanned: 142,
          gmailLastSyncProcessed: 142,
          gmailLastSyncCreated: 118,
          gmailLastSyncDuplicate: 12,
          gmailLastSyncSuppressed: 0,
          gmailLastSyncFailed: 2,
          gmailLastSuccessfulSyncAt: null,
          gmailAverageSyncMs: 612,
          gmailExpectedMessages: 142,
          gmailActualNotifications: 130,
          gmailMissingMessageDifference: 12
        };
        if (gmailAccount.settings.gmailImapComparisonMode === true) {
          gmailAccount.settings = {
            ...gmailAccount.settings,
            gmailLastComparisonAt: syncedAt,
            gmailLastComparisonApiDiscovered: 140,
            gmailLastComparisonImapDiscovered: 142,
            gmailLastComparisonNotificationsCreated: 118,
            gmailLastComparisonDuplicates: 12,
            gmailLastComparisonFailures: 2,
            gmailLastComparisonMismatch: true
          };
        }
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
        gmailDiagnostics = {
          account: gmailAccount,
          summary: {
            discovered: 142,
            examined: 142,
            created: 118,
            updated: 7,
            duplicate: 12,
            skipped: 3,
            filtered: 0,
            failed: 2
          },
          messages: [
            {
              messageId: "gmail-message-failed",
              outcome: "failed",
              reason: "Gmail API request failed",
              processedAt: syncedAt,
              notificationId: null,
              sourceRecordId: "source_gmail_failed"
            },
            {
              messageId: "gmail-message-created",
              outcome: "notification_created",
              reason: "Created a Gmail notification",
              processedAt: syncedAt,
              notificationId: "notification_gmail_synced",
              sourceRecordId: "source_gmail_created"
            }
          ]
        };
        gmailAccount.healthStatus = "degraded";
        gmailAccount.errorCode = "gmail_partial_sync_failed";
        gmailAccount.errorMessage = "2 Gmail messages failed processing";
        await new Promise((resolve) => setTimeout(resolve, 150));
        await fulfillJson(route, {
          account: gmailAccount,
          processed: 1,
          createdNotifications: 1,
          summary: gmailDiagnostics.summary,
          outcomes: [
            {
              messageId: "gmail-message-created",
              status: "notification_created",
              reason: "Created a Gmail notification",
              recordId: "source_gmail_created"
            },
            {
              messageId: "gmail-message-failed",
              status: "failed",
              reason: "Gmail API request failed",
              recordId: "source_gmail_failed"
            }
          ]
        });
        return;
      }
      if (method === "POST" && path === "/v1/connectors/sync-all") {
        syncAllRequests += 1;
        const syncedAt = new Date().toISOString();
        gmailAccount.lastSyncAt = syncedAt;
        gmailAccount.updatedAt = syncedAt;
        gmailAccount.version += 1;
        calendarAccount.lastSyncAt = syncedAt;
        calendarAccount.updatedAt = syncedAt;
        calendarAccount.version += 1;
        notifications = [
          ...notifications,
          notificationFixture({
            id: "notification_refresh_all",
            title: "Gmail Refresh All message",
            summary: "Loaded after Refresh All"
          })
        ];
        calendarEvents = [
          calendarEventFixture({
            id: "calendar_refresh_all",
            title: "Refresh All calendar event",
            allDay: false,
            startAt: "2026-07-15T15:00:00.000Z",
            endAt: "2026-07-15T15:30:00.000Z",
            version: 1
          })
        ];
        await fulfillJson(route, {
          startedAt: syncedAt,
          completedAt: syncedAt,
          status: "success",
          connectors: [
            {
              accountId: gmailAccount.id,
              provider: "gmail",
              status: "success",
              engine: "gmail_api",
              created: 1,
              updated: 0,
              duplicate: 0,
              failed: 0,
              message: null
            },
            {
              accountId: calendarAccount.id,
              provider: "google-calendar",
              status: "success",
              created: 1,
              updated: 0,
              duplicate: 0,
              failed: 0,
              message: null
            }
          ]
        });
        return;
      }
      if (method === "PATCH" && path.startsWith("/v1/notifications/")) {
        const notificationId = path.split("/").pop();
        const patch = request.postDataJSON() as { patch?: { status?: string; pinned?: boolean } };
        const updatedAt = new Date().toISOString();
        let updatedNotification: unknown = null;
        notifications = notifications.map((notification) => {
          const current = notification as {
            id?: string;
            version?: number;
            status?: string;
            pinned?: boolean;
            completedAt?: string | null;
            dismissedAt?: string | null;
          };
          if (current.id !== notificationId) return notification;
          const status = patch.patch?.status ?? current.status;
          updatedNotification = {
            ...current,
            pinned: patch.patch?.pinned ?? current.pinned,
            status,
            completedAt:
              status === "done" ? updatedAt : status === "active" ? null : current.completedAt,
            dismissedAt:
              status === "dismissed" ? updatedAt : status === "active" ? null : current.dismissedAt,
            updatedAt,
            version: (current.version ?? 1) + 1
          };
          return updatedNotification;
        });
        await fulfillJson(route, updatedNotification);
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
    await expect(notificationCard(page, "Gmail auto refresh message")).toBeVisible();
    expect(eventStreamOpened).toBe(true);
    await expect(page.getByRole("button", { name: "Webhooks" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Connectors" })).toHaveCount(0);
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Connections" }).click();
    await expect(page.getByText(gmailAccount.displayName)).toBeVisible();
    await expect(page.getByText("Gmail Connections")).toBeVisible();
    await expect(page.getByText("Google Calendar Connections")).toBeVisible();
    await expect(page.getByText("Webhook Connections")).toBeVisible();
    await expect(page.getByText("Email Sorting Rules")).toHaveCount(0);
    await page.getByRole("button", { name: "Notification Rules", exact: true }).click();
    await expect(page.getByText("Email Sorting Rules")).toBeVisible();
    await page.getByText("Email Sorting Rules").click();
    await expect(page.getByLabel("Rule name")).toHaveValue("High priority example.com");
    await expect(page.getByLabel("Sender domain equals")).toHaveValue("example.com");
    await expect(page.getByLabel("Action")).toHaveValue("high_priority");
    await page.getByRole("button", { name: "Add Rule" }).click();
    await expect(page.getByLabel("Rule name").last()).toHaveValue("New email rule");
    await page.getByRole("button", { name: "Save Rules" }).click();
    await expect(page.getByRole("button", { name: "Saving Rules..." })).toHaveCount(0);
    await page.getByRole("button", { name: "Connections" }).click();
    await expect(
      page
        .getByRole("article")
        .filter({ hasText: gmailAccount.displayName })
        .getByText("Last Sync: Never")
    ).toBeVisible();
    await expect(page.getByLabel("Gmail Ingestion Engine")).toHaveValue("gmail_api");
    await expect(page.getByText("Requested Engine: Gmail API")).toBeVisible();
    await expect(page.getByText("Active Engine: Gmail API")).toBeVisible();
    await expect(page.getByText("Connection Status: connected")).toBeVisible();
    await expect(page.getByText("Reconnect Required: No")).toBeVisible();
    await expect(
      page.getByText("Next Scheduled Sync: Within 5 minutes after activation")
    ).toBeVisible();
    await page.getByLabel("Gmail Ingestion Engine").selectOption("gmail_imap");
    await expect(page.getByText("Saving...")).toBeVisible();
    await expect(
      page
        .getByRole("article")
        .getByText("DentLink could not reach the preview API. Your engine selection was not saved.")
    ).toBeVisible();
    await expect(page.getByLabel("Gmail Ingestion Engine")).toHaveValue("gmail_imap");
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByText("Saving...")).toBeVisible();
    await expect(
      page.getByText("Reconnect Required. IMAP requires Gmail mail access")
    ).toBeVisible();
    await expect(page.getByLabel("Gmail Ingestion Engine")).toHaveValue("gmail_imap");
    await expect(page.getByText("Requested Engine: Gmail IMAP (Preview)")).toBeVisible();
    await expect(page.getByText("Active Engine: Gmail API")).toBeVisible();
    await expect(page.getByText("Reason: Reconnect required")).toBeVisible();
    await expect(page.getByText("Reconnect Required: Yes")).toBeVisible();
    await expect(page.getByText("Verified: No")).toBeVisible();
    expect(engineUpdateAttempts).toBe(2);
    await page.getByRole("button", { name: "Debug" }).click();
    await page.getByLabel("Debug Mode").check();
    await page.getByRole("button", { name: "Connections" }).click();
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByLabel("Gmail Ingestion Engine")).toHaveValue("gmail_imap");
    await expect(page.getByText("Requested Engine: Gmail IMAP (Preview)")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Connections" }).click();
    await expect(page.getByLabel("Gmail Ingestion Engine")).toHaveValue("gmail_imap");
    await expect(page.getByText("Requested Engine: Gmail IMAP (Preview)")).toBeVisible();
    await page.getByLabel("Enable preview comparison mode").click();
    await expect(page.getByLabel("Enable preview comparison mode")).toBeChecked();

    const gmailCard = page.getByRole("article").filter({ hasText: gmailAccount.displayName });
    await gmailCard.getByRole("button", { name: "Sync Now" }).click();
    await expect(
      page.getByRole("button", { name: /Searching|Fetching|Applying rules|Creating notifications/ })
    ).toBeVisible();
    await expect(notificationCard(page, "Gmail synced message")).toBeVisible();
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Connections" }).click();
    await expect(page.getByText("Finished.")).toBeVisible();
    await expect(gmailCard.getByText("Last Sync: Never")).toHaveCount(0);
    await expect(page.getByText("142 messages examined")).toBeVisible();
    await expect(page.getByText("118 notifications created").first()).toBeVisible();
    await expect(page.getByText("7 updated")).toBeVisible();
    await expect(page.getByText("12 duplicates").first()).toBeVisible();
    await expect(page.getByText("3 skipped")).toBeVisible();
    await expect(page.getByText("2 failed").first()).toBeVisible();
    await expect(page.getByText("Gmail Sync Diagnostics")).toBeVisible();
    await expect(page.getByText("Engine: Gmail API", { exact: true })).toBeVisible();
    await expect(page.getByText("Duration: 612 ms")).toBeVisible();
    await expect(page.getByText("Average Sync Time: 612 ms").first()).toBeVisible();
    await expect(page.getByText("Latest Comparison Result: Mismatch")).toBeVisible();
    await expect(page.getByText("142 messages scanned")).toBeVisible();
    await expect(page.getByText("142 messages processed")).toBeVisible();
    await expect(page.getByText("Expected Messages: 142")).toBeVisible();
    await expect(page.getByText("Actual Notifications: 130")).toBeVisible();
    await expect(page.getByText("Difference: 12")).toBeVisible();
    await expect(page.getByText("Possible missed messages detected.")).toBeVisible();
    await expect(page.getByText("Preview Comparison", { exact: true })).toBeVisible();
    await expect(page.getByText("IMAP discovered: 142").first()).toBeVisible();
    await expect(page.getByText("API discovered: 140").first()).toBeVisible();
    await expect(page.getByText("Difference: 2").first()).toBeVisible();
    await expect(
      page.getByText("Potential missed messages detected. View comparison")
    ).toBeVisible();
    await expect(
      page.getByText(
        "2 Gmail messages could not be processed. Successfully processed messages were still imported."
      )
    ).toBeVisible();
    await page.getByText("Recent Gmail processing outcomes").click();
    await expect(page.getByText("gmail-message-failed")).toBeVisible();
    await expect(page.getByText("Gmail API request failed")).toBeVisible();
    await expect(page.getByText("IMAP-enabled accounts use a rolling recent scan")).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export Diagnostics Download JSON" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain("dentlink-gmail-diagnostics");
    await expect(page.getByRole("button", { name: "Backfill 30 Days" })).toHaveCount(0);
    await expect(page.getByText("Last Incremental Sync")).toBeVisible();
    await expect(page.getByText("118 notifications created").first()).toBeVisible();

    await page.getByRole("button", { name: "Refresh All" }).click();
    await expect(page.getByText("Refreshing Gmail...")).toBeVisible();
    await expect(page.getByText("Updating Notifications...")).toBeVisible();
    await expect(page.getByText("Refresh All finished.")).toBeVisible();
    await expect(page.getByText("Gmail: success")).toBeVisible();
    await expect(page.getByText("Google Calendar: success")).toBeVisible();
    expect(syncAllRequests).toBe(1);
    await page.getByRole("button", { name: "Notifications" }).click();
    await expect(page.getByText("Email AI: Enabled")).toBeVisible();
    await page.getByLabel("Sort").selectOption("requires_action");
    await expect(notificationCard(page, "Gmail Refresh All message")).toBeVisible();
    await expect(page.getByText("Importance: 90").first()).toBeVisible();
    await notificationCard(page, "Gmail Refresh All message").getByRole("button").first().click();
    await expect(page.getByText("AI state: complete").first()).toBeVisible();
    await expect(
      page.getByText("High priority rule matched: High priority example.com").first()
    ).toBeVisible();
    await expect(page.getByText("Suggested action: Review").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Open original" }).first()).toBeVisible();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(page.getByRole("button", { name: "Refresh All", exact: true })).toBeVisible();
    await expect(notificationCard(page, "Gmail Refresh All message")).toBeVisible();
    const dismissBox = await notificationCard(page, "Gmail Refresh All message")
      .getByRole("button", { name: "Dismiss" })
      .boundingBox();
    expect(dismissBox?.height).toBeGreaterThanOrEqual(40);
    await page.setViewportSize({ width: 390, height: 720 });
    await expect(
      page.getByLabel("Mobile primary").getByRole("button", { name: "Notifications" })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Refresh All", exact: true })).toBeVisible();
    await expect(notificationCard(page, "Gmail Refresh All message")).toBeVisible();
    await expect(
      notificationCard(page, "Gmail Refresh All message").getByRole("button", {
        name: "Complete"
      })
    ).toBeVisible();
    await notificationCard(page, "Gmail Refresh All message")
      .getByRole("button", { name: "Complete" })
      .click();
    await expect(notificationCard(page, "Gmail Refresh All message")).toHaveCount(0);
    await page.getByRole("button", { name: "History" }).click();
    await expect(notificationCard(page, "Gmail Refresh All message")).toBeVisible();
    await expect(
      notificationCard(page, "Gmail Refresh All message").getByText("Completed")
    ).toBeVisible();
    await notificationCard(page, "Gmail Refresh All message")
      .getByRole("button", { name: "Restore" })
      .click();
    await page.getByRole("button", { name: "Active" }).click();
    await expect(notificationCard(page, "Gmail Refresh All message")).toBeVisible();
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "AI", exact: true }).click();
    await expect(page.getByText("AI: Enabled")).toBeVisible();
    await expect(page.getByText("Model: gpt-test-mini")).toBeVisible();
    await page.getByRole("button", { name: "Agenda" }).click();
    await expect(page.getByText("Refresh All calendar event")).toBeVisible();
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
      if (method === "PATCH" && path.startsWith("/v1/notifications/")) {
        const notificationId = path.split("/").pop();
        const patch = request.postDataJSON() as { patch?: { status?: string; pinned?: boolean } };
        const updatedAt = new Date().toISOString();
        let updatedNotification: unknown = null;
        notifications = notifications.map((notification) => {
          const current = notification as {
            id?: string;
            version?: number;
            status?: string;
            pinned?: boolean;
            completedAt?: string | null;
            dismissedAt?: string | null;
          };
          if (current.id !== notificationId) return notification;
          const status = patch.patch?.status ?? current.status;
          updatedNotification = {
            ...current,
            pinned: patch.patch?.pinned ?? current.pinned,
            status,
            completedAt:
              status === "done" ? updatedAt : status === "active" ? null : current.completedAt,
            dismissedAt:
              status === "dismissed" ? updatedAt : status === "active" ? null : current.dismissedAt,
            updatedAt,
            version: (current.version ?? 1) + 1
          };
          return updatedNotification;
        });
        await fulfillJson(route, updatedNotification);
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
    await expect(page.getByRole("textbox", { name: /^Title/ })).toHaveCount(0);
    await expect(page.getByLabel("ICS file")).toHaveCount(0);
    await page.getByLabel("Calendar actions").click();
    await expect(page.getByRole("button", { name: "New Local Event" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Import ICS" })).toBeVisible();
    await page.getByRole("button", { name: "New Local Event" }).click();
    await expect(page.getByRole("textbox", { name: /^Title/ })).toBeVisible();
    await expect(page.getByRole("textbox", { name: /^Start/ })).toBeVisible();
    await expect(page.getByRole("textbox", { name: /^End/ })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Location" })).toBeVisible();
    await expect(page.getByText("More Options")).toBeVisible();
    await page.getByText("More Options").click();
    await expect(page.getByRole("textbox", { name: "Description" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Recurrence" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Category" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Color" })).toBeVisible();
    await page.getByRole("button", { name: "Close calendar actions" }).click();
    await page.getByLabel("Calendar actions").click();
    await page.getByRole("button", { name: "Import ICS" }).click();
    await expect(page.getByLabel("ICS file")).toHaveAttribute("accept", /text\/calendar/);
    await expect(page.getByRole("button", { name: "Export Local ICS" })).toBeVisible();
    await page.getByRole("button", { name: "Close calendar actions" }).click();
    await expect(page.getByRole("button", { name: "Sync Now" })).toHaveCount(0);
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Debug" }).click();
    await page.getByLabel("Debug Mode").check();
    await page.getByRole("button", { name: "Agenda" }).click();
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
    await page.getByRole("button", { name: "Refresh All" }).click();
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
    await page.getByLabel("Calendar actions").click();
    await page.getByRole("button", { name: "New Local Event" }).click();
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
    await page.getByLabel("Calendar actions").click();
    await page.getByRole("button", { name: "Import ICS" }).click();
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
    await page.getByRole("button", { name: "Close calendar actions" }).click();
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
    await expect(page.getByRole("textbox", { name: /^Title/ })).toHaveCount(0);
  });

  test("covers corrective Notes folders, AI overrides, source colors, and mobile Settings navigation", async ({
    page
  }) => {
    await page.setViewportSize({ width: 412, height: 915 });
    const state = await installCorrectiveRegressionRoutes(page);

    await page.goto("/");
    await expect(page.getByRole("button", { name: "Notifications" })).toBeVisible();
    await expect(
      page.getByLabel("Mobile primary").getByRole("button", { name: "Settings" })
    ).toBeVisible();
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("button", { name: "Appearance", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "AI", exact: true }).click();
    await expect(page.getByRole("button", { name: "Back to Settings" })).toBeVisible();
    await page.getByRole("button", { name: "Back to Settings" }).click();
    await expect(page.getByRole("button", { name: "Appearance", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Notes" }).click();

    const folderBrowser = page.getByLabel("Note folders");
    await expect(folderBrowser.getByRole("button", { name: /All Notes/ })).toBeVisible();
    await expect(folderBrowser.getByRole("button", { name: "Unfiled1" })).toBeVisible();
    await expect(folderBrowser.getByRole("button", { name: "Operations1" })).toBeVisible();
    await expect(noteCard(page, "Filed note")).toHaveCount(0);
    await page.getByRole("button", { name: "Expand Operations" }).click();
    await expect(noteCard(page, "Filed note")).toBeVisible();
    await page.getByRole("button", { name: "Collapse Operations" }).click();
    await expect(noteCard(page, "Filed note")).toHaveCount(0);
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toBeVisible();
    await page.getByRole("button", { name: "Expand Operations" }).click();
    await expect(noteCard(page, "Filed note")).toBeVisible();

    await page.getByText("Filters").click();
    await page.getByText("Manage folders and tags").click();
    await page.getByLabel("New folder name").fill("Clinical");
    await page.getByRole("button", { name: "Add" }).first().click();
    await expect(folderBrowser.getByRole("button", { name: "Clinical0" })).toBeVisible();
    await folderBrowser.getByRole("button", { name: "Clinical0" }).click();
    await expect(noteCard(page, "Filed note")).toHaveCount(0);
    await folderBrowser.getByRole("button", { name: /All Notes/ }).click();

    await page
      .getByRole("article", { name: "Note Unfiled note" })
      .getByRole("button", { name: /Unfiled note/ })
      .click();
    await page.getByText("More Options").focus();
    await page.keyboard.press("Enter");
    await page.getByLabel("Folder for Unfiled note").selectOption({ label: "Clinical" });
    await settleMutation(page);
    await page.getByRole("button", { name: "Close note details" }).click();
    await folderBrowser.getByRole("button", { name: "Clinical1" }).click();
    await expect(noteCard(page, "Unfiled note")).toBeVisible();

    await folderBrowser.getByRole("button", { name: /All Notes/ }).click();
    await page
      .locator(".folder-row")
      .filter({ hasText: "Clinical" })
      .getByRole("button", { name: "Rename" })
      .click();
    await page.getByLabel("Rename Clinical").fill("Treatment");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(folderBrowser.getByRole("button", { name: "Treatment1" })).toBeVisible();
    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain("move 1 note to Unfiled");
      await dialog.accept();
    });
    await page
      .locator(".folder-row")
      .filter({ hasText: "Treatment" })
      .getByRole("button", { name: "Delete" })
      .click();
    await expect(folderBrowser.getByRole("button", { name: "Treatment1" })).toHaveCount(0);
    await folderBrowser.getByRole("button", { name: "Unfiled1" }).click();
    await expect(noteCard(page, "Unfiled note")).toBeVisible();

    state.failNextFolderCreate = true;
    await page.setViewportSize({ width: 1280, height: 720 });
    if (!(await page.getByLabel("New folder name").isVisible())) {
      await page.getByText("Filters").click();
    }
    if (!(await page.getByLabel("New folder name").isVisible())) {
      await page.getByText("Manage folders and tags").click();
    }
    await page.getByLabel("New folder name").fill("Broken folder");
    await page.getByRole("button", { name: "Add" }).first().click();
    await expect(page.getByRole("alert").first()).toContainText("Folder name already exists");

    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "AI", exact: true }).click();
    await expect(page.getByText("Inheriting global settings")).toBeVisible();
    await page.getByLabel("Override global").click();
    await expect(page.getByText("Using account override")).toBeVisible();
    await page.getByLabel("Account importance instruction").fill("Prioritize implant messages.");
    await page.getByLabel(/Account threshold:/).fill("72");
    state.gmailRefetchRequests = 0;
    await page.getByRole("button", { name: "Reprocess this account today" }).click();
    await expect(page.getByText("Reprocess partial")).toBeVisible();
    await expect(page.getByText("1 updated, 1 suppressed, 0 restored, 1 failed")).toBeVisible();
    expect(state.reprocessRequests).toEqual([
      { timezone: "America/New_York", accountId: "connector_gmail_corrective" }
    ]);
    expect(state.gmailRefetchRequests).toBe(0);
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByText("Reprocess success")).toBeVisible();
    await page.getByRole("button", { name: "Return to global inheritance" }).click();
    await expect(page.getByText("Inheriting global settings")).toBeVisible();

    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    await expect(page.getByText("Gmail Account", { exact: true })).toBeVisible();
    await expect(page.getByText("Calendar Account", { exact: true })).toBeVisible();
    await expect(page.getByText("Clinical intake webhook", { exact: true })).toBeVisible();
    await page
      .locator(".source-color-row")
      .filter({ hasText: "Gmail Account" })
      .locator("input[type='color']")
      .fill("#123456");
    await page.getByRole("button", { name: "Reset all source colors" }).click();
    await expect(
      page
        .locator(".source-color-row")
        .filter({ hasText: "Gmail Account" })
        .locator("input[type='color']")
    ).not.toHaveValue("#123456");

    await page.setViewportSize({ width: 568, height: 320 });
    await expect(
      page.getByLabel("Mobile primary").getByRole("button", { name: "Notifications" })
    ).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(page.getByRole("button", { name: "Notifications" })).toBeVisible();
    await page.setViewportSize({ width: 1024, height: 500 });
    await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
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

async function installCorrectiveRegressionRoutes(page: Page) {
  const now = "2026-07-15T16:00:00.000Z";
  const user = {
    id: "user_corrective_browser",
    email: "corrective@example.invalid",
    createdAt: now
  };
  const session = {
    user,
    session: {
      token: "session_corrective_browser",
      expiresAt: "2026-07-15T18:00:00.000Z"
    }
  };
  const state = {
    user,
    folders: [
      {
        id: "folder_operations",
        userId: user.id,
        name: "Operations",
        createdAt: now,
        updatedAt: now
      }
    ],
    tags: [],
    notes: [
      noteFixture({
        id: "note_filed",
        userId: user.id,
        title: "Filed note",
        folderId: "folder_operations"
      }),
      noteFixture({ id: "note_unfiled", userId: user.id, title: "Unfiled note", folderId: null })
    ],
    preferences: {
      timezone: {
        mode: "override",
        detected: "America/New_York",
        selected: "America/New_York"
      },
      ai: {
        globalPrompt: "Default global importance guidance.",
        threshold: 50,
        presets: [],
        accountOverrides: []
      }
    },
    accounts: [
      connectorAccountFixture({
        id: "connector_gmail_corrective",
        userId: user.id,
        connectorKey: "gmail",
        displayName: "Gmail Account",
        settings: { googleEmail: "corrective@example.invalid" }
      }),
      connectorAccountFixture({
        id: "connector_calendar_corrective",
        userId: user.id,
        connectorKey: "google-calendar",
        displayName: "Calendar Account",
        settings: { googleCalendarSummary: "Operatory calendar" }
      })
    ],
    webhooks: [
      {
        id: "webhook_corrective",
        userId: user.id,
        name: "Clinical intake webhook",
        slug: "clinical-intake",
        destination: "notification",
        secretHash: "hidden",
        status: "enabled",
        ingestUrl: "/v1/ingest/webhooks/clinical-intake",
        createdAt: now,
        updatedAt: now,
        lastTriggeredAt: null
      }
    ],
    notifications: [
      notificationFixture({
        id: "notification_suppressed_corrective",
        title: "Suppressed insurance update",
        summary: "Below threshold"
      })
    ].map((notification) => ({ ...notification, status: "suppressed" })),
    reprocessRequests: [] as Array<{ timezone: string; accountId: string | null }>,
    gmailRefetchRequests: 0,
    failNextFolderCreate: false,
    reprocessAttempts: 0
  };

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
    if (method === "GET" && path === "/v1/events") {
      await route.fulfill({
        status: 200,
        headers: { ...corsHeaders(), "Content-Type": "text/event-stream" },
        body: ""
      });
      return;
    }
    if (method === "GET" && path === "/v1/notes") {
      const search = (url.searchParams.get("search") ?? "").toLowerCase();
      await fulfillJson(route, {
        notes: state.notes.filter((note) => note.title.toLowerCase().includes(search)),
        folders: state.folders,
        tags: state.tags
      });
      return;
    }
    if (method === "POST" && path === "/v1/folders") {
      if (state.failNextFolderCreate) {
        state.failNextFolderCreate = false;
        await fulfillJson(
          route,
          { error: { code: "folder_exists", message: "Folder name already exists" } },
          409
        );
        return;
      }
      const body = (await request.postDataJSON()) as { name: string };
      const folder = {
        id: `folder_${body.name.toLowerCase().replaceAll(/\s+/g, "_")}`,
        userId: user.id,
        name: body.name,
        createdAt: now,
        updatedAt: now
      };
      state.folders = [...state.folders, folder];
      await fulfillJson(route, folder, 201);
      return;
    }
    if (method === "PATCH" && path.startsWith("/v1/folders/")) {
      const folderId = path.split("/").pop();
      const body = (await request.postDataJSON()) as { patch: { name?: string } };
      state.folders = state.folders.map((folder) =>
        folder.id === folderId ? { ...folder, name: body.patch.name ?? folder.name } : folder
      );
      await fulfillJson(
        route,
        state.folders.find((folder) => folder.id === folderId)
      );
      return;
    }
    if (method === "DELETE" && path.startsWith("/v1/folders/")) {
      const folderId = path.split("/").pop();
      state.folders = state.folders.filter((folder) => folder.id !== folderId);
      state.notes = state.notes.map((note) =>
        note.folderId === folderId ? { ...note, folderId: null, version: note.version + 1 } : note
      );
      await fulfillJson(route, { ok: true });
      return;
    }
    if (method === "PATCH" && path.startsWith("/v1/notes/")) {
      const noteId = path.split("/").pop();
      const body = (await request.postDataJSON()) as {
        expectedVersion: number;
        patch: { folderId?: string | null };
      };
      let updated = state.notes.find((note) => note.id === noteId);
      state.notes = state.notes.map((note) => {
        if (note.id !== noteId) return note;
        updated = {
          ...note,
          ...body.patch,
          version: note.version + 1,
          updatedAt: now
        };
        return updated;
      });
      await fulfillJson(route, updated);
      return;
    }
    if (method === "GET" && path === "/v1/preferences") {
      await fulfillJson(route, state.preferences);
      return;
    }
    if (method === "PATCH" && path === "/v1/preferences") {
      const body = (await request.postDataJSON()) as {
        patch: { timezone?: typeof state.preferences.timezone; ai?: typeof state.preferences.ai };
      };
      state.preferences = {
        timezone: { ...state.preferences.timezone, ...(body.patch.timezone ?? {}) },
        ai: { ...state.preferences.ai, ...(body.patch.ai ?? {}) }
      };
      await fulfillJson(route, state.preferences);
      return;
    }
    if (method === "GET" && path === "/v1/connectors/accounts") {
      await fulfillJson(route, { accounts: state.accounts });
      return;
    }
    if (method === "GET" && path === "/v1/webhooks") {
      await fulfillJson(route, { webhooks: state.webhooks });
      return;
    }
    if (method === "GET" && path === "/v1/notifications") {
      const search = (url.searchParams.get("search") ?? "").toLowerCase();
      const includeSuppressed = url.searchParams.get("includeSuppressed") === "true";
      await fulfillJson(route, {
        notifications: state.notifications.filter((notification) => {
          const item = notification as { title: string; summary: string; status: string };
          const matches = `${item.title} ${item.summary}`.toLowerCase().includes(search);
          return matches && (includeSuppressed || item.status !== "suppressed");
        })
      });
      return;
    }
    if (method === "GET" && path === "/v1/calendar/events") {
      await fulfillJson(route, { events: [] });
      return;
    }
    if (method === "GET" && path === "/v1/ai/settings") {
      await fulfillJson(route, {
        enabled: true,
        available: true,
        provider: "openai",
        model: "gpt-test-mini",
        maxInputChars: 6000,
        unavailableReason: null,
        requestsThisMonth: 0,
        inputCharsThisMonth: 0,
        outputTokensThisMonth: 0,
        failedRequestsThisMonth: 0,
        estimatedCostThisMonth: null
      });
      return;
    }
    if (method === "POST" && path === "/v1/ai/reprocess") {
      const body = (await request.postDataJSON()) as { timezone: string; accountId?: string };
      state.reprocessRequests.push({
        timezone: body.timezone,
        accountId: body.accountId ?? null
      });
      state.reprocessAttempts += 1;
      await fulfillJson(
        route,
        {
          startedAt: now,
          completedAt: now,
          status: state.reprocessAttempts === 1 ? "partial" : "success",
          timezone: body.timezone,
          accountId: body.accountId ?? null,
          scanned: 2,
          processed: state.reprocessAttempts === 1 ? 1 : 2,
          updated: state.reprocessAttempts === 1 ? 1 : 2,
          suppressed: state.reprocessAttempts === 1 ? 1 : 2,
          restored: 0,
          skipped: 0,
          failed: state.reprocessAttempts === 1 ? 1 : 0,
          errors:
            state.reprocessAttempts === 1
              ? [
                  {
                    sourceRecordId: "source_failed",
                    messageId: "gmail-failed",
                    error: "AI provider timeout"
                  }
                ]
              : []
        },
        202
      );
      return;
    }
    if (
      method === "GET" &&
      (path.includes("/gmail/") || path.includes("/source-records") || path.includes("/backfill"))
    ) {
      state.gmailRefetchRequests += 1;
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

  return state;
}

async function settleMutation(page: Page): Promise<void> {
  await page.waitForTimeout(500);
  await expect(page.getByRole("alert")).toHaveCount(0);
}

function noteFixture(input: {
  id: string;
  userId: string;
  title: string;
  folderId: string | null;
}) {
  return {
    id: input.id,
    userId: input.userId,
    kind: "task",
    title: input.title,
    body: "",
    folderId: input.folderId,
    tags: [],
    dueAt: null,
    priority: "none",
    pinned: false,
    status: "active",
    globalOrder: input.folderId ? 1000 : 2000,
    sourceUrl: null,
    version: 1,
    createdAt: "2026-07-15T16:00:00.000Z",
    updatedAt: "2026-07-15T16:00:00.000Z",
    completedAt: null
  };
}

function connectorAccountFixture(input: {
  id: string;
  userId: string;
  connectorKey: "gmail" | "google-calendar";
  displayName: string;
  settings: Record<string, unknown>;
}) {
  return {
    id: input.id,
    userId: input.userId,
    connectorKey: input.connectorKey,
    displayName: input.displayName,
    status: "connected",
    healthStatus: "healthy",
    syncStatus: "idle",
    settings: input.settings,
    credentialRef: `credential_${input.id}`,
    credentialStatus: "configured",
    syncCursor: null,
    lastSyncAt: null,
    nextSyncAt: null,
    lastHealthAt: "2026-07-15T16:00:00.000Z",
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-07-15T16:00:00.000Z",
    updatedAt: "2026-07-15T16:00:00.000Z",
    version: 1
  };
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
    dismissedAt: null,
    email: {
      accountId: "connector_gmail_browser_refresh",
      provider: "gmail",
      providerMessageId: "x-gm-msgid:test",
      messageId: "<browser-message@example.test>",
      xGmMsgId: "test",
      senderAddress: "sender@example.com",
      senderDisplayName: "Sender Example",
      recipients: ["gmail-refresh@example.invalid"],
      subject: input.title,
      receivedAt: input.createdAt ?? timestamp,
      labels: ["INBOX"],
      unread: true,
      automatedSender: false,
      mailingList: false,
      attachments: [],
      snippet: input.summary,
      normalizedBodyHash: "hash",
      sourceUrl: "https://mail.google.com/mail/u/0/#inbox/test-message"
    },
    rule: {
      ruleId: "browser-rule-high-priority",
      ruleName: "High priority example.com",
      action: "high_priority",
      category: null,
      tag: null,
      explanation: "High priority rule matched: High priority example.com"
    },
    ai: {
      status: "complete",
      model: "gpt-test-mini",
      promptVersion: "email-summary-v1",
      processedAt: input.updatedAt ?? timestamp,
      inputChars: 1200,
      outputTokens: 42,
      contentHash: "content-hash",
      summary: input.summary,
      category: "action_required",
      importance: 90,
      requiresAction: true,
      suggestedAction: "Review",
      deadline: null,
      reason: "The message needs review.",
      errorCode: null,
      errorMessage: null
    }
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
