import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const nativeRequire = createRequire(import.meta.url);
const source = file => readFileSync(new URL(file, import.meta.url), 'utf8');
function load(file, overrides = {}) {
  const compiled = ts.transpileModule(source(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => name.endsWith('.css') ? {} : overrides[name] || nativeRequire(name), module, module.exports);
  return module.exports;
}
const link = ({children, ...props}) => createElement('a', props, children);
const brand = load('../app/brand-logo.tsx');
test('marketplace header shows Sign in for guests and Account for signed-in users', () => {
  for (const signedIn of [null, false, true]) {
    let stateIndex = 0;
    const { default: Home } = load('../app/page.tsx', {
      react: { useState: initial => [stateIndex++ === 0 ? signedIn : initial, () => {}], useEffect: () => {}, useMemo: fn => fn(), useRef: value => ({ current: value }) },
      '../lib/supabase/browser': { browserClient: () => ({}) },
      './brand-logo': brand, './bid-history': { BidHistory: () => null },
      './use-bid-history': { useBidHistory: () => ({ history: null }) },
      './use-auction-ended': { useAuctionEnded: () => false },
    });
    const html = renderToStaticMarkup(createElement(Home));
    const header = html.match(/<header[\s\S]*?<\/header>/)?.[0];
    assert.ok(header);
    assert.ok(header.includes(`class="goldButton" href="/account">${signedIn ? 'Account' : 'Sign in'}</a>`));
  }
});
function account(overrides = {}) {
  const names = [...source('../app/account/page.tsx').matchAll(/const \[(\w+),[^\]]+\] = useState/g)].map(match => match[1]);
  let cursor = 0;
  const { default: Account } = load('../app/account/page.tsx', {
    react: { useState: value => [Object.hasOwn(overrides, names[cursor]) ? overrides[names[cursor++]] : (cursor++, value), () => {}], useCallback: fn => fn, useRef: value => ({ current: value }), useEffect: () => {} },
    'next/link': { default: link }, '../brand-logo': brand, '@/lib/supabase/browser': { browserClient: () => ({}) },
    '@/lib/listing-image': { listingImageUrl: path => path }, './check-email': { CheckEmail: () => null }, './onboarding': { Onboarding: () => createElement('p', null, 'Buyer onboarding') },
    './bid-activity': { default: () => createElement('section', {'aria-label':'My bids'}, 'Live bid activity') },
  });
  return renderToStaticMarkup(createElement(Account));
}
test('signup goes straight to buyer registration without a role chooser', () => {
  const html = account({ ready: true, mode: 'signup' });
  assert.match(html, /Create your account|Your name/);
  assert.match(html, /Register &amp; verify email/);
  assert.doesNotMatch(html, /Sell your assets|How would you like to start|seller|Switch to/);
});
test('account opens on My bids, with Watchlist next, even for legacy seller-active accounts', () => {
  const user = {id:'test-member',email:'buyer@example.invalid',email_confirmed_at:'2026-01-01'};
  const state = {ready:true,user,profile:{name:'Buyer',role:'member',active_account:'seller'},onboarding:[{account_type:'buyer',completed_at:'2026-01-01'}]};
  const html = account(state);
  assert.match(html, /class="active" aria-pressed="true">My bids/);
  assert.match(html, /Live bid activity/);
  assert.ok(html.indexOf('>My bids</button>') < html.indexOf('>Watchlist</button>'));
  const watchlist = account({...state,tab:'Watchlist'});
  assert.match(watchlist, /Nothing saved here yet/);
  assert.doesNotMatch(watchlist, /Live bid activity/);
  assert.doesNotMatch(html, /Selling|Seller account|Submit an asset|Switch/);
  const settings = account({...state,tab:'Settings'});
  assert.match(settings, /Update details &amp; verification/);
  assert.doesNotMatch(settings, /seller|Switch|inventory/i);
});
test('ordinary buyer account never includes administration links', () => {
  const html = account({ready:true,user:{id:'buyer'},profile:{role:'member'},tab:'Settings'});
  assert.doesNotMatch(html, /href="\/admin"/);
  assert.doesNotMatch(html, /Live bid activity/);
  assert.match(account({ready:true,user:{id:'staff'},profile:{role:'admin'},tab:'Settings'}), /href="\/admin"/);
});

const listing = load('../app/admin/listing-editor.tsx', {
  '@/lib/supabase/browser':{browserClient:()=>({})}, '@/lib/supabase/config':{supabaseUrl:'https://example.invalid'}, '../account/upload-file':{UploadFile:()=>null},
});
function listingData() {
  const data = new FormData();
  for (const [key,value] of Object.entries({title:'Team auction',description:'A complete description and condition report.',category:'Collectables',location:'Malta',start:'100.25',reserve:'200',end:new Date(Date.now()+3*86400000).toISOString()})) data.set(key,value);
  return data;
}
test('staff listing form validates prices and closing dates', () => {
  assert.equal(listing.listingArguments(listingData()).p_start,100.25);
  for (const invalid of ['', '-1', 'Infinity', 'NaN', '1.001']) {
    const data = listingData(); data.set('start',invalid);
    assert.throws(()=>listing.listingArguments(data),/valid prices/);
  }
  const data=listingData();data.set('end','invalid');
  assert.throws(()=>listing.listingArguments(data),/closing time/);
});
test('team edit UI locks auctions with bids, expired auctions and closed outcomes', () => {
  const pending={status:'under_review',bid_count:0,end_at:new Date(Date.now()+86400000).toISOString()};
  assert.equal(listing.listingEditable(pending),true);
  for (const overrides of [{bid_count:1},{highest_bidder_id:'bidder'},{status:'sold'},{status:'live',end_at:'2020-01-01'}]) assert.equal(listing.listingEditable({...pending,...overrides}),false);
  const html=renderToStaticMarkup(createElement(listing.ListingEditor,{listing:{...pending,bid_count:1},busy:false,onBusy(){},onSaved:async()=>{}}));
  assert.match(html,/Editing is locked/);assert.doesNotMatch(html,/<form/);
});
test('current terms describe buyer accounts without rewriting the accepted archive', () => {
  const previous=source('../app/terms/2026-09-22/page.tsx');
  const current=source('../app/terms/2026-09-22.1/page.tsx');
  assert.match(previous,/Buyer and seller onboarding are separate/);
  assert.match(current,/Public accounts are for buyers/);
  assert.doesNotMatch(current,/Buyer and seller onboarding are separate/);
});
