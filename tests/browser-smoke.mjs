// Uses a fresh, isolated browser context; never reads a personal browser profile.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage();
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:3199';
try {
  await page.goto(`${base}/account`);
  await page.getByRole('heading',{name:'Sign in',exact:true}).waitFor({timeout:30000});
  await page.getByRole('button',{name:'Create an account',exact:true}).click();
  await page.getByRole('heading',{name:'Create your account',exact:true}).waitFor();
  assert.equal(await page.locator('input[name="password"]').getAttribute('minlength'),'12');
  const dir=await mkdtemp(join(tmpdir(),'irkanti-qa-'));
  await page.screenshot({path:join(dir,'account-desktop.png'),fullPage:true});
  await page.getByRole('button',{name:'Forgot password?'}).click();
  await page.getByRole('heading',{name:'Recover your password'}).waitFor();
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:join(dir,'account-mobile.png'),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(base);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByRole('link',{name:'Register or sign in →'}).waitFor();
  assert.equal(await page.getByText('Choose an account',{exact:true}).count(),0);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,screenshots:dir}));
} finally { await browser.close(); }
