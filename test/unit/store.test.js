import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../../renderer/store.js';

function openedStore() {
  const store = new Store();
  store.open('/tmp/proj', { name: 'p' });
  return store;
}

test('store.revision: commit bumps exactly once', () => {
  const store = openedStore();
  const before = store.revision;
  store.commit('edit', (project) => {
    project.name = 'q';
  });
  assert.equal(store.revision, before + 1);
});

test('store.revision: undo bumps exactly once', () => {
  const store = openedStore();
  store.commit('edit', (project) => {
    project.name = 'q';
  });
  const before = store.revision;
  store.undo();
  assert.equal(store.revision, before + 1);
});

test('store.revision: redo bumps exactly once', () => {
  const store = openedStore();
  store.commit('edit', (project) => {
    project.name = 'q';
  });
  store.undo();
  const before = store.revision;
  store.redo();
  assert.equal(store.revision, before + 1);
});

test('store.revision: open bumps exactly once', () => {
  const store = new Store();
  const before = store.revision;
  store.open('/tmp/proj', { name: 'p' });
  assert.equal(store.revision, before + 1);
});

test('store.revision: close bumps exactly once', () => {
  const store = openedStore();
  const before = store.revision;
  store.close();
  assert.equal(store.revision, before + 1);
});

test('store.revision: a beginStroke/touch x N/endStroke sequence bumps zero times', () => {
  const store = openedStore();
  const before = store.revision;
  store.beginStroke('drag');
  store.touch();
  store.touch();
  store.touch();
  store.endStroke();
  assert.equal(store.revision, before);
});

test('store.revision: cancelStroke bumps zero times', () => {
  const store = openedStore();
  const before = store.revision;
  store.beginStroke('drag');
  store.touch();
  store.cancelStroke();
  assert.equal(store.revision, before);
});

test('store.revision: undo with nothing to undo bumps zero times', () => {
  const store = openedStore();
  // Fresh store: undoStack is empty, so undo() returns false without mutating
  // this.project -- pin that behavior along with the revision claim.
  const before = store.revision;
  const result = store.undo();
  assert.equal(result, false);
  assert.equal(store.revision, before);
});

test('store.revision: redo with nothing to redo bumps zero times', () => {
  const store = openedStore();
  const before = store.revision;
  const result = store.redo();
  assert.equal(result, false);
  assert.equal(store.revision, before);
});

test('store.revision: is already bumped before subscribers run, for every emitting method', () => {
  // A subscriber that reacts to a store event (e.g. a contextual
  // navigation started from an 'open' replay) must see the *new* revision,
  // not the one from just before the mutation -- checking only after each
  // method returns (as the tests above do) cannot catch a bump moved to
  // after emit(). See docs/design-monster.md §2.
  const cases = [
    { label: 'open', makeStore: () => new Store(), act: (store) => store.open('/tmp/proj', { name: 'p' }) },
    {
      label: 'commit',
      makeStore: () => {
        const store = openedStore();
        return store;
      },
      act: (store) =>
        store.commit('edit', (project) => {
          project.name = 'q';
        })
    },
    {
      label: 'undo',
      makeStore: () => {
        const store = openedStore();
        store.commit('edit', (project) => {
          project.name = 'q';
        });
        return store;
      },
      act: (store) => store.undo()
    },
    {
      label: 'redo',
      makeStore: () => {
        const store = openedStore();
        store.commit('edit', (project) => {
          project.name = 'q';
        });
        store.undo();
        return store;
      },
      act: (store) => store.redo()
    },
    { label: 'close', makeStore: () => openedStore(), act: (store) => store.close() }
  ];

  for (const { label, makeStore, act } of cases) {
    const store = makeStore();
    const before = store.revision;
    let seenInsideListener = null;
    const unsubscribe = store.subscribe(() => {
      seenInsideListener = store.revision;
    });
    act(store);
    unsubscribe();
    assert.equal(seenInsideListener, before + 1, label + ': revision seen inside the subscriber should already be before + 1');
  }
});

test('store.commit: revision is still `before` while the mutator runs, and `before + 1` once commit returns', () => {
  // Both existing tests above only check revision after their method
  // returns; that alone would still pass a bump placed *before* mutate()
  // runs -- this pins the bump's position relative to mutate() itself, read
  // from inside it, for a plain mutator and one that throws. See
  // docs/design-monster.md §2.
  const cases = [
    {
      label: 'a plain mutator',
      run: (store) =>
        store.commit('edit', (project) => {
          project.__seenRevision = store.revision;
          project.name = 'q';
        })
    },
    {
      label: 'a mutator that reads revision and then throws',
      run: (store) =>
        assert.throws(() => {
          store.commit('edit', (project) => {
            project.__seenRevision = store.revision;
            project.name = 'q';
            throw new Error('mutator threw after reading revision');
          });
        }, /mutator threw after reading revision/)
    }
  ];

  for (const { label, run } of cases) {
    const store = openedStore();
    const before = store.revision;
    run(store);
    assert.equal(store.project.__seenRevision, before, label + ': revision seen while the mutator runs should not be bumped yet');
    assert.equal(store.revision, before + 1, label + ': revision after commit returns should be before + 1');
  }
});

test('store.commit: a throwing mutator still advances the revision, and the exception propagates', () => {
  const store = openedStore();
  const before = store.revision;
  const beforeDirty = store.dirty;
  assert.throws(() => {
    store.commit('smoke: throwing mutator', (project) => {
      project.sprites = project.sprites ?? {};
      project.sprites.actors = [{ id: 0, name: 'Ephemeral' }];
      throw new Error('mutator threw after mutating');
    });
  }, /mutator threw after mutating/);
  assert.equal(store.revision, before + 1);
  // Nothing else about the throwing path changes: no emit-driven dirty flag.
  assert.equal(store.dirty, beforeDirty);
  assert.deepEqual(store.project.sprites.actors, [{ id: 0, name: 'Ephemeral' }]);
});

// -------------------------------------------------- store.generation / markSaved (item 4)

test('store.generation: bumped by commit, beginStroke, touch, undo, redo, open and close', () => {
  const store = openedStore();
  let before = store.generation;
  store.commit('edit', (project) => {
    project.name = 'q';
  });
  assert.ok(store.generation > before, 'commit must bump generation');

  before = store.generation;
  store.beginStroke('drag');
  assert.ok(store.generation > before, 'beginStroke must bump generation');

  before = store.generation;
  store.touch();
  assert.ok(store.generation > before, 'touch must bump generation');
  store.endStroke();

  before = store.generation;
  store.undo();
  assert.ok(store.generation > before, 'undo must bump generation');

  before = store.generation;
  store.redo();
  assert.ok(store.generation > before, 'redo must bump generation');

  before = store.generation;
  store.close();
  assert.ok(store.generation > before, 'close must bump generation');

  before = store.generation;
  store.open('/tmp/proj2', { name: 'p2' });
  assert.ok(store.generation > before, 'open must bump generation');
});

test('store.generation: a throwing commit does not bump generation, matching dirty', () => {
  const store = openedStore();
  const before = store.generation;
  assert.throws(() => {
    store.commit('smoke: throwing mutator', (project) => {
      project.name = 'q';
      throw new Error('boom');
    });
  }, /boom/);
  assert.equal(store.generation, before, 'a throwing mutator must not bump generation, the same as it does not set dirty');
});

test('store.markSaved: a stale generation leaves dirty true; the current generation clears it', () => {
  const store = openedStore();
  store.commit('first edit', (project) => {
    project.name = 'a';
  });
  const staleGeneration = store.generation;
  const dir = store.dir;

  // A second edit lands before the (simulated) IPC round trip for the first
  // save completes.
  store.commit('second edit', (project) => {
    project.name = 'b';
  });
  assert.equal(store.dirty, true);

  const staleApplied = store.markSaved({ generation: staleGeneration, dir });
  assert.equal(staleApplied, false, 'markSaved with a stale generation must report it did not apply');
  assert.equal(store.dirty, true, 'the second edit must still show as unsaved');

  const currentApplied = store.markSaved({ generation: store.generation, dir: store.dir });
  assert.equal(currentApplied, true);
  assert.equal(store.dirty, false, 'markSaved with the current generation/dir must clear dirty');
});

test('store.markSaved: open() between capture and markSaved leaves the new project clean-as-opened, not marked by the wrong dir', () => {
  const store = openedStore();
  store.commit('edit', (project) => {
    project.name = 'a';
  });
  const capturedGeneration = store.generation;
  const capturedDir = store.dir;

  // A different project opens before the first save's IPC round trip returns.
  store.open('/tmp/other-project', { name: 'other' });
  assert.equal(store.dirty, false, 'a freshly opened project starts clean');
  assert.equal(store.dir, '/tmp/other-project');

  const applied = store.markSaved({ generation: capturedGeneration, dir: capturedDir });
  assert.equal(applied, false, 'a dir mismatch must be reported as not applied');
  assert.equal(store.dir, '/tmp/other-project', 'markSaved must never touch store.dir itself');
  assert.equal(store.dirty, false, 'the new project must remain clean, not be disturbed by the stale markSaved call');
});

test('store.markSaved: a bare call with no argument clears dirty unconditionally', () => {
  const store = openedStore();
  store.commit('edit', (project) => {
    project.name = 'a';
  });
  assert.equal(store.dirty, true);
  const applied = store.markSaved();
  assert.equal(applied, true);
  assert.equal(store.dirty, false);
});

test('store.relocate: sets dir, clears dirty, bumps generation, and emits saved', () => {
  const store = openedStore();
  store.commit('edit', (project) => {
    project.name = 'a';
  });
  assert.equal(store.dirty, true);
  const beforeGeneration = store.generation;
  let sawSaved = false;
  const unsubscribe = store.subscribe((detail) => {
    if (detail.type === 'saved') sawSaved = true;
  });
  store.relocate('/tmp/new-location');
  unsubscribe();
  assert.equal(store.dir, '/tmp/new-location');
  assert.equal(store.dirty, false);
  assert.ok(store.generation > beforeGeneration);
  assert.equal(sawSaved, true, 'relocate must emit a "saved" event');
});

// --------------------------------------------------- review-fix slice A round 2, item 3

test('store.relocate: clean:true (the default, and the no-edit-during-the-IPC case) clears dirty', () => {
  const store = openedStore();
  store.commit('edit', (project) => {
    project.name = 'a';
  });
  assert.equal(store.dirty, true);
  const beforeGeneration = store.generation;
  store.relocate('/tmp/new-location', { clean: true });
  assert.equal(store.dir, '/tmp/new-location', 'dir must move');
  assert.equal(store.dirty, false, 'clean:true clears dirty');
  assert.ok(store.generation > beforeGeneration, 'generation must still bump');
});

test('store.relocate: clean:false (an edit landed during the Save As IPC) still moves dir and bumps generation, but leaves dirty true', () => {
  const store = openedStore();
  store.commit('edit', (project) => {
    project.name = 'a';
  });
  const beforeGeneration = store.generation;
  store.relocate('/tmp/new-location', { clean: false });
  assert.equal(store.dir, '/tmp/new-location', 'dir must still move regardless of clean');
  assert.equal(store.dirty, true, 'a newer edit must stay marked dirty even though the location moved -- it is not actually on disk at the new location');
  assert.ok(store.generation > beforeGeneration, 'generation must still bump regardless of clean');
});

// --------------------------------------------------- review-fix slice A round 3, item 1

test('store.relocate: clean:false SETS dirty true even when an intervening ordinary Save already cleared it', () => {
  // The exact sequence from the round 3 report: start Save As, edit, an
  // ordinary Save to the ORIGINAL directory completes (clearing dirty),
  // then Save As completes -- relocating onto a snapshot older than what
  // is now in memory. clean:false must SET dirty, not merely leave alone
  // whatever it currently reads (false, from that intervening Save).
  const store = openedStore();
  store.commit('edit before save as', (project) => {
    project.name = 'a';
  });
  const generationAtSaveAsStart = store.generation;

  store.commit('edit during save as', (project) => {
    project.name = 'b';
  });

  // An ordinary Save to the same, still-open directory completes, capturing
  // (and matching) the CURRENT generation/dir -- a legitimate save, not a
  // stale one.
  const savedCleanly = store.markSaved({ generation: store.generation, dir: store.dir });
  assert.equal(savedCleanly, true);
  assert.equal(store.dirty, false, 'the ordinary Save legitimately cleared dirty');

  // Save As now completes, using the generation captured BEFORE the second
  // edit -- stale relative to what is in memory now.
  const clean = store.generation === generationAtSaveAsStart;
  assert.equal(clean, false, 'sanity: the captured generation really is stale relative to the current one');
  store.relocate('/tmp/new-location', { clean });
  assert.equal(
    store.dirty,
    true,
    'relocate with clean:false must SET dirty even though it currently reads false -- the destination holds an older snapshot than memory'
  );
});

// --------------------------------------------------- review-fix slice A round 3, item 2

test('store.session: bumped by open and close, not by commit/beginStroke/touch/undo/redo/relocate’s own edit-tracking', () => {
  const store = openedStore();
  const before = store.session;
  store.commit('edit', (project) => {
    project.name = 'a';
  });
  assert.equal(store.session, before, 'commit must not bump session');
  store.beginStroke('drag');
  store.touch();
  store.endStroke();
  assert.equal(store.session, before, 'beginStroke/touch must not bump session');
  store.undo();
  assert.equal(store.session, before, 'undo must not bump session');
  store.redo();
  assert.equal(store.session, before, 'redo must not bump session');

  store.close();
  assert.ok(store.session > before, 'close must bump session');
  const afterClose = store.session;
  store.open('/tmp/proj2', { name: 'p2' });
  assert.ok(store.session > afterClose, 'open must bump session');
});

test('store.relocate: bumps session too', () => {
  const store = openedStore();
  const before = store.session;
  store.relocate('/tmp/new-location');
  assert.ok(store.session > before, 'relocate must bump session');
});

test('store.relocateIfSession: reopening the SAME directory bumps session, so a relocate guarded by the captured (now stale) session is refused', () => {
  const store = openedStore(); // opens '/tmp/proj'
  const capturedSession = store.session;
  const capturedGeneration = store.generation;

  // Reopen the exact same directory string -- dir reads identical, but this
  // is a genuinely fresh session (the whole reason session exists rather
  // than reusing a dir-equality check).
  store.open('/tmp/proj', { name: 'p' });

  const applied = store.relocateIfSession('/tmp/new-location', {
    session: capturedSession,
    generation: capturedGeneration
  });
  assert.equal(applied, false, 'a relocate guarded by a stale session must be refused');
  assert.equal(store.dir, '/tmp/proj', 'the store must be untouched -- still the reopened project, not moved to /tmp/new-location');
});

test('store.relocateIfSession: a matching session succeeds, computing clean from the captured generation exactly as relocate() would', () => {
  const store = openedStore();
  const session = store.session;
  const staleGeneration = store.generation;
  store.commit('edit', (project) => {
    project.name = 'a';
  });

  const applied = store.relocateIfSession('/tmp/new-location', { session, generation: staleGeneration });
  assert.equal(applied, true, 'a matching session must succeed');
  assert.equal(store.dir, '/tmp/new-location');
  assert.equal(store.dirty, true, 'the captured generation is stale relative to the edit above -- clean is false, so dirty is SET true');
});

test('store.relocateIfSession: a matching session with a matching generation clears dirty', () => {
  const store = openedStore();
  store.commit('edit', (project) => {
    project.name = 'a';
  });
  const session = store.session;
  const generation = store.generation;

  const applied = store.relocateIfSession('/tmp/new-location', { session, generation });
  assert.equal(applied, true);
  assert.equal(store.dirty, false, 'a matching session AND generation clears dirty');
});
