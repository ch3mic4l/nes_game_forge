// Central project state: one object, snapshot-based undo, change notifications.
//
// Snapshots are whole-project structuredClones. At NES scale a project is well
// under a megabyte, so this stays fast and removes a whole class of undo bugs.

const UNDO_LIMIT = 100;

export class Store {
  constructor() {
    this.project = null;
    this.dir = null;
    this.dirty = false;
    this.undoStack = [];
    this.redoStack = [];
    this.listeners = new Set();
    this.stroke = null;
    this._revision = 0;
    this._generation = 0;
    this._session = 0;
  }

  get isOpen() {
    return this.project !== null;
  }

  /**
   * Bumped inside commit()/undo()/redo()/open()/close() -- every method that
   * replaces or mutates this.project. Not beginStroke()/touch()/endStroke()/
   * cancelStroke(): an actor deletion or renumbering always goes through one
   * commit(), never a stroke, and touch() fires per pointer-move frame of an
   * unrelated drag. See docs/design-monster.md §2.
   */
  get revision() {
    return this._revision;
  }

  /**
   * Bumped by every method that sets `dirty = true` (commit, beginStroke,
   * touch, undo, redo) and by open()/close() regardless of dirty's own new
   * value. A distinct counter from `revision` above -- deliberately bumped
   * by beginStroke()/touch() too, unlike revision -- because what this
   * guards against is a *save* racing a *later edit* of any kind, including
   * a live stroke, not an identity fence for actor/screen indices. saveProject
   * (renderer/app.js) captures this alongside `dir` before its IPC call and
   * hands both back to markSaved(), so a save that completes after a newer
   * edit landed does not mark that newer edit clean.
   */
  get generation() {
    return this._generation;
  }

  /**
   * Bumped ONLY by open(), close() and relocate() -- never by commit/
   * beginStroke/touch/undo/redo, unlike generation above. This is a
   * project's own IDENTITY marker, not its edit clock: reopening the exact
   * same directory string is still a fresh session, because it is a
   * genuinely different act of opening, not a continuation of the one
   * already in memory. saveProjectAs (renderer/app.js) captures this
   * alongside generation before its IPC call and hands both to
   * relocateIfSession, so a Save As for project A that completes after A's
   * own directory was closed and reopened (dir textually unchanged, so a
   * plain dir-equality check would wrongly accept it) is refused instead of
   * relocating the reopened session onto A's earlier destination.
   */
  get session() {
    return this._session;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(detail = {}) {
    for (const listener of this.listeners) listener(detail);
  }

  open(dir, project) {
    this.dir = dir;
    this.project = project;
    this.dirty = false;
    this.undoStack = [];
    this.redoStack = [];
    this._revision++;
    this._generation++;
    this._session++;
    this.emit({ type: 'open' });
  }

  close() {
    this.dir = null;
    this.project = null;
    this.dirty = false;
    this.undoStack = [];
    this.redoStack = [];
    this._revision++;
    this._generation++;
    this._session++;
    this.emit({ type: 'close' });
  }

  /**
   * Clears `dirty` and emits 'saved' -- but only when `expected` is either
   * omitted (a bare `markSaved()`, kept working as an unconditional "mark
   * clean now" for any caller that has no generation/dir to compare) or
   * still matches: `expected.generation === this.generation` AND
   * `expected.dir === this.dir`. A stale caller -- a save whose IPC round
   * trip outlived a newer edit, or outlived the project itself closing and
   * a different one opening in its place -- fails that match and returns
   * false without touching `dirty`, so a completion that arrives late marks
   * neither the wrong project clean nor edits made after it was captured.
   */
  markSaved(expected) {
    if (expected && (expected.generation !== this._generation || expected.dir !== this.dir)) {
      return false;
    }
    this.dirty = false;
    this.emit({ type: 'saved' });
    return true;
  }

  /**
   * Save As: the project now lives at `dir` instead of wherever it was
   * opened from. `dir` moves, generation bumps and session bumps
   * unconditionally -- the copy really was written to that location and
   * this genuinely is a new act of relocating, regardless of anything else
   * -- but `dirty` is SET, not merely left alone, based on `clean` (default
   * true): true clears it, false explicitly sets it. Explicit either way is
   * what matters -- `dirty` might already read false when this runs (an
   * ordinary Save to the OLD directory, its own IPC call racing this one,
   * could have completed and cleared it in between), and the destination
   * this call just wrote holds a snapshot strictly older than whatever is in
   * memory now, by definition, whenever `clean` is false. Leaving `dirty`
   * at whatever it already happened to be would silently call that older
   * snapshot current. The caller (saveProjectAs, renderer/app.js) passes
   * `clean: store.generation === <the generation captured before the IPC>`.
   *
   * There is no markSaved()-style dir match here (unlike a plain save,
   * there is no "expected" dir to compare against; `dir` is *becoming* the
   * new one) -- relocateIfSession below is the guarded entry point that
   * takes the place of one, and is what callers should actually use.
   */
  relocate(dir, { clean = true } = {}) {
    this.dir = dir;
    this._generation++;
    this._session++;
    this.dirty = !clean;
    this.emit({ type: 'saved' });
  }

  /**
   * The guarded form of relocate(), and the one real callers should use.
   * `session` and `generation` are captured by the caller before its own
   * IPC call; if `session` no longer matches, a different project session
   * opened (or the same directory was closed and reopened -- textually
   * identical but a genuinely different session) while that call was in
   * flight, and relocating onto it would be wrong regardless of anything
   * else -- refuses, touching nothing, and returns false. A plain
   * `store.dir !== dir` check (this method's own predecessor) cannot catch
   * the reopen-the-same-directory case, since dir reads identical either
   * way; session can, because open()/close() bump it unconditionally.
   * Otherwise behaves exactly like relocate(), with `clean` computed from
   * the generation comparison exactly as callers used to compute it
   * themselves, and returns true.
   */
  relocateIfSession(dir, { session, generation }) {
    if (session !== this._session) return false;
    this.relocate(dir, { clean: generation === this._generation });
    return true;
  }

  pushUndo(label) {
    if (!this.project) return;
    this.undoStack.push({ label, state: structuredClone(this.project) });
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Snapshot, mutate, notify — the normal path for a discrete edit. */
  commit(label, mutate) {
    if (!this.project) return;
    this.pushUndo(label);
    // The revision bump lives in `finally`, not after a normal return: a
    // mutator that splices/restamps the actor array and then throws has
    // already changed actor identity, and the fence a contextual navigation
    // relies on (docs/design-monster.md §2) must not claim otherwise by
    // staying stale. Nothing else about the throwing path changes -- no
    // `emit`, no `dirty` -- the exception still propagates past this method.
    try {
      mutate(this.project);
    } finally {
      this._revision++;
    }
    this.dirty = true;
    this._generation++;
    this.emit({ type: 'change', label });
  }

  /**
   * A drag should be one undo entry. beginStroke snapshots once; touch() notifies
   * without snapshotting; endStroke closes it out.
   */
  beginStroke(label) {
    if (!this.project || this.stroke) return;
    this.pushUndo(label);
    this.stroke = label;
    this.dirty = true;
    this._generation++;
  }

  touch(detail = {}) {
    this.dirty = true;
    this._generation++;
    this.emit({ type: 'change', live: true, ...detail });
  }

  endStroke() {
    if (!this.stroke) return;
    const label = this.stroke;
    this.stroke = null;
    this.emit({ type: 'change', label });
  }

  /** Discard the pending stroke snapshot when a drag turned out to change nothing. */
  cancelStroke() {
    if (!this.stroke) return;
    this.stroke = null;
    const entry = this.undoStack.pop();
    if (entry) this.project = entry.state;
    this.emit({ type: 'change' });
  }

  undo() {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    this.redoStack.push({ label: entry.label, state: structuredClone(this.project) });
    this.project = entry.state;
    this.dirty = true;
    this._revision++;
    this._generation++;
    this.emit({ type: 'undo', label: entry.label });
    return entry.label ?? true;
  }

  redo() {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    this.undoStack.push({ label: entry.label, state: structuredClone(this.project) });
    this.project = entry.state;
    this.dirty = true;
    this._revision++;
    this._generation++;
    this.emit({ type: 'redo', label: entry.label });
    return entry.label ?? true;
  }
}

export const store = new Store();
