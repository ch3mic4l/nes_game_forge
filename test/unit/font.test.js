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
  charToTile,
  textToTiles,
  wrapText,
  projectUsesText,
  projectUsesCombat
} from '../../shared/font.js';
import { createProject, createPartyMember } from '../../shared/project.js';
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

test('a damage metatile only counts once it is actually painted somewhere', () => {
  const project = createProject('Traps');
  project.metatiles[5].collision = 'damage';
  assert.equal(projectUsesCombat(project), false, 'defining a damage tile costs nothing');

  project.maps[0].screens[0].metatiles[0] = 5;
  assert.equal(projectUsesCombat(project), true);
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
