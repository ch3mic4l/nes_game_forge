// Small art/screen helpers shared by every tools/make-*-sample.js generator.
// `tile`, `split16` and `metasprite` live in shared/library/authoring.js;
// `screenFromArt` lives in shared/starters/authoring.js (docs/design-
// starter-projects.md §3.3 -- moved out of this file, which the starter
// projects now share the identical legend/screen idiom with). Both are
// re-exported here, unchanged, so every generator keeps importing all four
// from this one file.
export { tile, split16, metasprite } from '../shared/library/authoring.js';
export { screenFromArt } from '../shared/starters/authoring.js';
