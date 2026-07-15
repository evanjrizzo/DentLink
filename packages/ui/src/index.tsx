import { useMemo, useState, type ReactElement } from "react";

import type { EntityId, Folder, Note, NoteInput, NotePatch, Tag } from "@dentlink/item-model";

export type NotesWorkspaceProps = {
  notes: Note[];
  folders: Folder[];
  tags: Tag[];
  selectedFolderId: EntityId | null;
  selectedTagIds: EntityId[];
  search: string;
  onSearchChange: (search: string) => void;
  onFolderChange: (folderId: EntityId | null) => void;
  onTagToggle: (tagId: EntityId) => void;
  onCreateFolder: (name: string) => Promise<void> | void;
  onCreateTag: (name: string) => Promise<void> | void;
  onCreateNote: (input: NoteInput) => Promise<void> | void;
  onUpdateNote: (note: Note, patch: NotePatch) => Promise<void> | void;
  onDeleteNote: (note: Note) => Promise<void> | void;
  onReorderNotes: (orderedNotes: Note[]) => Promise<void> | void;
  updatingNoteIds?: EntityId[];
};

export function NotesWorkspace(props: NotesWorkspaceProps): ReactElement {
  const [draft, setDraft] = useState<NoteInput>({
    kind: "task",
    title: "",
    priority: "none",
    tagIds: []
  });
  const [composerOpen, setComposerOpen] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<EntityId | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [moreOptionsOpen, setMoreOptionsOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [tagName, setTagName] = useState("");
  const sortedNotes = useMemo(() => [...props.notes].sort(compareNotes), [props.notes]);
  const editingNote = sortedNotes.find((note) => note.id === editingNoteId) ?? null;

  async function submitDraft(): Promise<void> {
    if (draft.title.trim().length === 0) return;
    await props.onCreateNote(draft);
    setDraft({ kind: "task", title: "", priority: "none", tagIds: [] });
    setMoreOptionsOpen(false);
    setComposerOpen(false);
  }

  return (
    <main className="notes-shell notes-shell-compact">
      <section className="notes-main">
        <div className="notes-compact-toolbar">
          <button
            type="button"
            aria-label="Search notes"
            className={searchOpen ? "selected" : ""}
            onClick={() => setSearchOpen((open) => !open)}
          >
            Search
          </button>
          <details className="notes-filter-menu">
            <summary>Filters</summary>
            <label className="field">
              <span>Folder</span>
              <select
                aria-label="Folder filter"
                value={props.selectedFolderId ?? ""}
                onChange={(event) => props.onFolderChange(event.currentTarget.value || null)}
              >
                <option value="">All notes</option>
                {props.folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
            </label>
            {props.tags.map((tag) => (
              <label key={tag.id} className="check-row">
                <input
                  type="checkbox"
                  checked={props.selectedTagIds.includes(tag.id)}
                  onChange={() => props.onTagToggle(tag.id)}
                />
                <span>{tag.name}</span>
              </label>
            ))}
            <details className="management-menu">
              <summary>Manage folders and tags</summary>
              <form
                className="inline-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!folderName.trim()) return;
                  void props.onCreateFolder(folderName);
                  setFolderName("");
                }}
              >
                <input
                  aria-label="New folder name"
                  placeholder="New folder"
                  value={folderName}
                  onChange={(event) => setFolderName(event.currentTarget.value)}
                />
                <button type="submit">Add</button>
              </form>
              <form
                className="inline-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!tagName.trim()) return;
                  void props.onCreateTag(tagName);
                  setTagName("");
                }}
              >
                <input
                  aria-label="New tag name"
                  placeholder="New tag"
                  value={tagName}
                  onChange={(event) => setTagName(event.currentTarget.value)}
                />
                <button type="submit">Add</button>
              </form>
            </details>
          </details>
          {props.selectedFolderId ? (
            <span className="filter-chip">
              {props.folders.find((folder) => folder.id === props.selectedFolderId)?.name ??
                "Folder"}
            </span>
          ) : null}
          {props.selectedTagIds.length > 0 ? (
            <span className="filter-chip">{props.selectedTagIds.length} tag filter</span>
          ) : null}
        </div>

        {searchOpen || props.search ? (
          <label className="field notes-search-field">
            <span>Search</span>
            <input
              value={props.search}
              onChange={(event) => props.onSearchChange(event.currentTarget.value)}
            />
          </label>
        ) : null}

        <div className="note-list" aria-label="Notes">
          {sortedNotes.map((note) => (
            <NoteCard key={note.id} note={note} onOpenDetails={setEditingNoteId} {...props} />
          ))}
        </div>
      </section>
      <button
        type="button"
        className="floating-action-button"
        aria-label="Create note"
        onClick={() => setComposerOpen(true)}
      >
        +
      </button>
      {composerOpen ? (
        <div
          className="adaptive-overlay"
          role="presentation"
          onClick={() => setComposerOpen(false)}
        >
          <section
            className="adaptive-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Create note"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sheet-header">
              <h2>Create Note</h2>
              <button
                type="button"
                className="icon-button"
                aria-label="Close create note"
                title="Close"
                onClick={() => setComposerOpen(false)}
              >
                <span aria-hidden="true">x</span>
              </button>
            </div>
            <form
              className="sheet-form"
              onSubmit={(event) => {
                event.preventDefault();
                void submitDraft();
              }}
            >
              <label>
                Type
                <select
                  value={draft.kind}
                  onChange={(event) =>
                    setDraft({ ...draft, kind: event.currentTarget.value as NoteInput["kind"] })
                  }
                >
                  <option value="task">Task</option>
                  <option value="reference">Reference</option>
                </select>
              </label>
              <label>
                Title
                <input
                  aria-label="New note title"
                  placeholder="New note"
                  value={draft.title}
                  onChange={(event) => setDraft({ ...draft, title: event.currentTarget.value })}
                />
              </label>
              <details
                open={moreOptionsOpen}
                onToggle={(event) => setMoreOptionsOpen(event.currentTarget.open)}
              >
                <summary>More Options</summary>
                <label>
                  Priority
                  <select
                    value={draft.priority}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        priority: event.currentTarget.value as NoteInput["priority"]
                      })
                    }
                  >
                    <option value="none">No priority</option>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </label>
              </details>
              <button type="submit">Create</button>
            </form>
          </section>
        </div>
      ) : null}
      {editingNote ? (
        <NoteDetailsPanel
          note={editingNote}
          sortedNotes={sortedNotes}
          {...props}
          onClose={() => setEditingNoteId(null)}
        />
      ) : null}
    </main>
  );
}

function NoteCard(
  props: NotesWorkspaceProps & {
    note: Note;
    onOpenDetails: (id: EntityId) => void;
  }
): ReactElement {
  const { note } = props;
  const disabled = props.updatingNoteIds?.includes(note.id) ?? false;
  const folderName = note.folderId
    ? props.folders.find((folder) => folder.id === note.folderId)?.name
    : null;
  return (
    <article
      aria-label={`Note ${note.title}`}
      className={`note-card compact-note-card ${note.status === "done" ? "done" : ""}`}
      draggable
    >
      <div className="note-card-top">
        <input
          aria-label={`Mark ${note.title} done`}
          type="checkbox"
          checked={note.status === "done"}
          disabled={disabled || note.kind !== "task"}
          onChange={(event) =>
            void props.onUpdateNote(note, {
              status: event.currentTarget.checked ? "done" : "active"
            })
          }
        />
        <button
          type="button"
          className="note-title-button"
          onClick={() => props.onOpenDetails(note.id)}
        >
          <strong>{note.title}</strong>
          {note.body ? <span>{note.body}</span> : null}
        </button>
        <button
          aria-label={note.pinned ? "Unpin note" : "Pin note"}
          disabled={disabled}
          onClick={() => void props.onUpdateNote(note, { pinned: !note.pinned })}
        >
          {note.pinned ? "Pinned" : "Pin"}
        </button>
      </div>
      <div className="note-meta">
        <span>{note.kind}</span>
        {note.priority !== "none" ? <span>{note.priority}</span> : null}
        {note.dueAt ? <span>Due {new Date(note.dueAt).toLocaleDateString()}</span> : null}
        {folderName ? <span>{folderName}</span> : null}
        {note.tags.length > 0 ? <span>{note.tags.map((tag) => tag.name).join(", ")}</span> : null}
      </div>
    </article>
  );
}

function NoteDetailsPanel(
  props: NotesWorkspaceProps & { note: Note; sortedNotes: Note[]; onClose: () => void }
): ReactElement {
  const { note, sortedNotes } = props;
  const index = sortedNotes.findIndex((item) => item.id === note.id);
  const disabled = props.updatingNoteIds?.includes(note.id) ?? false;
  return (
    <div className="adaptive-overlay" role="presentation" onClick={props.onClose}>
      <section
        className="adaptive-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`Note details ${note.title}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet-header">
          <h2>Note Details</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close note details"
            title="Close"
            onClick={props.onClose}
          >
            <span aria-hidden="true">x</span>
          </button>
        </div>
        <div className="sheet-form">
          <label>
            Title
            <input
              className="note-title"
              value={note.title}
              disabled={disabled}
              onChange={(event) =>
                void props.onUpdateNote(note, { title: event.currentTarget.value })
              }
            />
          </label>
          <label>
            Body
            <textarea
              value={note.body}
              disabled={disabled}
              onChange={(event) =>
                void props.onUpdateNote(note, { body: event.currentTarget.value })
              }
            />
          </label>
          <details>
            <summary>More Options</summary>
            <div className="note-meta note-meta-panel">
              <span>{note.kind}</span>
              <label>
                Priority
                <select
                  aria-label={`Priority for ${note.title}`}
                  value={note.priority}
                  disabled={disabled}
                  onChange={(event) =>
                    void props.onUpdateNote(note, {
                      priority: event.currentTarget.value as NoteInput["priority"]
                    })
                  }
                >
                  <option value="none">None</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>
              <label>
                Folder
                <select
                  aria-label={`Folder for ${note.title}`}
                  value={note.folderId ?? ""}
                  disabled={disabled}
                  onChange={(event) =>
                    void props.onUpdateNote(note, {
                      folderId: event.currentTarget.value || null
                    })
                  }
                >
                  <option value="">No folder</option>
                  {props.folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Due
                <input
                  aria-label={`Due date for ${note.title}`}
                  type="date"
                  value={note.dueAt?.slice(0, 10) ?? ""}
                  disabled={disabled}
                  onChange={(event) =>
                    void props.onUpdateNote(note, {
                      dueAt: event.currentTarget.value
                        ? `${event.currentTarget.value}T00:00:00.000Z`
                        : null
                    })
                  }
                />
              </label>
              {props.tags.map((tag) => (
                <label key={tag.id} className="check-row">
                  <input
                    aria-label={`${tag.name} tag for ${note.title}`}
                    type="checkbox"
                    checked={note.tags.some((item) => item.id === tag.id)}
                    disabled={disabled}
                    onChange={(event) => {
                      const tagIds = event.currentTarget.checked
                        ? [...note.tags.map((item) => item.id), tag.id]
                        : note.tags.filter((item) => item.id !== tag.id).map((item) => item.id);
                      void props.onUpdateNote(note, { tagIds });
                    }}
                  />
                  <span>{tag.name}</span>
                </label>
              ))}
            </div>
            <div className="note-order">
              <button
                disabled={disabled || index <= 0}
                onClick={() => {
                  const next = move(sortedNotes, index, index - 1);
                  void props.onReorderNotes(next);
                }}
              >
                Up
              </button>
              <button
                disabled={disabled || index < 0 || index === sortedNotes.length - 1}
                onClick={() => {
                  const next = move(sortedNotes, index, index + 1);
                  void props.onReorderNotes(next);
                }}
              >
                Down
              </button>
              <button disabled={disabled} onClick={() => void props.onDeleteNote(note)}>
                Delete
              </button>
            </div>
          </details>
        </div>
      </section>
    </div>
  );
}

function compareNotes(left: Note, right: Note): number {
  if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
  return left.globalOrder - right.globalOrder;
}

function move<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}
