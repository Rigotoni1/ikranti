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

test('home page renders the auction marketplace and its preview status', async () => {
  const response = await fetch(base);
  assert.equal(response.status,200);
  const html=await response.text();
  assert.match(html, /Remarkable assets/);
  assert.match(html, /Irkanti — Malta/);
  assert.match(html, /IRKANTI/);
  assert.doesNotMatch(html, /Ikranti|IKRANTI/);
  assert.doesNotMatch(html, /Approved seller listings/);
  assert.doesNotMatch(html, /Rolex Cosmograph Daytona|Palazzo with Grand Harbour Views/);
  assert.match(html, /Sell an asset/);
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

test('private upload endpoint rejects cross-origin and unauthenticated requests',async()=>{
  assert.equal((await fetch(`${base}/api/account/upload`,{method:'POST',headers:{origin:'https://attacker.invalid'}})).status,403);
  assert.equal((await fetch(`${base}/api/account/upload`,{method:'POST',headers:{origin:base}})).status,401);
});
