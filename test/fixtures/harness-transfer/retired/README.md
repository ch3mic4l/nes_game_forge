# Retired harness-transfer evidence (2026-10-11, phase 3b slice S2, commit C1)

Nothing here is live evidence. `checkTransfers` / `liveTransfers` read only the `.json` files directly under `test/fixtures/harness-transfer/`, which now
holds no certificate, so this directory is never discovered. Nothing was restamped; every file is byte-for-byte what it was.

- `harness-transfer-7b1155d0e306-5eb745b13901.json` -- the harness-transfer certificate that carried the plain/bound curve measured by harness `7b1155d0e306`
  to the harness `5eb745b13901` (phase 3b S1b changed `run_sw_manifest.mjs` and `sw_manifest_scene.mjs`). Moved here with `git mv`.
- `archive-7b1155d0e306/` -- its six `.archived` files, the recorded harness `7b1155d0e306` (what the OLD pass executed). Moved with `git mv`.
- `streambound-curve-7b1155d0e306.json` -- the exact bytes of `test/fixtures/streambound-curve.json` at `HEAD` f9d5f42 (`git show HEAD:test/fixtures/streambound-curve.json`),
  the curve the certificate pins (`curve.sha256` f5ade981862b...). Kept so the certificate's validator controls still run against an immutable curve.

Superseded by: C1's fresh A/B/C/R/F/P sweep, written to `test/fixtures/streambound-curve.json`. That sweep ran on the live harness `5eb745b13901`, so its curve
records the live harness and no transfer is needed. The old certificate pins a curve that no longer exists (curve digest, recorded engine, harness and
generator all differ from the fresh curve), so against the live curve it is correctly refused. Where the generator then moved (the post-aggregation margin edit)
the fresh curve is carried by `test/fixtures/identity-cert/s2-c1-metadata.json`, a ROM-identity certificate that needs no transfer pointer.

Used by `test/unit/harnesstransfer.test.js` only, as the historical validator controls: the untouched certificate validates with zero problems against this curve,
this archive and the historical new-side sources, and every rejecting control mutates it from there. Presenting it as active evidence for the fresh curve is
itself a control and is refused.
