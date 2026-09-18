# rps-plus-scores

The global high-score board for [RPS+](../../README.md). This is a throwaway,
public, single-purpose repo: it holds one file, `scores.json`, an array of up
to 100 run entries, and a workflow that appends to it. It exists only so the
game's phones have somewhere public to write a score to and read a board from
— it is not a general backend and should never grow one.

This folder is prepared inside the private RPS+ source repo and pushed into
`yotamdror/rps-plus-scores` once that public repo exists (see the design
doc's §10/§10a/§10b and `docs/plans/2026-09-18-ui-backend-tuning-plan.md`
§W3). Everything under `backend/scores-repo/` here *is* the root of that repo
— `scores.json`, `append.mjs`, `.github/workflows/scores.yml`, this file.

## The only guard is the token

There is no login, no moderation, and no rate limiting beyond GitHub's own.
**The fine-grained personal access token is the only thing standing between
this file and anyone who has it.** Scope it to exactly this repository with
`Contents: read and write` and nothing else. Anyone holding a valid token can
dispatch a `score` or `rename` event and have it merged — `append.mjs`
validates *shape and bounds* (is this a plausible run?), not who sent it or
whether the run actually happened. Treat a leaked token as a compromised
board: revoke it, and if `scores.json` needs cleaning up, edit it directly
and commit — the workflow only appends, it never reads back its own history
for anomalies.

Reads (the raw `scores.json` URL below) are public and need no token at all;
only writes (the `repository_dispatch` calls) require one.

## Payload shapes

The workflow triggers on a `repository_dispatch` whose `client_payload` is
already the exact object `append.mjs`'s `applyDispatch(current, dispatch)`
takes — the workflow step passes it straight through as `SCORES_PAYLOAD`, no
reshaping. Both the client (`src/js/25b-scores.js`'s `Scores.submit`/
`Scores.rename` in the main RPS+ repo) and `append.mjs` agree on this shape;
see `append.mjs` for the exact bounds each field is checked against.

**`score`** — appends a finished run, or replaces the existing row for the
same `runId` (so re-accepting or a retried dispatch never duplicates a run):

```json
{
  "event_type": "score",
  "client_payload": {
    "type": "score",
    "entry": {
      "runId": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
      "name": "ROOKIE",
      "planet": "MARS",
      "score": 482300,
      "coin": 125000,
      "furthest": 8,
      "won": true,
      "when": 1758000000000,
      "build": "v0.3 · DIALECT SLICE"
    }
  }
}
```

- `name`: ≤14 chars, stored uppercased.
- `planet`: one of the eight home worlds (MERCURY, VENUS, EARTH, MARS,
  JUPITER, SATURN, URANUS, NEPTUNE).
- `score` / `coin`: non-negative integers.
- `furthest`: integer 1..8 — which match the run reached (8 = THE FINAL,
  win or lose; `won` is what tells the two apart).
- `won`: boolean.
- `when`: epoch milliseconds.
- `runId`: a 16-32 character token (the client generates one per run with
  `crypto.randomUUID()` or a fallback).
- `build`: a short string — the game's version tag.

**`rename`** — changes only the `name` on an existing `runId` (a no-op if
that `runId` isn't on the board):

```json
{
  "event_type": "rename",
  "client_payload": {
    "type": "rename",
    "entry": { "runId": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4", "name": "NEWNAME" }
  }
}
```

Either payload that fails validation fails the workflow run (a clear signal
in Actions) rather than silently corrupting `scores.json`.

## Sort and cap

`furthest` desc, then `won` desc, then `score` desc, then `coin` desc, then
`when` asc — survival first, matching the design doc's §10 tri-key, with
`won` breaking the tie between a champion and a beaten finalist who both
reached match 8. Capped at 100 rows after every write.

## Reading the board

```
https://raw.githubusercontent.com/yotamdror/rps-plus-scores/main/scores.json
```

Fetched with `cache:'no-store'`; no token needed. The client merges this
device's own locally-committed runs on top by `runId` so a just-accepted run
ranks immediately even if the raw copy hasn't caught up.

## Local testing

`append.mjs` is a pure function (`applyDispatch`) plus a small CLI wrapper —
it never touches the network, so it's fully testable without GitHub:

```
node --test backend/scores-repo/append.test.mjs
```

or, as a CLI, against a real fixture file:

```
SCORES_PAYLOAD='{"type":"score","entry":{...}}' node append.mjs scores.json
```
