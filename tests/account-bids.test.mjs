import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const nativeRequire = createRequire(import.meta.url);
const source = readFileSync(new URL('../app/account/bid-activity.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const bid = (status, overrides = {}) => ({ auction_id: status, title: `${status} auction`, category: 'Watches & Jewellery', current_bid: 8900, my_maximum: 8800, end_at: '2099-01-01T12:00:00Z', bid_status: status, bid_count: 4, order_id: null, order_status: null, ...overrides });
const fixture = [bid('leading', { my_maximum: 9500 }), bid('outbid'), bid('won', { order_id: 'order-1', order_status: 'payment_due' }), bid('lost')];

// Exercise the real component's rendering, events and effect lifecycle without a browser or live bids.
function harness() {
  const original = new Map(['window', 'document'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const listeners = new Map(), timers = new Set(), deferred = [], calls = [], cells = [];
  const add = (name, fn) => listeners.set(name, fn);
  const remove = name => listeners.delete(name);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { setTimeout: fn => deferred.push(fn), setInterval: fn => { timers.add(fn); return fn; }, clearInterval: fn => timers.delete(fn), addEventListener: add, removeEventListener: remove } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { visibilityState: 'visible', addEventListener: add, removeEventListener: remove } });
  let cursor = 0, effect, cleanup, started = false, authChanged, unsubscribed = false, removed = false, tree, updates = 0;
  const useState = initial => {
    const index = cursor++;
    if (!cells[index]) cells[index] = { value: initial };
    return [cells[index].value, value => { cells[index].value = value; updates++; }];
  };
  const channel = { changes: [], on(_name, _filter, fn) { this.changes.push(fn); return this; }, subscribe(fn) { this.status = fn; return this; } };
  const client = {
    rpc(...args) { return new Promise((resolve, reject) => calls.push({ args, resolve, reject })); },
    auth: { onAuthStateChange(fn) { authChanged = fn; return { data: { subscription: { unsubscribe() { unsubscribed = true; } } } }; } },
    channel: () => channel, removeChannel: async () => { removed = true; },
  };
  const mocked = {
    react: { useState, useRef: value => useState({ current: value })[0], useCallback: fn => fn, useEffect: fn => { if (!started) effect = fn; } },
    'next/link': { default: ({children, ...props}) => createElement('a', props, children) },
    '@/lib/supabase/browser': { browserClient: () => client },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => mocked[name] || nativeRequire(name), module, module.exports);
  const Component = module.exports.default;
  const render = (props = {}) => { cursor = 0; tree = Component(props); return renderToStaticMarkup(tree); };
  const start = () => { render(); started = true; cleanup = effect(); };
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const complete = async (index, data = fixture, error = null) => { calls[index].resolve({ data, error }); await tick(); return render(); };
  const find = (node, predicate) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const child of node) { const result = find(child, predicate); if (result) return result; } return; }
    return predicate(node) ? node : find(node.props?.children, predicate);
  };
  const click = text => { const button = find(tree, node => node.type === 'button' && node.props.children === text); assert.ok(button, `button ${text} exists`); button.props.onClick(); return render(); };
  const clickLink = href => { const link = find(tree, node => node.props?.href === href); assert.ok(link, `link ${href} exists`); link.props.onClick?.(); };
  const dispose = () => { cleanup?.(); cleanup = null; };
  const restore = () => { dispose(); for (const [name, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } };
  return { render, start, complete, click, clickLink, calls, channel, listeners, timers, deferred, tick, dispose, restore, authChanged: () => authChanged(), updates: () => updates, cleaned: () => unsubscribed && removed };
}

test('account bid activity displays private maximum, position and all five working filters', async () => {
  const h = harness();
  try {
    h.start();
    const html = await h.complete(0);
    assert.deepEqual(h.calls[0].args, ['ir_my_bids'], 'no browser-selected identity');
    assert.match(html, /<h2>My bids<\/h2>/);
    assert.doesNotMatch(html, /<main|<header|<h1/);
    for (const text of ['You’re leading', 'Outbid', '€8,900.00', '€8,800.00', 'Total bids', 'Closes']) assert.ok(html.includes(text));
    for (const [filter, count] of [['Active', 2], ['Outbid', 1], ['Won', 1], ['Closed', 2], ['All', 4]]) {
      const filtered = h.click(filter);
      assert.equal((filtered.match(/<article/g) || []).length, count);
      assert.ok(filtered.includes(`aria-pressed="true">${filter}</button>`));
    }
    assert.match(h.render({ standalone: true }), /<h1>My bids<\/h1>/);
  } finally { h.restore(); }
});

test('bids expose loading, empty, error, retry and expired-auction states', async () => {
  const h = harness();
  try {
    h.start();
    assert.match(h.render(), /Loading your bids/);
    assert.match(await h.complete(0, []), /You haven’t placed a bid yet/);
    h.click('Refresh bids');
    assert.match(await h.complete(1, null, { message: 'Sign in required' }), /role="alert"/);
    h.click('Refresh bids');
    h.calls[2].reject(new Error('Network error')); await h.tick();
    assert.match(h.render(), /Check your connection and try again/);
    h.click('Refresh bids');
    const expired = await h.complete(3, [bid('leading', { end_at: '2020-01-01T00:00:00Z' })]);
    assert.match(expired, /Awaiting final result/);
    assert.doesNotMatch(expired, /View auction \/ increase maximum/);
  } finally { h.restore(); }
});

test('embedded order and setup links select the matching account section', async () => {
  const h = harness();
  try {
    h.start(); await h.complete(0);
    const selected = [];
    h.render({ onAccountTabChange: tab => selected.push(tab) });
    h.clickLink('/account?tab=orders');
    h.click('Refresh bids'); await h.complete(1, null, { message: 'Finish setup' });
    h.render({ onAccountTabChange: tab => selected.push(tab) });
    h.clickLink('/account?tab=settings');
    assert.deepEqual(selected, ['Orders', 'Settings']);
  } finally { h.restore(); }
});

test('realtime, reconnect and visibility refresh bids without polling', async () => {
  const h = harness();
  try {
    h.start(); await h.complete(0);
    h.channel.status('SUBSCRIBED'); await h.complete(1);
    assert.match(h.render(), /Live updates connected/);
    h.timers.forEach(fn => fn()); assert.equal(h.calls.length, 2);
    h.channel.changes[0](); await h.complete(2, [bid('outbid')]);
    assert.doesNotMatch(h.render(), /leading auction/);
    h.listeners.get('offline')(); assert.match(h.render(), /Status may be outdated/);
    h.listeners.get('online')(); await h.complete(3);
    h.channel.status('SUBSCRIBED'); await h.complete(4);
    h.listeners.get('visibilitychange')(); await h.complete(5);
    assert.equal(h.calls.length, 6);
    h.dispose(); assert.ok(h.cleaned()); assert.equal(h.listeners.size, 0); assert.equal(h.timers.size, 0);
  } finally { h.restore(); }
});

test('auth changes and unmounts invalidate in-flight private bid responses', async () => {
  const h = harness();
  try {
    h.start(); await h.complete(0);
    h.click('Refresh bids');
    h.authChanged();
    assert.doesNotMatch(h.render(), /leading auction|€8,800/);
    await h.complete(1);
    assert.doesNotMatch(h.render(), /leading auction|€8,800/);
    h.deferred.forEach(fn => fn());
    await h.complete(2, []);
    assert.match(h.render(), /You haven’t placed a bid yet/);
    h.click('Refresh bids'); h.dispose();
    const updates = h.updates();
    await h.complete(3);
    assert.equal(h.updates(), updates, 'late response cannot set state after leaving the tab');
  } finally { h.restore(); }
});
