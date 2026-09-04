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
