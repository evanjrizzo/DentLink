import { useMemo, useState, type ReactElement } from "react";

import { DentLinkApiClient, DentLinkApiError } from "@dentlink/api-client";
import type {
  AuthSession,
  EntityId,
  Note,
  NoteInput,
  NotePatch,
  NotesList
} from "@dentlink/item-model";
import { NotesWorkspace } from "@dentlink/ui";

const initialList: NotesList = { notes: [], folders: [], tags: [] };

export function DentLinkNotesApp(): ReactElement {
  const [client] = useState(
    () => new DentLinkApiClient({ baseUrl: import.meta.env.VITE_DENTLINK_API_BASE_URL ?? "" })
  );
  const [auth, setAuth] = useState<AuthSession | null>(null);
  const [credentials, setCredentials] = useState({ email: "", password: "" });
  const [notesList, setNotesList] = useState<NotesList>(initialList);
  const [search, setSearch] = useState("");
  const [folderId, setFolderId] = useState<EntityId | null>(null);
  const [tagIds, setTagIds] = useState<EntityId[]>([]);
  const [error, setError] = useState<string | null>(null);

  const filteredNotes = useMemo(() => notesList.notes, [notesList.notes]);

  async function loadNotes(
    nextSearch = search,
    nextFolderId = folderId,
    nextTagIds = tagIds
  ): Promise<void> {
    const response = await client.listNotes({
      search: nextSearch || undefined,
      folderId: nextFolderId ?? undefined,
      tagIds: nextTagIds
    });
    setNotesList(response);
  }

  async function authenticate(mode: "login" | "register"): Promise<void> {
    try {
      setError(null);
      const session =
        mode === "login"
          ? await client.login(credentials.email, credentials.password)
          : await client.register(credentials.email, credentials.password);
      setAuth(session);
      await loadNotes("", null, []);
    } catch (caught) {
      handleFailure(caught);
    }
  }

  async function createNote(input: NoteInput): Promise<void> {
    try {
      await client.createNote(input);
      await loadNotes();
    } catch (caught) {
      handleFailure(caught);
    }
  }

  async function updateNote(note: Note, patch: NotePatch): Promise<void> {
    const previous = notesList;
    setNotesList({
      ...notesList,
      notes: notesList.notes.map((item) =>
        item.id === note.id ? { ...item, ...patch, version: item.version + 1 } : item
      )
    });
    try {
      await client.updateNote(note.id, note.version, patch);
      await loadNotes();
    } catch (caught) {
      setNotesList(previous);
      handleFailure(caught);
    }
  }

  async function reorderNotes(orderedNotes: Note[]): Promise<void> {
    const previous = notesList;
    const noteOrders = orderedNotes.map((note, index) => ({
      id: note.id,
      expectedVersion: note.version,
      globalOrder: (index + 1) * 1000
    }));
    setNotesList({
      ...notesList,
      notes: orderedNotes.map((note, index) => ({ ...note, globalOrder: (index + 1) * 1000 }))
    });
    try {
      await client.reorderNotes(noteOrders);
      await loadNotes();
    } catch (caught) {
      setNotesList(previous);
      handleFailure(caught);
    }
  }

  function handleFailure(caught: unknown): void {
    if (caught instanceof DentLinkApiError && caught.status === 401) {
      client.setToken(null);
      setAuth(null);
    }
    setError(messageFor(caught));
  }

  if (!auth) {
    return (
      <main className="auth-screen">
        <form
          className="auth-panel"
          onSubmit={(event) => {
            event.preventDefault();
            void authenticate("login");
          }}
        >
          <h1>DentLink Notes</h1>
          <label>
            Email
            <input
              type="email"
              value={credentials.email}
              onChange={(event) =>
                setCredentials({ ...credentials, email: event.currentTarget.value })
              }
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={credentials.password}
              onChange={(event) =>
                setCredentials({ ...credentials, password: event.currentTarget.value })
              }
            />
          </label>
          {error ? <p role="alert">{error}</p> : null}
          <div className="auth-actions">
            <button type="submit">Log in</button>
            <button type="button" onClick={() => void authenticate("register")}>
              Register
            </button>
          </div>
        </form>
      </main>
    );
  }

  return (
    <>
      <header className="app-header">
        <strong>DentLink Notes</strong>
        <span>{auth.user.email}</span>
      </header>
      {error ? (
        <p className="app-error" role="alert">
          {error}
        </p>
      ) : null}
      <NotesWorkspace
        notes={filteredNotes}
        folders={notesList.folders}
        tags={notesList.tags}
        selectedFolderId={folderId}
        selectedTagIds={tagIds}
        search={search}
        onSearchChange={(nextSearch) => {
          setSearch(nextSearch);
          void loadNotes(nextSearch, folderId, tagIds);
        }}
        onFolderChange={(nextFolderId) => {
          setFolderId(nextFolderId);
          void loadNotes(search, nextFolderId, tagIds);
        }}
        onTagToggle={(tagId) => {
          const nextTagIds = tagIds.includes(tagId)
            ? tagIds.filter((item) => item !== tagId)
            : [...tagIds, tagId];
          setTagIds(nextTagIds);
          void loadNotes(search, folderId, nextTagIds);
        }}
        onCreateNote={createNote}
        onUpdateNote={updateNote}
        onReorderNotes={reorderNotes}
      />
    </>
  );
}

function messageFor(caught: unknown): string {
  if (caught instanceof DentLinkApiError) return caught.message;
  if (caught instanceof Error) return caught.message;
  return "Something went wrong";
}
