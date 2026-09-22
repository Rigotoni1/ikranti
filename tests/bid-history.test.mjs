import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const nativeRequire = createRequire(import.meta.url);
function load(file, overrides = {}) {
  const compiled = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => overrides[name] || nativeRequire(name), module, module.exports);
  return module.exports;
}
const model = load('../lib/bid-history.ts');
const styles = new Proxy({}, { get: (_target, property) => String(property) });
const auctionClock = load('../app/use-auction-ended.ts');
const components = load('../app/bid-history.tsx', { '@/lib/bid-history': model, './bid-history.module.css': { default: styles }, './use-auction-ended': auctionClock });
const entry = (id, mine = false, kind = 'bid') => ({ id: String(id), amount: 100 + Number(id), is_mine: mine, is_leading: false, kind, created_at: '2026-09-22T12:00:00Z' });
function history(ids = [1, 2], version = 1) {
  const entries = ids.map(id => entry(id, id === 1));
  if (entries.length) entries.at(-1).is_leading = true;
  return { auction_id: 'lot-a', entries, snapshot: null, leading_entry_id: ids.length ? String(ids.at(-1)) : null, has_more: ids[0] > 1, next_before: ids[0] > 1 ? String(ids[0]) : null,
    auction: { current_bid: 125, bid_count: ids.length, end_at: '2099-01-01T00:00:00Z', status: 'live', reserve_met: false, has_reserve: true, version, has_bids: Boolean(ids.length), viewer_leading: false } };
}
const props = (data = history()) => ({ history: data, loading: false, error: '', olderLoading: false, olderError: '', connection: 'live', refresh() {}, loadOlder() {} });
const html = p => renderToStaticMarkup(createElement(components.BidHistory, p));

test('chat shows Your Bid with own styling, Floor bid for others, and latest at the bottom', () => {
  const h = history([1, 2]); h.entries[1].kind = 'automatic';
  const result = html(props(h));
  assert.match(result, /message own/);
  assert.match(result, /Your Bid/);
  assert.match(result, /Floor bid/);
  assert.ok(result.indexOf('€101.00') < result.indexOf('€102.00'));
  assert.match(result, /Automatic bid/);
  assert.equal((result.match(/class="leadBadge"/g) || []).length, 1);
  assert.match(result, /role="log"/);
  assert.match(result, /aria-label="Bid messages, oldest to newest"/);
  const css = readFileSync(new URL('../app/bid-history.module.css', import.meta.url), 'utf8');
  assert.match(css, /\.own \.avatar \{ background: #2d8756/);
  assert.match(css, /\.avatar \{[^}]+background: #515955/);
});

test('tie priority and honest legacy snapshots are explained', () => {
  const h = history([1, 2]); h.entries[1].kind = 'priority';
  assert.match(html(props(h)), /earlier bidder keeps the lead/);
  h.entries = []; h.snapshot = { ...entry('1'), id: 'snapshot', kind: 'snapshot', created_at: null, is_leading: true };
  const result = html(props(h));
  assert.match(result, /Earlier bid-by-bid history is unavailable/);
  assert.doesNotMatch(result, /<time/);
});

test('empty, loading, failure, offline and pagination states have useful actions', () => {
  assert.match(html(props(history([]))), /No bids yet/);
  assert.match(html({ ...props(null), loading: true }), /Loading bid history/);
  assert.match(html({ ...props(null), error: 'Connection failed.' }), /Try again/);
  assert.match(html({ ...props(), connection: 'offline' }), /These bids may be out of date/);
  assert.match(html(props(history([10, 11]))), /Load earlier bids/);
});

test('leading is not described as winning until the sold outcome', () => {
  const h = history(); h.auction.viewer_leading = true;
  assert.equal(model.bidLeaderText(h), 'Your Bid · You’re leading');
  h.auction.status = 'reserve_not_met';
  assert.equal(model.bidLeaderText(h), 'Auction ended · Reserve not met');
  h.auction.status = 'sold';
  assert.equal(model.bidLeaderText(h), 'Your Bid · Winning bid');
  h.auction.status = 'live'; h.auction.end_at = '2020-01-01T00:00:00Z';
  assert.match(model.bidLeaderText(h, true), /Awaiting result/);
});

test('refresh merges stable IDs, preserves earlier pages and removes old leader badges', () => {
  const current = history([1, 2, 3]);
  const updated = model.mergeBidHistory(current, history([3, 4], 2));
  assert.deepEqual(updated.entries.map(e => e.id), ['1', '2', '3', '4']);
  assert.deepEqual(updated.entries.filter(e => e.is_leading).map(e => e.id), ['4']);
  assert.equal(updated.has_more, false);
  assert.equal(model.mergeBidHistory(updated, current), updated, 'stale response cannot regress the leader');
});

test('pagination keeps the latest leader; reconnects cannot silently leave gaps', () => {
  const head = history([5, 6], 3);
  const older = model.mergeBidHistory(head, history([1, 2, 3, 4], 3), true);
  assert.equal(older.entries.length, 6);
  assert.deepEqual(older.entries.filter(e => e.is_leading).map(e => e.id), ['6']);
  const reconnected = model.mergeBidHistory(older, history([100, 101], 9));
  assert.deepEqual(reconnected.entries.map(e => e.id), ['100', '101']);
  assert.equal(reconnected.has_more, true);
});

// Exercise the actual subscription hook without opening a browser or contacting live auctions.
function hookHarness() {
  const originals = new Map(['window', 'document', 'navigator'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const listeners = new Map(), intervals = new Set(), channels = [], calls = [];
  const add = (type, fn) => listeners.set(type, fn);
  const remove = type => listeners.delete(type);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { setTimeout, clearTimeout, setInterval: fn => { intervals.add(fn); return fn; }, clearInterval: fn => intervals.delete(fn), addEventListener: add, removeEventListener: remove } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { visibilityState: 'visible', addEventListener: add, removeEventListener: remove } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
  let cursor = 0, dirty = false, effects = [], currentProps = ['lot-a', 'viewer-a', 0], result;
  const cells = [];
  const useState = initial => { const index = cursor++; if (!cells[index]) cells[index] = { value: typeof initial === 'function' ? initial() : initial }; return [cells[index].value, value => { const next = typeof value === 'function' ? value(cells[index].value) : value; if (next !== cells[index].value) { cells[index].value = next; dirty = true; } }]; };
  const hooks = { useState, useRef: initial => useState(() => ({ current: initial }))[0], useCallback: (fn, deps) => {
    const index = cursor++, old = cells[index];
    if (!old || deps.some((value, i) => value !== old.deps[i])) cells[index] = { value: fn, deps };
    return cells[index].value;
  }, useEffect: (effect, deps) => {
    const index = cursor++, old = cells[index];
    if (!old || deps.some((value, i) => value !== old.deps[i])) effects.push(() => { old?.cleanup?.(); cells[index] = { deps, cleanup: effect() }; });
  } };
  const client = {
    rpc(name, args) { return { abortSignal(signal) { return new Promise(resolve => { calls.push({ name, args, resolve, signal }); signal.addEventListener('abort', () => resolve({ data: null, error: { message: 'aborted' } }), { once: true }); }); } }; },
    channel() { const ch = { handlers: {}, removed: false, on(name, _filter, fn) { ch.handlers[name] = fn; return ch; }, subscribe(fn) { ch.status = fn; return ch; } }; channels.push(ch); return ch; },
    removeChannel(ch) { ch.removed = true; return Promise.resolve(); },
  };
  const { useBidHistory } = load('../app/use-bid-history.ts', { react: hooks, '@/lib/supabase/browser': { browserClient: () => client }, '@/lib/bid-history': model });
  const render = (...args) => {
    if (args.length) currentProps = args;
    let attempts = 0;
    do { dirty = false; cursor = 0; effects = []; result = useBidHistory(...currentProps); const pending = effects; effects = []; pending.forEach(fn => fn()); assert.ok(++attempts < 12, 'hook settles'); } while (dirty);
    return result;
  };
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const complete = async (index, data = history(), error = null) => { calls[index].resolve({ data, error }); await tick(); return render(); };
  const cleanup = () => { cells.forEach(cell => cell?.cleanup?.()); for (const [name, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } };
  render();
  return { calls, channels, listeners, intervals, render, complete, cleanup, tick };
}

test('realtime re-subscription fetches missed bids and coalesces bursts', async () => {
  const h = hookHarness();
  try {
    assert.equal(h.calls.length, 1);
    h.channels[0].status('SUBSCRIBED');
    h.channels[0].handlers.postgres_changes();
    assert.equal(h.calls.length, 1, 'in-flight reads are coalesced');
    await h.complete(0);
    assert.equal(h.calls.length, 2, 'dirty head is fetched once after in-flight read');
    await h.complete(1, history([1, 2, 3], 2));
    assert.equal(h.render().history.entries.length, 3);
    h.channels[0].status('CHANNEL_ERROR');
    assert.equal(h.render().connection, 'reconnecting');
    h.channels[0].status('SUBSCRIBED');
    assert.equal(h.calls.length, 3, 'reconnect fetches the current head');
    await h.complete(2, history([3, 4], 3));
    assert.equal(h.render().history.leading_entry_id, '4');
    assert.deepEqual(Object.keys(h.calls[0].args).sort(), ['p_auction', 'p_before', 'p_limit']);
  } finally { h.cleanup(); }
});

test('viewer changes clear personalized history and reject late responses', async () => {
  const h = hookHarness();
  try {
    await h.complete(0);
    h.render().refresh();
    const before = h.calls.length;
    const state = h.render('lot-a', 'viewer-b', 0);
    assert.equal(state.history, null);
    assert.equal(h.channels[0].removed, true);
    assert.equal(h.calls[before - 1].signal.aborted, true);
    const newHistory = history(); newHistory.entries.forEach(e => { e.is_mine = false; });
    await h.complete(before, newHistory);
    assert.equal(h.render().history.entries.some(e => e.is_mine), false);
    h.render('lot-b', 'viewer-b', 0);
    assert.equal(h.render().history, null);
    h.render(null, 'viewer-b', 0);
    assert.equal(h.channels.at(-1).removed, true);
  } finally { h.cleanup(); }
});

test('errors remove stale labels, preserve a retry action and recover', async () => {
  const h = hookHarness();
  try {
    await h.complete(0);
    h.render().refresh();
    await h.complete(1, null, { message: 'session expired' });
    assert.equal(h.render().history, null);
    assert.match(h.render().error, /couldn’t be refreshed/);
    h.render().refresh();
    await h.complete(2);
    assert.equal(h.render().error, '');
    assert.ok(h.render().history);
  } finally { h.cleanup(); }
});

test('offline/visibility and explicit bid revisions refresh only when needed', async () => {
  const h = hookHarness();
  try {
    await h.complete(0);
    h.channels[0].status('SUBSCRIBED');
    await h.complete(1);
    h.intervals.forEach(fn => fn());
    assert.equal(h.calls.length, 2, 'no periodic polling while live');
    h.listeners.get('offline')();
    assert.equal(h.render().connection, 'offline');
    h.listeners.get('online')();
    await h.complete(2);
    h.listeners.get('visibilitychange')();
    await h.complete(3);
    h.render('lot-a', 'viewer-a', 1);
    assert.equal(h.calls.length, 5, 'successful bid revision refreshes even if realtime missed it');
    await h.complete(4);
  } finally { h.cleanup(); }
});

test('an older page racing a large reconnect cannot splice a hidden gap into the chat', async () => {
  const h = hookHarness();
  try {
    await h.complete(0, history([50, 51], 1));
    h.render().loadOlder();
    assert.equal(h.calls[1].args.p_before, '50');
    h.render().refresh();
    await h.complete(2, history([100, 101], 3));
    await h.complete(1, history([48, 49], 1));
    assert.deepEqual(h.render().history.entries.map(e => e.id), ['100', '101']);
    assert.equal(h.render().history.next_before, '100');
  } finally { h.cleanup(); }
});
