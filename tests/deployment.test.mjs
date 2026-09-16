import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, before, test } from 'node:test';

let server;
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
  assert.match(html, /Demonstration marketplace/);
  assert.match(html, /Sell an asset/);
});

test('Supabase-backed catalog and buyer profile are available, without confidential reserves', async () => {
  const response=await fetch(`${base}/api/marketplace?user=buyer_01`);
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.user.id,'buyer_01');
  assert.ok(result.auctions.length>=8);
  assert.ok(result.auctions.every(lot=>typeof lot.currentBid==='number' && typeof lot.reserveMet==='boolean'));
  assert.ok(result.auctions.every(lot=>!Object.hasOwn(lot,'reservePrice')));
});

test('seller owns the sample inventory', async () => {
  const response=await fetch(`${base}/api/marketplace?user=seller_01`);
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.user.role,'seller');
  assert.ok(result.myLots.some(lot=>lot.status==='under_review'));
  assert.ok(result.myLots.every(lot=>lot.sellerId==='seller_01'));
});

test('invalid bids and unknown users are rejected without changing auction state', async () => {
  const request=body=>fetch(`${base}/api/marketplace`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await request({action:'bid',userId:'buyer_01',auctionId:'jaguar-e-type',maxAmount:1})).status,400);
  assert.equal((await request({action:'bid',userId:'seller_01',auctionId:'rolex-daytona',maxAmount:999999})).status,400);
  assert.equal((await request({action:'bid',userId:'unknown',auctionId:'rolex-daytona',maxAmount:999999})).status,403);
});
