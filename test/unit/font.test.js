import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FONT_BASE,
  FONT_COUNT,
  FONT_TILES,
  HEART_TILES,
  HEART_FULL_TILE,
  HEART_EMPTY_TILE,
  BORDER_H,
  BORDER_V,
  ARROW_TILE,
  NAME_TOKEN,
  NAME_LENGTH,
  charToTile,
  textToTiles,
  wrapText,
  projectUsesText,
  projectUsesCombat,
  projectUsesNaming
} from '../../shared/font.js';
import { createProject, createPartyMember, projectUsesNameEntry } from '../../shared/project.js';
import { encodeTiles, tileFromString } from '../../shared/chr.js';

test('the font is 96 glyphs in the project tile-string format', () => {
  assert.equal(FONT_TILES.length, FONT_COUNT);
  assert.equal(FONT_BASE + FONT_COUNT, 256); // the font ends exactly at the table's end
  for (const tile of FONT_TILES) {
    assert.equal(tile.length, 64);
    assert.match(tile, /^[03]{64}$/);
  }
  // The tiles feed encodeTiles unmodified, which is the whole point of the format.
  assert.equal(encodeTiles(FONT_TILES).length, FONT_COUNT * 16);
});

test('characters map to tiles by ASCII order', () => {
  assert.equal(charToTile(' '), 0xa0);
  assert.equal(charToTile('0'), 0xb0);
  assert.equal(charToTile('A'), 0xc1);
  assert.equal(charToTile('a'), 0xe1);
  assert.equal(charToTile('z'), 0xfa);
  // Outside ASCII there is no glyph and the caller has to decide what to do.
  assert.equal(charToTile('é'), null);
  assert.equal(charToTile('\n'), null);
});

test('the window furniture has its own glyphs, not borrowed letters', () => {
  const aliases = [BORDER_H, BORDER_V, ARROW_TILE];
  for (const tile of aliases) {
    assert.ok(tile >= FONT_BASE && tile < 256);
    // Every alias sits above 'z', so no printable letter can collide with one.
    assert.ok(tile > charToTile('z'));
  }
  assert.equal(new Set(aliases).size, aliases.length);
});

test('the hearts are real art in the two reserved sprite tiles', () => {
  for (const index of [HEART_FULL_TILE, HEART_EMPTY_TILE]) {
    const tile = HEART_TILES[index];
    assert.equal(tile.length, 64);
    assert.ok(tileFromString(tile).some((pixel) => pixel !== 0), 'heart tile is not blank');
  }
  assert.notEqual(HEART_TILES[HEART_FULL_TILE], HEART_TILES[HEART_EMPTY_TILE]);
});

test('unmapped characters become spaces and are reported once', () => {
  const { tiles, unmapped } = textToTiles('Café');
  assert.equal(tiles.length, 4);
  assert.equal(tiles[3], charToTile(' '));
  assert.deepEqual([...unmapped], ['é']);
});

test('wrapText breaks on words, never mid-word', () => {
  const [page] = wrapText('The ancient seal is broken and the Wind Lord stirs.', 20, 8);
  for (const line of page) assert.ok(line.length <= 20, `"${line}" is ${line.length} long`);
  assert.equal(page.join(' '), 'The ancient seal is broken and the Wind Lord stirs.');
});

test('a blank line is a page break and overflow starts a new page', () => {
  assert.deepEqual(wrapText('One.\n\nTwo.', 28, 4), [['One.'], ['Two.']]);
  const pages = wrapText('a b c d e f g h i j', 1, 2); // one word per line, 2 lines per page
  assert.equal(pages.length, 5);
  assert.deepEqual(pages[0], ['a', 'b']);
});

test('a word longer than the window is cut rather than looping forever', () => {
  const [page] = wrapText('supercalifragilistic', 8, 4);
  assert.deepEqual(page, ['supercal']);
});

// Name entry phase 4 -- the Say token (docs/design-name-entry.md §9a).

test('NAME_LENGTH is the single writer RPG_LIMITS.nameLength reads', () => {
  assert.equal(NAME_TOKEN, '{name}');
  assert.equal(NAME_LENGTH, 10);
});

test('wrapText measures a word containing {name} as NAME_LENGTH columns, not the six literal characters', () => {
  // "Hi {name}!" is 10 literal characters (2 + 1 + 6 + 1) but should be
  // measured as 2 + 1 + 10 + 1 = 14 visual columns (the token's own six
  // literal characters counted as NAME_LENGTH instead) -- too wide for
  // a 13-column line, but it fits a 14-column one, proving the token itself
  // (not its literal length) decided the wrap.
  const tooNarrow = wrapText('Hi {name}!', 13, 4);
  assert.ok(tooNarrow.flat().length > 1, 'a 13-column line must not fit the 14-visual-column line');
  const [wide] = wrapText('Hi {name}!', 14, 4);
  assert.deepEqual(wide, ['Hi {name}!'], 'a 14-column line should fit the whole 14-visual-column line on one row');
});

test('wrapText never splits a {name} token across a wrap, even when it must truncate a single long "word"', () => {
  // "XX{name}YY" glued with no space: "XX" costs 2 visual columns, the
  // token costs NAME_LENGTH (10) whole or not at all, then each
  // trailing "Y" costs 1. At cols=12, "XX" + the whole token exactly fits
  // (2 + 10 = 12); the first trailing "Y" would push it to 13 and is
  // dropped -- the token itself must survive intact, never truncated to a
  // dangling fragment.
  const [page] = wrapText('XX{name}YY', 12, 4);
  assert.deepEqual(page, ['XX{name}'], 'the token must survive whole; only the trailing Ys are dropped');

  // At cols=11 the token itself no longer fits alongside "XX" (2 + 10 = 12
  // > 11), so truncateAtVisualLimit must drop the WHOLE token rather than
  // emit a partial one -- the cut lands at the token's own boundary, never
  // inside it.
  const [tooTight] = wrapText('XX{name}YY', 11, 4);
  assert.deepEqual(tooTight, ['XX'], 'when the token itself does not fit, it is dropped whole, never left dangling');
});

test('wrapText leaves a lone {, }, | or ~ outside the exact six-character sequence alone -- still renders as furniture, unaffected by token measurement', () => {
  const [page] = wrapText('A { and a } and a | and a ~ mark.', 40, 4);
  assert.deepEqual(page, ['A { and a } and a | and a ~ mark.']);
});

test('a repeated {name} token in one line is each measured at the reserved width, not the literal length', () => {
  // "{name} and {name} again." is 24 literal characters; visually it is
  // 24 + 2*4 = 32 columns (two tokens, each +4 over their own 6 literal
  // characters). A 31-column window must NOT fit it on one line; a
  // 32-column one must.
  const narrow = wrapText('{name} and {name} again.', 31, 4);
  assert.ok(narrow.flat().length > 1, 'two tokens together must not fit a 31-column line');
  const [wide] = wrapText('{name} and {name} again.', 32, 4);
  assert.deepEqual(wide, ['{name} and {name} again.']);
});

test('a plain action project pays for neither the font nor the hearts', () => {
  const project = createProject('Quiet');
  assert.equal(projectUsesText(project), false);
  assert.equal(projectUsesCombat(project), false);
});

test('dialogue, a title screen, an RPG or anything harmful turns the font on', () => {
  const withDialogue = createProject('Talky');
  withDialogue.maps[0].screens[0].entities.push({ actorId: 0, x: 0, y: 0, props: { dialogue: 'Hello.' } });
  assert.equal(projectUsesText(withDialogue), true);

  const withTitle = createProject('Titled');
  withTitle.project.titleMap = 0;
  assert.equal(projectUsesText(withTitle), true);

  assert.equal(projectUsesText(createProject('Quest', 'rpg')), true);

  const withDamage = createProject('Spiky');
  withDamage.sprites.actors.push({ name: 'Spike', damage: 1 });
  assert.equal(projectUsesCombat(withDamage), true);
  assert.equal(projectUsesText(withDamage), true); // combat can reach the game-over screen
});

// P1-1 (docs/design-name-entry.md phase 3 fix round 2): the naming grid IS
// text, so projectUsesText must turn on the moment naming does, on either
// game type -- an action project with hero naming and nothing else, and an
// RPG with only a named Join, both need the glyphs. font.js cannot import
// shared/project.js's own projectUsesNameEntry (the import runs the other
// way), so it carries a duplicate (projectUsesNaming, exported specifically
// for this comparison) of the same formula -- this test is what catches the
// two drifting apart, on every input the predicate can see. projectUsesText
// itself is also checked, but only where its own boolean is not masked by
// gameType === 'rpg' already forcing it true on its own.
test('font.js\'s own projectUsesNaming agrees with shared/project.js\'s projectUsesNameEntry on every input', () => {
  const heroOnly = createProject('Hero only');
  assert.equal(projectUsesNaming(heroOnly), false, 'naming off, nothing else -- no naming yet');
  assert.equal(projectUsesNaming(heroOnly), projectUsesNameEntry(heroOnly));
  assert.equal(projectUsesText(heroOnly), false, 'and, with no other text source, no text either');
  heroOnly.party[0].renamable = true;
  assert.equal(projectUsesNaming(heroOnly), true, 'hero naming alone must read true');
  assert.equal(projectUsesNaming(heroOnly), projectUsesNameEntry(heroOnly));
  assert.equal(projectUsesText(heroOnly), true, 'and turn the font on -- the naming grid IS text');

  // A named Join, RPG-only, with no other text source (no dialogue string --
  // the Join command itself is the only content). projectUsesText cannot
  // isolate this (an RPG is always text, battles alone guarantee it), so the
  // real assertion here is agreement between the two naming predicates
  // directly, not projectUsesText's own already-true boolean.
  const joinOnly = createProject('Join only', 'rpg');
  joinOnly.party.push({ ...createPartyMember(1), renamable: true, startsInParty: false });
  joinOnly.maps[0].screens[0].entities.push({
    actorId: 0,
    x: 0,
    y: 0,
    props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'join', member: 1 }] }] } }
  });
  assert.equal(projectUsesNaming(joinOnly), true, 'a live, real Join naming candidate must read true');
  assert.equal(projectUsesNaming(joinOnly), projectUsesNameEntry(joinOnly));

  joinOnly.party[1].renamable = false;
  assert.equal(projectUsesNaming(joinOnly), false, 'no naming feature is live once the flag is off');
  assert.equal(projectUsesNaming(joinOnly), projectUsesNameEntry(joinOnly));

  // A dangling Join (member null) must not turn naming on, on either side.
  const danglingJoin = createProject('Dangling join', 'rpg');
  danglingJoin.maps[0].screens[0].entities.push({
    actorId: 0,
    x: 0,
    y: 0,
    props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'join', member: null }] }] } }
  });
  assert.equal(projectUsesNaming(danglingJoin), false);
  assert.equal(projectUsesNaming(danglingJoin), projectUsesNameEntry(danglingJoin));

  // A renamable-but-startsInParty member (finding 12's own operand-contract
  // case, docs/design-name-entry.md §9) is never a real naming candidate on
  // either side -- already recruited at boot, so their own Join is inert.
  const inertJoin = createProject('Inert join', 'rpg');
  inertJoin.party.push({ ...createPartyMember(1), renamable: true, startsInParty: true });
  inertJoin.maps[0].screens[0].entities.push({
    actorId: 0,
    x: 0,
    y: 0,
    props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'join', member: 1 }] }] } }
  });
  assert.equal(projectUsesNaming(inertJoin), false);
  assert.equal(projectUsesNaming(inertJoin), projectUsesNameEntry(inertJoin));

  // A switched-off Join must not count either, on either side.
  const offJoin = createProject('Off join', 'rpg');
  offJoin.party.push({ ...createPartyMember(1), renamable: true, startsInParty: false });
  offJoin.maps[0].screens[0].entities.push({
    actorId: 0,
    x: 0,
    y: 0,
    props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'join', member: 1, off: true }] }] } }
  });
  assert.equal(projectUsesNaming(offJoin), false);
  assert.equal(projectUsesNaming(offJoin), projectUsesNameEntry(offJoin));
});

test('a damage metatile only counts once it is actually painted somewhere', () => {
  const project = createProject('Traps');
  project.metatiles[5].collision = 'damage';
  assert.equal(projectUsesCombat(project), false, 'defining a damage tile costs nothing');

  project.maps[0].screens[0].metatiles[0] = 5;
  assert.equal(projectUsesCombat(project), true);
});

test('a live Damage command counts as combat in an action project, but not in an RPG', () => {
  const damageEvent = {
    pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'damage', value: 3 }] }]
  };

  const project = createProject('Trapper');
  project.maps[0].screens[0].entities.push({ actorId: 0, x: 0, y: 0, props: { event: damageEvent } });
  assert.equal(projectUsesCombat(project), true, 'a scripted Damage should reserve the hearts');

  // Structurally identical event, but the RPG's Damage lands on pc_hp
  // (engine/rpg.asm's party_damage), not player_hp -- so it has nothing to
  // do with the hearts HUD this predicate reserves art for.
  const rpg = createProject('Trapper RPG', 'rpg');
  rpg.maps[0].screens[0].entities.push({ actorId: 0, x: 0, y: 0, props: { event: damageEvent } });
  assert.equal(projectUsesCombat(rpg), false, "an RPG's Damage command does not touch player_hp");
});

// Round 2b review, J1: a fourth damage source (engine/ui.asm's
// use_item_apply, round 2) reaches player_hp/hearts in an action project the
// same way a damaging actor, a painted metatile or a live scripted Damage
// command already do -- and unlike the scripted command, an item's effect
// has no live/dead branch to hide inside: itemTables (generate.js) compiles
// every item unconditionally, and use_item applies whichever one is ever
// spent. Before this fix, an action project whose only damage source was a
// damage-kind item built and ran with COMBAT_ENABLED off entirely: no heart
// HUD, no reserved sprite tiles, and -- because projectUsesText also calls
// this predicate -- no font either, so a lethal hit's own game-over message
// would have no glyphs to draw it with.
test('a damage-kind item counts as combat in an action project, but not in an RPG', () => {
  const project = createProject('Bomb-carrier');
  project.items.push({ id: 0, name: 'Bomb', actorId: null, metaspriteId: null, effect: { kind: 'damage', amount: 5 } });
  assert.equal(projectUsesCombat(project), true, 'a damage-kind item should reserve the hearts');
  assert.equal(projectUsesText(project), true, 'combat can reach the game-over screen, so it needs the font too');

  // Structurally identical item, but an RPG's damage-kind item lands on
  // pc_hp through party_damage (engine/rpg.asm), never player_hp --
  // BATTLE_ENABLED reserves that art on its own account, the same carve-out
  // the scripted Damage command already gets a few tests up.
  const rpg = createProject('Bomb-carrier RPG', 'rpg');
  rpg.items.push({ id: 0, name: 'Bomb', actorId: null, metaspriteId: null, effect: { kind: 'damage', amount: 5 } });
  assert.equal(projectUsesCombat(rpg), false, "an RPG's damage-kind item does not touch player_hp");
});

test('a damage-kind item left at amount 0, or a heal-kind item, does not turn combat on', () => {
  const project = createProject('Dud-carrier');
  project.items.push({ id: 0, name: 'Dud', actorId: null, metaspriteId: null, effect: { kind: 'damage', amount: 0 } });
  assert.equal(projectUsesCombat(project), false, 'a damage amount of 0 cannot hurt the player');

  project.items[0].effect.amount = 5;
  assert.equal(projectUsesCombat(project), true, 'raising it off zero should reserve the hearts, the same as any other damage source appearing');

  const healOnly = createProject('Potion-carrier');
  healOnly.items.push({ id: 0, name: 'Potion', actorId: null, metaspriteId: null, effect: { kind: 'heal', amount: 20 } });
  assert.equal(projectUsesCombat(healOnly), false, 'a heal-kind item cannot hurt anybody, at any amount');
});

test('a switched-off Damage command does not turn combat on', () => {
  const project = createProject('Trapper');
  project.maps[0].screens[0].entities.push({
    actorId: 0,
    x: 0,
    y: 0,
    props: {
      event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'damage', value: 3, off: true }] }] }
    }
  });
  assert.equal(projectUsesCombat(project), false, 'a switched-off command must not reserve art the ROM will not use');
});

test('a Damage command left at its default value of 0 does not turn combat on', () => {
  const project = createProject('Trapper');
  // An author who drops a Damage command onto a page and has not typed a
  // number yet gets op: 'damage' with no value set at all -- the same shape
  // defaultCommand (renderer/forges/map/events.js) creates, and the same
  // shape a hand-edited { op: 'damage' } with no value key is. It compiles to
  // OP_DAMAGE, 0, which subtracts nothing, so it must not reserve the hearts.
  project.maps[0].screens[0].entities.push({
    actorId: 0,
    x: 0,
    y: 0,
    props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'damage' }] }] } }
  });
  assert.equal(projectUsesCombat(project), false, 'a Damage of 0 cannot hurt the player');

  // Raising it off zero is the same as any other damage source appearing --
  // consistent with a metatile being painted or a damaging actor being added,
  // not a new special case.
  project.maps[0].screens[0].entities[0].props.event.pages[0].commands[0].value = 2;
  assert.equal(projectUsesCombat(project), true, 'a nonzero Damage should reserve the hearts');
});

test('an event with no dialogue still needs the font', () => {
  const project = createProject('Eventful');
  project.maps[0].screens[0].entities.push({
    actorId: 0,
    x: 0,
    y: 0,
    props: { event: { pages: [{ cond: { type: 'none' }, commands: [{ op: 'setSwitch', switch: 0 }] }] } }
  });
  assert.equal(projectUsesText(project), true);
});

test('party members do not by themselves imply combat art', () => {
  // The predicates key off what the game does, not what it declares.
  const project = createProject('Empty', 'rpg');
  project.party.push(createPartyMember(1, 'Mage'));
  assert.equal(projectUsesCombat(project), false); // no hostile actor yet
  assert.equal(projectUsesText(project), true); // but battles are always text
});

test('an event switched off command by command stops charging for the font', () => {
  // The font costs 96 background tiles in every tileset — or, on MMC3, a whole
  // CHR page. What decides that has to be what the ROM actually contains: an
  // event whose every command is switched off compiles to nothing, so charging
  // for it would bill the author for work they took back, and would fail
  // validateProject over artwork in $A0-$FF that nothing is going to overwrite.
  const project = createProject('Quiet again');
  const page = { cond: { type: 'none', arg: 0 }, commands: [{ op: 'say', text: 'Hello.' }] };
  project.maps[0].screens[0].entities.push({ actorId: 0, x: 0, y: 0, props: { event: { pages: [page] } } });
  assert.equal(projectUsesText(project), true);

  page.commands[0].off = true;
  assert.equal(projectUsesText(project), false, 'nothing left to say, so nothing to say it with');

  // But a page that still runs something keeps it on, even alongside a dead one.
  project.maps[0].screens[0].entities[0].props.event.pages.push({
    cond: { type: 'none', arg: 0 },
    commands: [{ op: 'say', text: 'Still here.' }]
  });
  assert.equal(projectUsesText(project), true);
});
