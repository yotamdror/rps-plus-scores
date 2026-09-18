#!/usr/bin/env node
// Pure append/validate/sort/cap logic for the RPS+ global scores board, plus a
// CLI entry point scores.yml calls with the repository_dispatch payload.
// See README.md for the payload shapes and what guards this repo.
//
//   node append.mjs [scoresPath]     reads/writes scoresPath (default scores.json
//                                     in the current directory); the dispatch
//                                     payload comes from the SCORES_PAYLOAD env var
//                                     as JSON text: {"type":"score"|"rename","entry":{...}}
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The eight home worlds (§5c) — kept in sync with PLANETS in src/js/22-ceremony.js
// by hand; this repo is deliberately dependency-free and does not import the game.
export const PLANETS = ['MERCURY', 'VENUS', 'EARTH', 'MARS', 'JUPITER', 'SATURN', 'URANUS', 'NEPTUNE'];
export const MAX_ROWS = 100;
export const NAME_MAX = 14;
const BUILD_MAX = 60;
const RUNID_RE = /^[A-Za-z0-9_-]{16,32}$/;

export class ValidationError extends Error {}

const isNonNegInt = v => Number.isInteger(v) && v >= 0;

function validateRunId(runId) {
  if (typeof runId !== 'string' || !RUNID_RE.test(runId)) throw new ValidationError('runId must be a 16-32 char token');
  return runId;
}
// Bounded to NAME_MAX and uppercased rather than rejected — the client already
// enforces maxlength=14 on both name inputs, so an overlong name here means an
// older/different client, not a malformed payload worth failing the whole dispatch.
function validateName(name) {
  if (typeof name !== 'string') throw new ValidationError('name must be a string');
  const trimmed = name.trim();
  if (!trimmed) throw new ValidationError('name must not be empty');
  return trimmed.toUpperCase().slice(0, NAME_MAX);
}
function validateScoreEntry(entry) {
  if (!entry || typeof entry !== 'object') throw new ValidationError('entry must be an object');
  const runId = validateRunId(entry.runId);
  const name = validateName(entry.name);
  if (typeof entry.planet !== 'string' || !PLANETS.includes(entry.planet.toUpperCase()))
    throw new ValidationError('planet must be one of the eight home worlds');
  if (!isNonNegInt(entry.score)) throw new ValidationError('score must be a non-negative integer');
  if (!isNonNegInt(entry.coin)) throw new ValidationError('coin must be a non-negative integer');
  if (!Number.isInteger(entry.furthest) || entry.furthest < 1 || entry.furthest > 8)
    throw new ValidationError('furthest must be an integer 1..8');
  if (typeof entry.won !== 'boolean') throw new ValidationError('won must be a boolean');
  if (!Number.isInteger(entry.when) || entry.when <= 0) throw new ValidationError('when must be an epoch-ms integer');
  if (typeof entry.build !== 'string' || !entry.build.trim()) throw new ValidationError('build must be a short string');
  return {
    runId, name, planet: entry.planet.toUpperCase(),
    score: entry.score, coin: entry.coin, furthest: entry.furthest, won: entry.won,
    when: entry.when, build: entry.build.trim().slice(0, BUILD_MAX)
  };
}
function validateRenamePayload(entry) {
  if (!entry || typeof entry !== 'object') throw new ValidationError('entry must be an object');
  return { runId: validateRunId(entry.runId), name: validateName(entry.name) };
}
// §10 tri-key (furthest, score, coin) with `won` slotted in right after
// furthest: furthest is capped at 8 (a champion "reached" the same final match
// a beaten finalist did), so `won` is what keeps survival ranking above a
// depth-only run at the same furthest value.
export function cmpRows(a, b) {
  return (b.furthest - a.furthest) || ((b.won ? 1 : 0) - (a.won ? 1 : 0)) ||
    (b.score - a.score) || (b.coin - a.coin) || (a.when - b.when);
}
export function sortRows(rows) { return rows.slice().sort(cmpRows); }
export function capRows(rows) { return sortRows(rows).slice(0, MAX_ROWS); }

// current: the array currently in scores.json. dispatch: {type:'score'|'rename', entry}.
// Returns a new, sorted, capped array. Throws ValidationError on a malformed payload.
export function applyDispatch(current, dispatch) {
  if (!Array.isArray(current)) throw new ValidationError('current scores must be an array');
  if (!dispatch || typeof dispatch !== 'object') throw new ValidationError('dispatch payload must be an object');
  if (dispatch.type === 'score') {
    const entry = validateScoreEntry(dispatch.entry);
    const next = current.filter(r => !(r && r.runId === entry.runId));   // append or replace by runId
    next.push(entry);
    return capRows(next);
  }
  if (dispatch.type === 'rename') {
    const { runId, name } = validateRenamePayload(dispatch.entry);
    const next = current.map(r => (r && r.runId === runId) ? Object.assign({}, r, { name }) : r);
    return capRows(next);   // a no-op for an unknown runId — nothing to rename, not malformed
  }
  throw new ValidationError(`unknown dispatch type: ${dispatch.type}`);
}

const ROW_KEYS = ['runId', 'name', 'planet', 'score', 'coin', 'furthest', 'won', 'when', 'build'];
const canonicalRow = row => ROW_KEYS.reduce((out, k) => { out[k] = row[k]; return out; }, {});
// Deterministic JSON: fixed key order per row, 2-space indent, trailing newline —
// so two runs on the same logical state produce byte-identical output.
export function stringifyScores(rows) { return JSON.stringify(rows.map(canonicalRow), null, 2) + '\n'; }

function readCurrent(path) {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, 'utf8').trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new ValidationError(`${path} must contain a JSON array`);
  return parsed;
}

function main() {
  const path = process.argv[2] || 'scores.json';
  const payloadRaw = process.env.SCORES_PAYLOAD;
  if (!payloadRaw) { console.error('SCORES_PAYLOAD env var is required'); process.exit(1); }
  let dispatch;
  try { dispatch = JSON.parse(payloadRaw); }
  catch (e) { console.error('SCORES_PAYLOAD is not valid JSON: ' + e.message); process.exit(1); }
  const current = readCurrent(path);
  const next = applyDispatch(current, dispatch);
  writeFileSync(path, stringifyScores(next));
  console.log(`wrote ${next.length} row(s) to ${path}`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  try { main(); } catch (e) { console.error(e.message || String(e)); process.exit(1); }
}
