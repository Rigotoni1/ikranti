import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, before, test } from 'node:test';

let server;
test('admin route sends anonymous visitors to account without staff content', async () => {
  const response = await fetch(`${base}/admin`, { redirect: 'manual' });
  assert.equal(response.status, 307);
  assert.equal(new URL(response.headers.get('location'), base).pathname, '/account');
  assert.doesNotMatch(await response.text(), /Staff decision|Verify a buyer|ir_risk_flags/);
});
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3198';
before(async () => {
  if (process.env.TEST_BASE_URL) return;
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3198'], { stdio: 'ignore' });
  for (let i=0;i<60;i++) {
    try { if ((await fetch(base)).ok) return; } catch { /* wait for server */ }
    await new Promise(resolve => setTimeout(resolve,250));
  }
  throw new Error('Next.js did not become ready');
});
after(() => server?.kill('SIGTERM'));

test('home page renders the auction marketplace with buyer-only navigation', async () => {
  const response = await fetch(base);
  assert.equal(response.status,200);
  const html=await response.text();
  assert.match(html, /Remarkable assets/);
  assert.match(html, /Irkanti — Malta/);
  assert.match(html, /aria-label="Irkanti home"/);
  assert.match(html, /src="\/brand\/irkanti-wordmark-light\.svg"/);
  assert.doesNotMatch(html, /Ikranti|IKRANTI/);
  assert.doesNotMatch(html, /Approved seller listings/);
  assert.doesNotMatch(html, /Rolex Cosmograph Daytona|Palazzo with Grand Harbour Views/);
  assert.doesNotMatch(html, /Sell an asset|Sell with Irkanti|Seller account/);
  assert.match(html, /Your watchlist/);
});

test('catalogue is public and never accepts a browser-selected account', async () => {
  const response=await fetch(`${base}/api/marketplace?user=buyer_01`);
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.user,null);
  assert.deepEqual(result.myLots,[]);
  assert.deepEqual(result.watched,[]);
  assert.equal(result.isPreview,false);
  assert.ok(Array.isArray(result.auctions));
  assert.ok(result.auctions.every(lot=>/^[0-9a-f-]{36}$/i.test(lot.id)));
  assert.ok(result.auctions.every(lot=>typeof lot.currentBid==='number' && typeof lot.reserveMet==='boolean'));
  assert.ok(result.auctions.every(lot=>!Object.hasOwn(lot,'reservePrice')));
});

test('forged seller identity does not expose private inventory', async () => {
  const response=await fetch(`${base}/api/marketplace?user=seller_01`);
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.user,null);
  assert.deepEqual(result.myLots,[]);
});

test('invalid bids and unknown users are rejected without changing auction state', async () => {
  const request=body=>fetch(`${base}/api/marketplace`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await request({action:'bid',userId:'buyer_01',auctionId:'jaguar-e-type',maxAmount:1})).status,410);
  assert.equal((await request({action:'bid',userId:'seller_01',auctionId:'rolex-daytona',maxAmount:999999})).status,410);
  assert.equal((await request({action:'bid',userId:'unknown',auctionId:'rolex-daytona',maxAmount:999999})).status,410);
});

test('malformed payloads are rejected at the API boundary', async () => {
  for (const body of ['null', '[]', '"invalid"', '{']) {
    const response = await fetch(`${base}/api/marketplace`, {method:'POST',headers:{'content-type':'application/json'},body});
    assert.equal(response.status,410);
  }
  assert.equal((await fetch(`${base}/api/media`,{method:'POST',body:'not multipart'})).status,410);
});

test('secure account portal is available',async()=>{
  const response=await fetch(`${base}/account`);
  assert.equal(response.status,200);
  assert.match(await response.text(),/class="activeAccount"[^>]*>Your account/);
  assert.match(response.headers.get('cache-control'),/no-store/);
});

test('brand assets and theme-aware site icons are available',async()=>{
  for (const path of ['/favicon.svg','/brand/irkanti-wordmark-light.svg','/brand/irkanti-wordmark-dark.svg','/brand/irkanti-favicon-dark.svg','/brand/irkanti-favicon-light.svg']) {
    const response=await fetch(`${base}${path}`);
    assert.equal(response.status,200);
    assert.match(response.headers.get('content-type'),/image\/svg\+xml/);
    const svg=await response.text();
    assert.match(svg,/<svg/);
    assert.doesNotMatch(svg,/<script|<foreignObject|https?:\/\/(?!www\.w3\.org)/);
  }
  for (const path of ['/brand/irkanti-favicon-dark-32.png','/brand/irkanti-favicon-dark.png']) {
    const response=await fetch(`${base}${path}`);
    assert.equal(response.status,200);
    assert.match(response.headers.get('content-type'),/image\/png/);
  }
  const html=await (await fetch(base)).text();
  assert.match(html,/media="\(prefers-color-scheme: light\)"/);
  assert.match(html,/media="\(prefers-color-scheme: dark\)"/);
  assert.match(html,/rel="apple-touch-icon"/);
  for (const path of ['/account','/account/bids','/terms']) {
    const page=await (await fetch(`${base}${path}`)).text();
    assert.match(page,/aria-label="Irkanti home"/);
    assert.match(page,/src="\/brand\/irkanti-wordmark-light\.svg"/);
  }
});

test('terms and the immutable consent version are publicly available',async()=>{
  for (const path of ['/terms','/terms/2026-09-22','/terms/2026-09-22.1']) {
    const response=await fetch(`${base}${path}`);
    assert.equal(response.status,200);
    const html=await response.text();
    assert.match(html,/Terms &amp; Conditions/);
    assert.match(html,/10% of the final winning price/);
    assert.match(html,/within 30 calendar days after the closing date/);
  }
  assert.match(await (await fetch(base)).text(),/href="\/terms">Terms &amp; Conditions/);
});

test('private upload endpoint rejects cross-origin and unauthenticated requests',async()=>{
  assert.equal((await fetch(`${base}/api/account/upload`,{method:'POST',headers:{origin:'https://attacker.invalid'}})).status,403);
  assert.equal((await fetch(`${base}/api/account/upload`,{method:'POST',headers:{origin:base}})).status,401);
});
