import { describe, expect, it } from "vitest";

import {
  ACCOUNT_ARCHIVE_KEY_ID,
  archiveEligibleNotifications,
  archiveNotificationCandidates,
  buildAssistantArchiveNotificationContext,
  decryptNotificationArchive,
  encryptNotificationArchive,
  getOrCreateAccountArchiveKey,
  readArchivedNotifications,
  selectAssistantArchiveNotifications,
  type ArchiveClient
} from "./archive";

import type {
  ArchiveKeyWrapper,
  ArchiveObjectEnvelope,
  ArchiveObjectInput,
  ArchiveObjectMetadata,
  Notification
} from "@dentlink/item-model";

describe("@dentlink/web archive crypto", () => {
  it("reuses one account archive key across dashboard instances and restores a fake notification", async () => {
    const backend = new FakeArchiveBackend();
    const firstDashboard = backend.client();
    const secondDashboard = backend.client();
    const recoverySecret = "same user-held recovery secret";

    const firstKey = await getOrCreateAccountArchiveKey(firstDashboard, recoverySecret);
    const secondKey = await getOrCreateAccountArchiveKey(secondDashboard, recoverySecret);
    const fakeNotification = notificationFixture();
    const write = await encryptNotificationArchive(firstDashboard, firstKey, fakeNotification);
    const envelope = backend.envelopes.get(write.object.id);
    expect(envelope).toBeDefined();
    expect(JSON.stringify(envelope)).not.toContain(fakeNotification.title);
    expect(JSON.stringify(envelope)).not.toContain(fakeNotification.summary);
    expect(JSON.stringify(envelope)).not.toContain(fakeNotification.body);

    const restored = await decryptNotificationArchive(secondKey, envelope as ArchiveObjectEnvelope);

    expect(firstKey.created).toBe(true);
    expect(secondKey.created).toBe(false);
    expect(backend.wrappers).toHaveLength(1);
    expect(backend.wrappers[0]?.keyId).toBe(ACCOUNT_ARCHIVE_KEY_ID);
    expect(restored).toEqual(fakeNotification);
  });

  it("reads archived fake notifications from a second dashboard without exposing plaintext", async () => {
    const backend = new FakeArchiveBackend();
    const firstDashboard = backend.client();
    const secondDashboard = backend.client();
    const recoverySecret = "same user-held recovery secret";
    const firstKey = await getOrCreateAccountArchiveKey(firstDashboard, recoverySecret);
    const fakeNotifications = [
      notificationFixture({ id: "notification_archive_read_1", title: "Private fake one" }),
      notificationFixture({ id: "notification_archive_read_2", title: "Private fake two" })
    ];

    for (const notification of fakeNotifications) {
      await encryptNotificationArchive(firstDashboard, firstKey, notification);
    }

    const secondKey = await getOrCreateAccountArchiveKey(secondDashboard, recoverySecret);
    const restored = await readArchivedNotifications(secondDashboard, secondKey);

    expect(restored).toMatchObject({
      scanned: 2,
      skippedUnsupported: 0,
      errors: []
    });
    expect(restored.notifications).toEqual(fakeNotifications);
    for (const envelope of backend.envelopes.values()) {
      const serialized = JSON.stringify(envelope);
      expect(serialized).not.toContain("Private fake one");
      expect(serialized).not.toContain("Private fake two");
    }
  });

  it("does not unwrap the account archive key with the wrong recovery secret", async () => {
    const backend = new FakeArchiveBackend();
    await getOrCreateAccountArchiveKey(backend.client(), "correct recovery secret");

    await expect(
      getOrCreateAccountArchiveKey(backend.client(), "wrong recovery secret")
    ).rejects.toThrow();
  });

  it("keeps the automatic notification archive writer disabled by default", async () => {
    const backend = new FakeArchiveBackend();
    const result = await archiveEligibleNotifications(
      backend.client(),
      [notificationFixture({ status: "dismissed", dismissedAt: "2026-06-01T00:00:00.000Z" })],
      {
        enabled: false,
        recoverySecret: "same user-held recovery secret",
        now: new Date("2026-07-29T00:00:00.000Z")
      }
    );

    expect(result).toMatchObject({ enabled: false, archived: 0 });
    expect(backend.wrappers).toHaveLength(0);
    expect(backend.envelopes.size).toBe(0);
  });

  it("archives only old completed or dismissed notification candidates without duplicating writes", async () => {
    const backend = new FakeArchiveBackend();
    const client = backend.client();
    const now = new Date("2026-07-29T00:00:00.000Z");
    const oldDone = notificationFixture({
      id: "notification_old_done",
      status: "done",
      completedAt: "2026-06-01T00:00:00.000Z"
    });
    const oldDismissed = notificationFixture({
      id: "notification_old_dismissed",
      status: "dismissed",
      dismissedAt: "2026-06-01T00:00:00.000Z"
    });
    const active = notificationFixture({ id: "notification_active", status: "active" });
    const recentDone = notificationFixture({
      id: "notification_recent_done",
      status: "done",
      completedAt: "2026-07-25T00:00:00.000Z"
    });
    const pinnedDone = notificationFixture({
      id: "notification_pinned_done",
      status: "done",
      pinned: true,
      completedAt: "2026-06-01T00:00:00.000Z"
    });
    const notifications = [oldDone, oldDismissed, active, recentDone, pinnedDone];

    expect(archiveNotificationCandidates(notifications, 30, now).map((item) => item.id)).toEqual([
      "notification_old_done",
      "notification_old_dismissed"
    ]);
    const first = await archiveEligibleNotifications(client, notifications, {
      enabled: true,
      recoverySecret: "same user-held recovery secret",
      minAgeDays: 30,
      maxWrites: 10,
      now
    });
    const second = await archiveEligibleNotifications(client, notifications, {
      enabled: true,
      recoverySecret: "same user-held recovery secret",
      minAgeDays: 30,
      maxWrites: 10,
      now
    });

    expect(first).toMatchObject({
      enabled: true,
      candidates: 2,
      archived: 2,
      skippedAlreadyArchived: 0,
      errors: []
    });
    expect(second).toMatchObject({
      enabled: true,
      candidates: 2,
      archived: 0,
      skippedAlreadyArchived: 2,
      errors: []
    });
    expect(backend.envelopes.size).toBe(2);
    for (const object of backend.objects.values()) {
      expect(object.verifiedAt).toBe("2026-07-29T00:00:00.000Z");
    }
    for (const envelope of backend.envelopes.values()) {
      const serialized = JSON.stringify(envelope);
      expect(serialized).not.toContain("Private fake notification");
      expect(serialized).not.toContain("Sensitive body");
    }
  });

  it("skips unsupported archive objects and reports malformed notification objects", async () => {
    const backend = new FakeArchiveBackend();
    const client = backend.client();
    const archiveKey = await getOrCreateAccountArchiveKey(client, "same user-held recovery secret");
    const readableNotification = notificationFixture({ id: "notification_readable" });
    const readableWrite = await encryptNotificationArchive(
      client,
      archiveKey,
      readableNotification
    );
    const malformedInput: ArchiveObjectInput = {
      objectType: "notification",
      sourceEntityType: "notification",
      sourceEntityId: "notification_malformed",
      encryptionAlgorithm: "AES-GCM-256",
      keyId: archiveKey.keyId,
      nonceB64: "AAAAAAAAAAAAAAAA",
      ciphertextSha256B64: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      ciphertextB64: "bm90LWFjdHVhbC1jaXBoZXJ0ZXh0",
      publicMetadata: { version: 1 }
    };
    const unsupportedInput: ArchiveObjectInput = {
      objectType: "note",
      sourceEntityType: "note",
      sourceEntityId: "note_1",
      encryptionAlgorithm: "AES-GCM-256",
      keyId: archiveKey.keyId,
      nonceB64: "AAAAAAAAAAAAAAAA",
      ciphertextSha256B64: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      ciphertextB64: "bm90LXJlYWQ=",
      publicMetadata: { version: 1 }
    };

    const malformed = await client.createArchiveObject(malformedInput);
    await client.createArchiveObject(unsupportedInput);

    const restored = await readArchivedNotifications(client, archiveKey);

    expect(restored.notifications).toEqual([readableNotification]);
    expect(restored.scanned).toBe(2);
    expect(restored.skippedUnsupported).toBe(1);
    expect(restored.errors).toHaveLength(1);
    expect(restored.errors[0]?.objectId).toBe(malformed.object.id);
    expect(restored.notifications[0]?.id).toBe(readableWrite.object.sourceEntityId);
  });

  it("selects matching decrypted archived notifications for assistant context", async () => {
    const fakeClownAlert = notificationFixture({
      id: "notification_clown_archive_test_1785345010",
      title: "Killer clowns on the rampage at the Cincinnati Zoo",
      summary: "Fake archive assistant test about killer clowns at the Cincinnati Zoo.",
      body: "This is not a real alert.",
      sourceLabel: "Archive Assistant Test",
      status: "done",
      completedAt: "2026-07-27T00:00:00.000Z"
    });
    const unrelated = notificationFixture({
      id: "notification_unrelated",
      title: "Normal archived notification",
      body: "Nothing unusual here."
    });

    const selected = selectAssistantArchiveNotifications(
      [unrelated, fakeClownAlert],
      "can you find any clowns?"
    );

    expect(selected).toEqual([
      expect.objectContaining({
        id: "notification_clown_archive_test_1785345010",
        title: "Killer clowns on the rampage at the Cincinnati Zoo",
        sourceLabel: "Archive Assistant Test",
        status: "done",
        sourceTimestamp: "2026-07-27T00:00:00.000Z"
      })
    ]);
  });

  it("builds assistant archive context from locally decrypted archive objects", async () => {
    const backend = new FakeArchiveBackend();
    const client = backend.client();
    const recoverySecret = "same user-held recovery secret";
    const archiveKey = await getOrCreateAccountArchiveKey(client, recoverySecret);
    const fakeClownAlert = notificationFixture({
      id: "notification_clown_archive_test_1785345010",
      title: "Killer clowns on the rampage at the Cincinnati Zoo",
      summary: "Fake archive assistant test about killer clowns at the Cincinnati Zoo.",
      body: "This is not a real alert.",
      status: "done",
      completedAt: "2026-07-27T00:00:00.000Z"
    });
    await encryptNotificationArchive(client, archiveKey, fakeClownAlert);

    const context = await buildAssistantArchiveNotificationContext(client, {
      recoverySecret,
      message: "find clowns",
      maxObjects: 10,
      maxItems: 3
    });

    expect(context).toEqual([
      expect.objectContaining({
        id: "notification_clown_archive_test_1785345010",
        title: "Killer clowns on the rampage at the Cincinnati Zoo",
        body: "This is not a real alert."
      })
    ]);
    expect(JSON.stringify([...backend.envelopes.values()])).not.toContain(
      "Killer clowns on the rampage"
    );
  });
});

class FakeArchiveBackend {
  readonly wrappers: ArchiveKeyWrapper[] = [];
  readonly envelopes = new Map<string, ArchiveObjectEnvelope>();
  readonly objects = new Map<string, ArchiveObjectMetadata>();

  client(): ArchiveClient {
    return {
      listArchiveKeyWrappers: async () => ({ wrappers: [...this.wrappers] }),
      createArchiveKeyWrapper: async (input) => {
        const now = "2026-07-29T00:00:00.000Z";
        const wrapper: ArchiveKeyWrapper = {
          id: `wrapper_${this.wrappers.length + 1}`,
          keyId: input.keyId,
          wrapperType: input.wrapperType,
          wrappingAlgorithm: input.wrappingAlgorithm,
          wrappedKeyB64: input.wrappedKeyB64,
          saltB64: input.saltB64 ?? null,
          publicMetadata: input.publicMetadata ?? {},
          createdAt: now,
          updatedAt: now
        };
        this.wrappers.push(wrapper);
        return { wrapper };
      },
      listArchiveObjects: async () => ({ objects: [...this.objects.values()] }),
      createArchiveObject: async (input) => {
        const id = `archive_object_${this.envelopes.size + 1}`;
        const now = "2026-07-29T00:00:00.000Z";
        const envelope = archiveEnvelope(id, input, now);
        this.envelopes.set(id, envelope);
        const object: ArchiveObjectMetadata = {
          id,
          objectType: input.objectType,
          sourceEntityType: input.sourceEntityType ?? null,
          sourceEntityId: input.sourceEntityId ?? null,
          encryptionAlgorithm: input.encryptionAlgorithm,
          keyId: input.keyId,
          nonceB64: input.nonceB64,
          ciphertextSha256B64: input.ciphertextSha256B64,
          sizeBytes: atob(input.ciphertextB64).length,
          verifiedAt: null,
          publicMetadata: input.publicMetadata ?? {},
          createdAt: now,
          updatedAt: now
        };
        this.objects.set(id, object);
        return { object };
      },
      getArchiveObject: async (objectId) => {
        const object = this.objects.get(objectId);
        const envelope = this.envelopes.get(objectId);
        if (!object || !envelope) throw new Error("Archive object not found");
        return { object, envelope };
      },
      verifyArchiveObject: async (objectId) => {
        const object = this.objects.get(objectId);
        if (!object) throw new Error("Archive object not found");
        const verified = {
          ...object,
          verifiedAt: "2026-07-29T00:00:00.000Z",
          updatedAt: "2026-07-29T00:00:00.000Z"
        };
        this.objects.set(objectId, verified);
        return { object: verified };
      }
    };
  }
}

function archiveEnvelope(
  id: string,
  input: ArchiveObjectInput,
  createdAt: string
): ArchiveObjectEnvelope {
  return {
    version: 1,
    id,
    objectType: input.objectType,
    sourceEntityType: input.sourceEntityType ?? null,
    sourceEntityId: input.sourceEntityId ?? null,
    encryption: {
      algorithm: input.encryptionAlgorithm,
      keyId: input.keyId,
      nonceB64: input.nonceB64,
      ciphertextSha256B64: input.ciphertextSha256B64
    },
    ciphertextB64: input.ciphertextB64,
    createdAt
  };
}

function notificationFixture(overrides: Partial<Notification> = {}): Notification {
  const now = "2026-07-29T00:00:00.000Z";
  return {
    id: "notification_fake_frontend",
    userId: "user_1",
    title: "Private fake notification",
    summary: "Frontend encrypted archive test summary",
    body: "Sensitive body only the dashboard should decrypt.",
    source: "manual",
    sourceLabel: "Test",
    sourceUrl: null,
    severity: "medium",
    status: "active",
    pinned: false,
    rank: 0,
    globalOrder: 1,
    version: 1,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    dismissedAt: null,
    email: null,
    rule: null,
    ai: {
      status: "disabled",
      model: null,
      promptVersion: null,
      processedAt: null,
      inputChars: null,
      outputTokens: null,
      contentHash: null,
      summary: null,
      category: null,
      importance: null,
      requiresAction: null,
      suggestedAction: null,
      deadline: null,
      reason: null,
      errorCode: null,
      errorMessage: null
    },
    ...overrides
  };
}
