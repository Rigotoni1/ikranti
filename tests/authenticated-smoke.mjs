// Requires a disposable, confirmed account provisioned by the test operator.
// It enrols TOTP and submits sample onboarding; operator must remove the account afterwards.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
const { chromium }=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
function totp(secret) {
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits=[...secret.toUpperCase().replace(/=+$/,'')].map(c=>alphabet.indexOf(c).toString(2).padStart(5,'0')).join('');
  const key=Buffer.from((bits.match(/.{8}/g)||[]).map(b=>parseInt(b,2)));
  const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const digest=createHmac('sha1',key).update(counter).digest();const offset=digest[19]&15;
  return ((digest.readUInt32BE(offset)&0x7fffffff)%1000000).toString().padStart(6,'0');
}
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${process.env.TEST_BASE_URL||'http://127.0.0.1:3199'}/account`);
  await page.getByRole('heading',{name:'Sign in',exact:true}).waitFor({timeout:30000});
  await page.locator('[name=email]').fill(process.env.QA_EMAIL);
  await page.locator('[name=password]').fill(process.env.QA_PASSWORD);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByRole('heading',{name:'Welcome, Temporary launch QA'}).waitFor({timeout:30000});
  await page.getByRole('button',{name:'Security',exact:true}).click();
  const enrollment=page.waitForResponse(r=>r.url().endsWith('/auth/v1/factors')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Set up two-factor authentication'}).click();
  const factor=await (await enrollment).json();assert.ok(factor.totp?.secret,'TOTP enrolment returned a secret');
  await page.getByLabel('Authenticator code').fill(totp(factor.totp.secret));
  await page.getByRole('button',{name:'Verify code',exact:true}).click();
  await page.getByText('Current session: Two-factor authenticated',{exact:true}).waitFor({timeout:30000});
  await page.reload();
  await page.getByRole('heading',{name:'Welcome, Temporary launch QA'}).waitFor({timeout:30000});
  await page.getByRole('button',{name:'Selling',exact:true}).click();
  await page.getByLabel('Full legal name').fill('Temporary QA — sample data');
  await page.getByLabel('Residential / registered address').fill('Synthetic test address, not a real residence');
  await page.getByRole('button',{name:'Submit for review',exact:true}).click();
  await page.getByText('Application submitted. Upload your supporting documents below.',{exact:true}).waitFor({timeout:30000});
  assert.equal(await page.getByRole('button',{name:'Administration',exact:true}).count(),0);
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await page.getByRole('heading',{name:'Sign in',exact:true}).waitFor({timeout:30000});
  assert.deepEqual(errors,[]);
  console.log('PASS: real password login, TOTP enrolment/verification, session reload, onboarding, no admin escalation, sign-out');
} finally { await browser.close(); }
