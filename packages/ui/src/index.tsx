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
  onCreateNote: (input: NoteInput) => Promise<void> | void;
  onUpdateNote: (note: Note, patch: NotePatch) => Promise<void> | void;
  onReorderNotes: (orderedNotes: Note[]) => Promise<void> | void;
};

export function NotesWorkspace(props: NotesWorkspaceProps): ReactElement {
  const [draft, setDraft] = useState<NoteInput>({
    kind: "task",
    title: "",
    priority: "none",
    tagIds: []
  });
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
                <span>{note.priority}</span>
                {note.folderId ? (
                  <span>{props.folders.find((folder) => folder.id === note.folderId)?.name}</span>
                ) : null}
                {note.tags.map((tag) => (
                  <span key={tag.id}>{tag.name}</span>
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
