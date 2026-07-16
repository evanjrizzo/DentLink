import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";

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
  onUpdateFolder?: (folderId: EntityId, name: string) => Promise<void> | void;
  onDeleteFolder?: (folderId: EntityId) => Promise<void> | void;
  onCreateTag: (name: string) => Promise<void> | void;
  onUpdateTag?: (tagId: EntityId, name: string) => Promise<void> | void;
  onDeleteTag?: (tagId: EntityId) => Promise<void> | void;
  onCreateNote: (input: NoteInput) => Promise<void> | void;
  onUpdateNote: (note: Note, patch: NotePatch) => Promise<void> | void;
  onDeleteNote: (note: Note) => Promise<void> | void;
  onReorderNotes: (orderedNotes: Note[]) => Promise<void> | void;
  updatingNoteIds?: EntityId[];
  openNoteId?: EntityId | null;
};

const NOTE_TITLE_LIMIT = 72;
const UNFILED_FOLDER_ID = "__unfiled";

export function NotesWorkspace(props: NotesWorkspaceProps): ReactElement {
  const [draft, setDraft] = useState<NoteInput>({
    kind: "task",
    title: "",
    priority: "none",
    tagIds: []
  });
  const [composerOpen, setComposerOpen] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<EntityId | null>(null);
  const [moreOptionsOpen, setMoreOptionsOpen] = useState(true);
  const [folderName, setFolderName] = useState("");
  const [tagName, setTagName] = useState("");
  const [expandedFolders, setExpandedFolders] = useState<EntityId[]>([UNFILED_FOLDER_ID]);
  const [renamingFolderId, setRenamingFolderId] = useState<EntityId | null>(null);
  const [folderDraftName, setFolderDraftName] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [draggedNoteId, setDraggedNoteId] = useState<EntityId | null>(null);
  const sortedNotes = useMemo(() => [...props.notes].sort(compareNotes), [props.notes]);
  const searchActive = props.search.trim().length > 0;
  const displayedNotes = sortedNotes.filter((note) =>
    props.selectedFolderId === null
      ? true
      : props.selectedFolderId === UNFILED_FOLDER_ID
        ? !note.folderId
        : note.folderId === props.selectedFolderId
  );
  const editingNote = sortedNotes.find((note) => note.id === editingNoteId) ?? null;
  const unfiledNotes = sortedNotes.filter((note) => !note.folderId);
  const folderGroups = props.folders.map((folder) => ({
    folder,
    notes: sortedNotes.filter((note) => note.folderId === folder.id)
  }));
  const searchResultFolderIds = useMemo(() => {
    if (!searchActive) return [];
    return [
      ...(unfiledNotes.length > 0 ? [UNFILED_FOLDER_ID] : []),
      ...folderGroups.filter((group) => group.notes.length > 0).map((group) => group.folder.id)
    ];
  }, [folderGroups, searchActive, unfiledNotes.length]);

  useEffect(() => {
    if (props.openNoteId) setEditingNoteId(props.openNoteId);
  }, [props.openNoteId]);

  useEffect(() => {
    if (searchResultFolderIds.length === 0) return;
    setExpandedFolders((current) => {
      const next = Array.from(new Set([...current, ...searchResultFolderIds]));
      return next.length === current.length ? current : next;
    });
  }, [searchResultFolderIds]);

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
          <label className="field notes-search-field">
            <span>Search</span>
            <input
              aria-label="Search notes"
              value={props.search}
              onChange={(event) => props.onSearchChange(event.currentTarget.value)}
            />
          </label>
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
            <TagMultiSelect
              label="Tags"
              tags={props.tags}
              selectedTagIds={props.selectedTagIds}
              onToggle={props.onTagToggle}
              onCreateTag={props.onCreateTag}
              onDeleteTag={props.onDeleteTag}
            />
            <details className="management-menu">
              <summary>Manage folders and tags</summary>
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

        {localError ? (
          <p className="app-error" role="alert">
            {localError}
          </p>
        ) : null}

        <section className="folder-note-groups" aria-label="Folder contents">
          <div className="folder-groups-header">
            <button
              type="button"
              className={props.selectedFolderId === null ? "selected" : ""}
              onClick={() => props.onFolderChange(null)}
            >
              All Notes <strong>{sortedNotes.length}</strong>
            </button>
            <form
              className="inline-form compact-folder-create"
              onSubmit={(event) => {
                event.preventDefault();
                if (!folderName.trim()) return;
                void runFolderAction(async () => {
                  await props.onCreateFolder(folderName);
                  setFolderName("");
                });
              }}
            >
              <input
                aria-label="New folder name"
                placeholder="New folder"
                value={folderName}
                onChange={(event) => setFolderName(event.currentTarget.value)}
              />
              <button type="submit">Add folder</button>
            </form>
          </div>
          {props.selectedFolderId === null ? (
            <>
              <FolderNoteGroup
                id={UNFILED_FOLDER_ID}
                title="Unfiled"
                notes={unfiledNotes}
                expanded={searchActive || expandedFolders.includes(UNFILED_FOLDER_ID)}
                onToggle={() => toggleExpanded(UNFILED_FOLDER_ID)}
                onDropNote={() => moveDraggedNote(null)}
                renderNote={(note) => (
                  <NoteCard
                    key={note.id}
                    note={note}
                    onOpenDetails={setEditingNoteId}
                    onDragStart={() => setDraggedNoteId(note.id)}
                    {...props}
                  />
                )}
              />
              {folderGroups.map((group) => (
                <FolderNoteGroup
                  key={group.folder.id}
                  id={group.folder.id}
                  title={group.folder.name}
                  notes={group.notes}
                  expanded={searchActive || expandedFolders.includes(group.folder.id)}
                  onToggle={() => toggleExpanded(group.folder.id)}
                  renaming={renamingFolderId === group.folder.id}
                  draftName={folderDraftName}
                  onDraftNameChange={setFolderDraftName}
                  onRenameStart={() => {
                    setRenamingFolderId(group.folder.id);
                    setFolderDraftName(group.folder.name);
                  }}
                  onRenameCancel={() => {
                    setRenamingFolderId(null);
                    setFolderDraftName("");
                  }}
                  onRenameSubmit={() =>
                    void runFolderAction(async () => {
                      if (!folderDraftName.trim()) return;
                      await props.onUpdateFolder?.(group.folder.id, folderDraftName);
                      setRenamingFolderId(null);
                      setFolderDraftName("");
                    })
                  }
                  onDelete={() =>
                    void runFolderAction(async () => {
                      if (
                        window.confirm(
                          `Delete "${group.folder.name}" and move ${group.notes.length} note${group.notes.length === 1 ? "" : "s"} to Unfiled?`
                        )
                      ) {
                        await props.onDeleteFolder?.(group.folder.id);
                        props.onFolderChange(null);
                      }
                    })
                  }
                  onDropNote={() => moveDraggedNote(group.folder.id)}
                  renderNote={(note) => (
                    <NoteCard
                      key={note.id}
                      note={note}
                      onOpenDetails={setEditingNoteId}
                      onDragStart={() => setDraggedNoteId(note.id)}
                      {...props}
                    />
                  )}
                />
              ))}
            </>
          ) : (
            <div className="note-list" aria-label="Notes">
              {displayedNotes.map((note) => (
                <NoteCard
                  key={note.id}
                  note={note}
                  onOpenDetails={setEditingNoteId}
                  onDragStart={() => setDraggedNoteId(note.id)}
                  {...props}
                />
              ))}
            </div>
          )}
        </section>
      </section>
      <button
        type="button"
        className="floating-action-button"
        aria-label="Create note"
        onClick={() => {
          setMoreOptionsOpen(true);
          setComposerOpen(true);
        }}
      >
        <PlusIcon />
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
                Title
                <input
                  aria-label="New note title"
                  placeholder="New note"
                  maxLength={NOTE_TITLE_LIMIT}
                  value={draft.title}
                  onChange={(event) =>
                    setDraft({ ...draft, title: limitTitle(event.currentTarget.value) })
                  }
                />
                <span className="character-count">
                  {Math.max(0, NOTE_TITLE_LIMIT - graphemeLength(draft.title))} characters left
                </span>
              </label>
              <label>
                Body
                <textarea
                  aria-label="New note body"
                  placeholder="Details"
                  value={draft.body ?? ""}
                  onChange={(event) => setDraft({ ...draft, body: event.currentTarget.value })}
                />
              </label>
              <details
                open={moreOptionsOpen}
                onToggle={(event) => setMoreOptionsOpen(event.currentTarget.open)}
              >
                <summary>
                  More Options
                  {draft.folderId || (draft.tagIds?.length ?? 0) > 0 || draft.dueAt ? " •" : ""}
                </summary>
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
                  Folder
                  <select
                    value={draft.folderId ?? ""}
                    onChange={(event) =>
                      setDraft({ ...draft, folderId: event.currentTarget.value || null })
                    }
                  >
                    <option value="">Unfiled</option>
                    {props.folders.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.name}
                      </option>
                    ))}
                  </select>
                </label>
                <TagMultiSelect
                  label="Tags"
                  tags={props.tags}
                  selectedTagIds={draft.tagIds ?? []}
                  contextLabel={draft.title || "new note"}
                  onToggle={(tagId) => {
                    const ids = draft.tagIds ?? [];
                    setDraft({
                      ...draft,
                      tagIds: ids.includes(tagId)
                        ? ids.filter((id) => id !== tagId)
                        : [...ids, tagId]
                    });
                  }}
                  onCreateTag={props.onCreateTag}
                  onDeleteTag={props.onDeleteTag}
                />
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
                <label>
                  Due date
                  <input
                    type="date"
                    value={draft.dueAt?.slice(0, 10) ?? ""}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        dueAt: event.currentTarget.value
                          ? `${event.currentTarget.value}T00:00:00.000Z`
                          : null
                      })
                    }
                  />
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
          sortedNotes={displayedNotes}
          {...props}
          onClose={() => setEditingNoteId(null)}
        />
      ) : null}
    </main>
  );

  function toggleExpanded(folderId: EntityId): void {
    setExpandedFolders((current) =>
      current.includes(folderId) ? current.filter((id) => id !== folderId) : [...current, folderId]
    );
  }

  async function runFolderAction(action: () => Promise<void>): Promise<void> {
    setLocalError(null);
    try {
      await action();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Folder action failed.");
    }
  }

  function moveDraggedNote(folderId: EntityId | null): void {
    if (!draggedNoteId) return;
    const note = sortedNotes.find((item) => item.id === draggedNoteId);
    setDraggedNoteId(null);
    if (!note || note.folderId === folderId) return;
    void props.onUpdateNote(note, { folderId });
  }
}

function FolderNoteGroup(props: {
  id: EntityId;
  title: string;
  notes: Note[];
  expanded: boolean;
  onToggle: () => void;
  renaming?: boolean;
  draftName?: string;
  onDraftNameChange?: (value: string) => void;
  onRenameStart?: () => void;
  onRenameCancel?: () => void;
  onRenameSubmit?: () => void;
  onDelete?: () => void;
  onDropNote?: () => void;
  renderNote: (note: Note) => ReactElement;
}): ReactElement {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <section className="folder-note-group" aria-label={`${props.title} notes`}>
      <div className="folder-group-row">
        <button
          type="button"
          className="folder-group-heading"
          aria-expanded={props.expanded}
          onClick={props.onToggle}
          title={props.title}
        >
          <span>{props.expanded ? "-" : "+"}</span>
          <strong className="truncate">{props.title}</strong>
          <span>{props.notes.length}</span>
        </button>
        {props.expanded && props.id !== UNFILED_FOLDER_ID ? (
          <div className={`folder-menu ${menuOpen ? "open" : ""}`}>
            <button
              type="button"
              className="icon-button folder-menu-trigger"
              aria-label={`Folder actions for ${props.title}`}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              ...
            </button>
            {menuOpen ? (
              <div className="folder-menu-panel" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    props.onRenameStart?.();
                  }}
                >
                  Rename
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="mini-danger"
                  onClick={() => {
                    setMenuOpen(false);
                    props.onDelete?.();
                  }}
                >
                  Delete
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {props.renaming ? (
        <form
          className="folder-rename-form"
          onSubmit={(event) => {
            event.preventDefault();
            props.onRenameSubmit?.();
          }}
        >
          <input
            aria-label={`Rename ${props.title}`}
            value={props.draftName ?? ""}
            onChange={(event) => props.onDraftNameChange?.(event.currentTarget.value)}
          />
          <button type="submit">Save</button>
          <button type="button" onClick={props.onRenameCancel}>
            Cancel
          </button>
        </form>
      ) : null}
      {props.expanded ? (
        <div
          className="note-list"
          aria-label={`${props.title} notes`}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            props.onDropNote?.();
          }}
        >
          {props.notes.length === 0 ? <p className="empty-state">No notes here.</p> : null}
          {props.notes.map((note) => props.renderNote(note))}
        </div>
      ) : null}
    </section>
  );
}

function NoteCard(
  props: NotesWorkspaceProps & {
    note: Note;
    onOpenDetails: (id: EntityId) => void;
    onDragStart: () => void;
  }
): ReactElement {
  const { note } = props;
  const disabled = props.updatingNoteIds?.includes(note.id) ?? false;
  const folderName = note.folderId
    ? props.folders.find((folder) => folder.id === note.folderId)?.name
    : null;
  function openDetails(): void {
    props.onOpenDetails(note.id);
  }
  return (
    <article
      aria-label={`Note ${note.title}`}
      className={`note-card compact-note-card ${note.status === "done" ? "done" : ""}`}
      draggable
      tabIndex={0}
      onDragStart={props.onDragStart}
      onClick={openDetails}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openDetails();
        }
      }}
    >
      <div className="note-card-top">
        <input
          aria-label={`Mark ${note.title} done`}
          type="checkbox"
          checked={note.status === "done"}
          disabled={disabled || note.kind !== "task"}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) =>
            void props.onUpdateNote(note, {
              status: event.currentTarget.checked ? "done" : "active"
            })
          }
        />
        <button
          type="button"
          className="note-title-button"
          onClick={(event) => {
            event.stopPropagation();
            openDetails();
          }}
        >
          <strong>{note.title}</strong>
          {note.body ? <span>{note.body}</span> : null}
        </button>
        <button
          aria-label={note.pinned ? "Unpin note" : "Pin note"}
          title={note.pinned ? "Unpin note" : "Pin note"}
          className="icon-button note-pin-button"
          aria-pressed={note.pinned}
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation();
            void props.onUpdateNote(note, { pinned: !note.pinned });
          }}
        >
          <PushPinIcon filled={note.pinned} />
          <span className="icon-button-text">{note.pinned ? "Pinned" : "Pin"}</span>
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
  const [draft, setDraft] = useState(() => noteDraftFromNote(note));
  const activeNoteId = useRef(note.id);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (activeNoteId.current !== note.id) {
      activeNoteId.current = note.id;
      setDraft(noteDraftFromNote(note));
      return;
    }
    setDraft((current) => ({
      ...current,
      version: Math.max(current.version, note.version)
    }));
  }, [note]);

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    []
  );

  function queueTextSave(next: ReturnType<typeof noteDraftFromNote>): void {
    setDraft(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void props.onUpdateNote(note, { title: next.title, body: next.body });
    }, 450);
  }

  function savePatch(patch: NotePatch): void {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    void props.onUpdateNote(note, patch);
  }

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
              maxLength={NOTE_TITLE_LIMIT}
              value={draft.title}
              disabled={disabled}
              onChange={(event) =>
                queueTextSave({ ...draft, title: limitTitle(event.currentTarget.value) })
              }
            />
            <span className="character-count">
              {Math.max(0, NOTE_TITLE_LIMIT - graphemeLength(draft.title))} characters left
            </span>
          </label>
          <label>
            Body
            <textarea
              value={draft.body}
              disabled={disabled}
              onChange={(event) => queueTextSave({ ...draft, body: event.currentTarget.value })}
            />
          </label>
          <details>
            <summary>
              More Options
              {note.folderId || note.tags.length > 0 || note.dueAt ? " •" : ""}
            </summary>
            <div className="note-meta note-meta-panel">
              <span>{note.kind}</span>
              <label>
                Priority
                <select
                  aria-label={`Priority for ${note.title}`}
                  value={note.priority}
                  disabled={disabled}
                  onChange={(event) =>
                    savePatch({
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
                    savePatch({
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
                    savePatch({
                      dueAt: event.currentTarget.value
                        ? `${event.currentTarget.value}T00:00:00.000Z`
                        : null
                    })
                  }
                />
              </label>
              <TagMultiSelect
                label="Tags"
                tags={props.tags}
                selectedTagIds={note.tags.map((tag) => tag.id)}
                contextLabel={note.title}
                initiallyOpen
                onToggle={(tagId) => {
                  const ids = note.tags.map((item) => item.id);
                  savePatch({
                    tagIds: ids.includes(tagId) ? ids.filter((id) => id !== tagId) : [...ids, tagId]
                  });
                }}
                onCreateTag={props.onCreateTag}
                onDeleteTag={props.onDeleteTag}
                disabled={disabled}
              />
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

function PushPinIcon(props: { filled: boolean }): ReactElement {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill={props.filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15.5 3.5 20.5 8.5" />
      <path d="M8 14 3.5 18.5" />
      <path d="M7 8.5 11.5 4 20 12.5 15.5 17 7 8.5Z" />
    </svg>
  );
}

function TagMultiSelect(props: {
  label: string;
  tags: Tag[];
  selectedTagIds: EntityId[];
  contextLabel?: string;
  initiallyOpen?: boolean;
  onToggle: (tagId: EntityId) => void;
  onCreateTag: (name: string) => Promise<void> | void;
  onDeleteTag?: (tagId: EntityId) => Promise<void> | void;
  disabled?: boolean;
}): ReactElement {
  const [open, setOpen] = useState(Boolean(props.initiallyOpen));
  const [query, setQuery] = useState("");
  const wrapper = useRef<HTMLDivElement | null>(null);
  const selected = props.tags.filter((tag) => props.selectedTagIds.includes(tag.id));
  const filtered = props.tags.filter((tag) => tag.name.toLowerCase().includes(query.toLowerCase()));
  const menuOpen = open || Boolean(props.initiallyOpen);
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (props.initiallyOpen) return;
      if (wrapper.current && !wrapper.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [props.initiallyOpen]);
  return (
    <div className="tag-dropdown" ref={wrapper}>
      <button
        type="button"
        aria-expanded={menuOpen}
        aria-haspopup="listbox"
        disabled={props.disabled}
        onClick={() => setOpen((current) => !current)}
      >
        {props.label}: {selected.length === 0 ? "None" : selected.map((tag) => tag.name).join(", ")}
      </button>
      <div className="selected-tags" aria-label="Selected tags">
        {(selected.length > 0 ? selected : props.tags).map((tag) => (
          <span key={tag.id} className="filter-chip">
            {tag.name}
          </span>
        ))}
      </div>
      {menuOpen ? (
        <div className="tag-dropdown-menu" role="listbox" aria-label={props.label}>
          <input
            aria-label="Search or create tag"
            value={query}
            onKeyDown={(event) => {
              if (event.key === "Escape") setOpen(false);
            }}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          {filtered.map((tag) => (
            <label key={tag.id} className="check-row">
              <input
                type="checkbox"
                aria-label={
                  props.contextLabel
                    ? `${tag.name} tag for ${props.contextLabel}`
                    : `${tag.name} tag`
                }
                checked={props.selectedTagIds.includes(tag.id)}
                onChange={() => props.onToggle(tag.id)}
              />
              <span>{tag.name}</span>
              {props.onDeleteTag ? (
                <button
                  type="button"
                  className="mini-danger"
                  aria-label={`Delete tag ${tag.name}`}
                  onClick={(event) => {
                    event.preventDefault();
                    if (window.confirm(`Delete tag "${tag.name}" from all notes?`)) {
                      void props.onDeleteTag?.(tag.id);
                    }
                  }}
                >
                  Delete
                </button>
              ) : null}
            </label>
          ))}
          {query.trim() &&
          !props.tags.some((tag) => tag.name.toLowerCase() === query.trim().toLowerCase()) ? (
            <button
              type="button"
              onClick={() => {
                void props.onCreateTag(query.trim());
                setQuery("");
              }}
            >
              Create "{query.trim()}"
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function noteDraftFromNote(note: Note): {
  id: EntityId;
  title: string;
  body: string;
  version: number;
} {
  return { id: note.id, title: note.title, body: note.body, version: note.version };
}

function limitTitle(value: string): string {
  if (graphemeLength(value) <= NOTE_TITLE_LIMIT) return value;
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return [...segmenter.segment(value)]
      .slice(0, NOTE_TITLE_LIMIT)
      .map((segment) => segment.segment)
      .join("");
  }
  return Array.from(value).slice(0, NOTE_TITLE_LIMIT).join("");
}

function graphemeLength(value: string): number {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)].length;
  }
  return Array.from(value).length;
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

function PlusIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M12 5v14M5 12h14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
