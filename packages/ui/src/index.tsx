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
};

export function NotesWorkspace(props: NotesWorkspaceProps): ReactElement {
  const [draft, setDraft] = useState<NoteInput>({
    kind: "task",
    title: "",
    priority: "none",
    tagIds: []
  });
  const [folderName, setFolderName] = useState("");
  const [tagName, setTagName] = useState("");
  const sortedNotes = useMemo(() => [...props.notes].sort(compareNotes), [props.notes]);

  return (
    <main className="notes-shell">
      <aside className="notes-sidebar" aria-label="Note filters">
        <label className="field">
          <span>Search</span>
          <input
            value={props.search}
            onChange={(event) => props.onSearchChange(event.currentTarget.value)}
          />
        </label>

        <section>
          <h2>Folders</h2>
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
          <button
            className={!props.selectedFolderId ? "selected" : ""}
            onClick={() => props.onFolderChange(null)}
          >
            All notes
          </button>
          {props.folders.map((folder) => (
            <button
              key={folder.id}
              className={props.selectedFolderId === folder.id ? "selected" : ""}
              onClick={() => props.onFolderChange(folder.id)}
            >
              {folder.name}
            </button>
          ))}
        </section>

        <section>
          <h2>Tags</h2>
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
        </section>
      </aside>

      <section className="notes-main">
        <form
          className="note-composer"
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.title.trim().length === 0) return;
            void props.onCreateNote(draft);
            setDraft({ kind: "task", title: "", priority: "none", tagIds: [] });
          }}
        >
          <select
            value={draft.kind}
            onChange={(event) =>
              setDraft({ ...draft, kind: event.currentTarget.value as NoteInput["kind"] })
            }
          >
            <option value="task">Task</option>
            <option value="reference">Reference</option>
          </select>
          <input
            aria-label="New note title"
            placeholder="New note"
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.currentTarget.value })}
          />
          <select
            value={draft.priority}
            onChange={(event) =>
              setDraft({ ...draft, priority: event.currentTarget.value as NoteInput["priority"] })
            }
          >
            <option value="none">No priority</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
          <button type="submit">Add</button>
        </form>

        <div className="note-list" aria-label="Notes">
          {sortedNotes.map((note, index) => (
            <article
              key={note.id}
              className={`note-card ${note.status === "done" ? "done" : ""}`}
              draggable
            >
              <div className="note-card-top">
                <input
                  aria-label={`Mark ${note.title} done`}
                  type="checkbox"
                  checked={note.status === "done"}
                  disabled={note.kind !== "task"}
                  onChange={(event) =>
                    void props.onUpdateNote(note, {
                      status: event.currentTarget.checked ? "done" : "active"
                    })
                  }
                />
                <input
                  className="note-title"
                  value={note.title}
                  onChange={(event) =>
                    void props.onUpdateNote(note, { title: event.currentTarget.value })
                  }
                />
                <button
                  aria-label={note.pinned ? "Unpin note" : "Pin note"}
                  onClick={() => void props.onUpdateNote(note, { pinned: !note.pinned })}
                >
                  {note.pinned ? "Pinned" : "Pin"}
                </button>
              </div>
              <textarea
                value={note.body}
                onChange={(event) =>
                  void props.onUpdateNote(note, { body: event.currentTarget.value })
                }
              />
              <div className="note-meta">
                <span>{note.kind}</span>
                <label>
                  Priority
                  <select
                    aria-label={`Priority for ${note.title}`}
                    value={note.priority}
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
                  disabled={index === 0}
                  onClick={() => {
                    const next = move(sortedNotes, index, index - 1);
                    void props.onReorderNotes(next);
                  }}
                >
                  Up
                </button>
                <button
                  disabled={index === sortedNotes.length - 1}
                  onClick={() => {
                    const next = move(sortedNotes, index, index + 1);
                    void props.onReorderNotes(next);
                  }}
                >
                  Down
                </button>
                <button onClick={() => void props.onDeleteNote(note)}>Delete</button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
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
