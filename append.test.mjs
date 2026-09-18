// node --test backend/scores-repo/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDispatch, sortRows, capRows, stringifyScores, ValidationError, MAX_ROWS, NAME_MAX } from './append.mjs';

function scoreEntry(overrides = {}) {
  return Object.assign({
    runId: 'a'.repeat(32),
    name: 'ROOKIE',
    planet: 'MARS',
    score: 100000,
    coin: 5000,
    furthest: 3,
    won: false,
    when: 1700000000000,
    build: 'v0.3 · DIALECT SLICE'
  }, overrides);
}
const score = (entry) => ({ type: 'score', entry });
const rename = (runId, name) => ({ type: 'rename', entry: { runId, name } });

test('append: a valid score entry lands in an empty board', () => {
  const next = applyDispatch([], score(scoreEntry()));
  assert.equal(next.length, 1);
  assert.equal(next[0].runId, 'a'.repeat(32));
  assert.equal(next[0].name, 'ROOKIE');
  assert.equal(next[0].planet, 'MARS');
});

test('append: score/coin/furthest/won/when/build all round-trip', () => {
  const entry = scoreEntry({ score: 42, coin: 7, furthest: 8, won: true, when: 5, build: 'b1' });
  const [row] = applyDispatch([], score(entry));
  assert.equal(row.score, 42);
  assert.equal(row.coin, 7);
  assert.equal(row.furthest, 8);
  assert.equal(row.won, true);
  assert.equal(row.when, 5);
  assert.equal(row.build, 'b1');
});

test('dedupe: a second score dispatch for the same runId replaces, not duplicates', () => {
  const runId = 'b'.repeat(32);
  let board = applyDispatch([], score(scoreEntry({ runId, score: 100 })));
  board = applyDispatch(board, score(scoreEntry({ runId, score: 999 })));
  assert.equal(board.length, 1);
  assert.equal(board[0].score, 999);
});

test('rename: changes only the name of the matching runId', () => {
  const runId = 'c'.repeat(32);
  let board = applyDispatch([], score(scoreEntry({ runId, name: 'OLDNAME', score: 10 })));
  board = applyDispatch(board, score(scoreEntry({ runId: 'd'.repeat(32), name: 'OTHER', score: 5 })));
  board = applyDispatch(board, rename(runId, 'newname'));
  const row = board.find(r => r.runId === runId);
  assert.equal(row.name, 'NEWNAME');   // uppercased like a fresh score entry
  const other = board.find(r => r.runId === 'd'.repeat(32));
  assert.equal(other.name, 'OTHER');   // untouched
});

test('rename: a runId with no matching row is a no-op, not a rejection', () => {
  const board = applyDispatch([], score(scoreEntry({ runId: 'e'.repeat(32) })));
  const next = applyDispatch(board, rename('f'.repeat(32), 'GHOST'));
  assert.equal(next.length, 1);
  assert.equal(next.find(r => r.name === 'GHOST'), undefined);
});

test('rename: a name over NAME_MAX chars is truncated, not rejected', () => {
  const runId = 'g'.repeat(32);
  let board = applyDispatch([], score(scoreEntry({ runId })));
  board = applyDispatch(board, rename(runId, 'WAY TOO LONG A NAME FOR THE BOARD'));
  assert.ok(board[0].name.length <= NAME_MAX);
});

test('rejection: missing runId throws ValidationError', () => {
  const entry = scoreEntry(); delete entry.runId;
  assert.throws(() => applyDispatch([], score(entry)), ValidationError);
});

test('rejection: a runId shorter than 16 chars throws', () => {
  assert.throws(() => applyDispatch([], score(scoreEntry({ runId: 'short' }))), ValidationError);
});

test('rejection: an unknown planet throws', () => {
  assert.throws(() => applyDispatch([], score(scoreEntry({ planet: 'PLUTO' }))), ValidationError);
});

test('rejection: a negative score throws', () => {
  assert.throws(() => applyDispatch([], score(scoreEntry({ score: -1 }))), ValidationError);
});

test('rejection: a non-integer coin throws', () => {
  assert.throws(() => applyDispatch([], score(scoreEntry({ coin: 4.5 }))), ValidationError);
});

test('rejection: furthest out of the 1..8 range throws', () => {
  assert.throws(() => applyDispatch([], score(scoreEntry({ furthest: 0 }))), ValidationError);
  assert.throws(() => applyDispatch([], score(scoreEntry({ furthest: 9 }))), ValidationError);
});

test('rejection: a non-boolean won throws', () => {
  assert.throws(() => applyDispatch([], score(scoreEntry({ won: 'yes' }))), ValidationError);
});

test('rejection: a non-epoch when throws', () => {
  assert.throws(() => applyDispatch([], score(scoreEntry({ when: -5 }))), ValidationError);
  assert.throws(() => applyDispatch([], score(scoreEntry({ when: 'now' }))), ValidationError);
});

test('rejection: an empty build string throws', () => {
  assert.throws(() => applyDispatch([], score(scoreEntry({ build: '  ' }))), ValidationError);
});

test('rejection: an unknown dispatch type throws', () => {
  assert.throws(() => applyDispatch([], { type: 'delete', entry: scoreEntry() }), ValidationError);
});

test('rejection: a non-array current board throws', () => {
  assert.throws(() => applyDispatch(null, score(scoreEntry())), ValidationError);
});

test('cap: more than MAX_ROWS entries keeps only the top MAX_ROWS by sort order', () => {
  let board = [];
  for (let i = 0; i < MAX_ROWS + 5; i++) {
    board = applyDispatch(board, score(scoreEntry({
      runId: String(i).padStart(32, '0'), score: i, furthest: 8, won: false
    })));
  }
  assert.equal(board.length, MAX_ROWS);
  // highest scores survive the cap
  assert.equal(board[0].score, MAX_ROWS + 4);
  assert.equal(board[board.length - 1].score, 5);
});

test('sort: furthest desc, then won desc, then score desc, then coin desc, then when asc', () => {
  const rows = [
    scoreEntry({ runId: 'a'.repeat(32), furthest: 5, won: false, score: 10, coin: 0, when: 2 }),
    scoreEntry({ runId: 'b'.repeat(32), furthest: 8, won: false, score: 10, coin: 0, when: 3 }),
    scoreEntry({ runId: 'c'.repeat(32), furthest: 8, won: true, score: 1, coin: 0, when: 4 }),
    scoreEntry({ runId: 'd'.repeat(32), furthest: 8, won: false, score: 50, coin: 100, when: 1 }),
    scoreEntry({ runId: 'e'.repeat(32), furthest: 8, won: false, score: 50, coin: 50, when: 5 })
  ];
  const sorted = sortRows(rows).map(r => r.runId[0]);
  assert.deepEqual(sorted, ['c', 'd', 'e', 'b', 'a']);
});

test('capRows sorts before capping', () => {
  const rows = [scoreEntry({ runId: 'x'.repeat(32), score: 1 }), scoreEntry({ runId: 'y'.repeat(32), score: 99 })];
  const capped = capRows(rows);
  assert.equal(capped[0].score, 99);
});

test('stringifyScores is deterministic regardless of input key order', () => {
  const a = { runId: 'z'.repeat(32), name: 'A', planet: 'MARS', score: 1, coin: 0, furthest: 1, won: false, when: 1, build: 'b' };
  const b = { build: 'b', when: 1, won: false, furthest: 1, coin: 0, score: 1, planet: 'MARS', name: 'A', runId: 'z'.repeat(32) };
  assert.equal(stringifyScores([a]), stringifyScores([b]));
  assert.ok(stringifyScores([a]).endsWith('\n'));
});
