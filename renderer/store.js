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
    this.emit({ type: 'open' });
  }

  close() {
    this.dir = null;
    this.project = null;
    this.dirty = false;
    this.undoStack = [];
    this.redoStack = [];
    this._revision++;
    this.emit({ type: 'close' });
  }

  markSaved() {
    this.dirty = false;
    this.emit({ type: 'saved' });
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
  }

  touch(detail = {}) {
    this.dirty = true;
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
    this.emit({ type: 'redo', label: entry.label });
    return entry.label ?? true;
  }
}

export const store = new Store();
