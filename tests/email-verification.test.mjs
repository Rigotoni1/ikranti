import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

// Render the component without a browser, network requests or real signup emails.
const source = readFileSync(new URL('../app/account/check-email.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
}}).outputText;
const componentModule = { exports: {} };
new Function('require', 'module', 'exports', compiled)(createRequire(import.meta.url), componentModule, componentModule.exports);
const { CheckEmail } = componentModule.exports;
const now = 1_800_000_000_000;
const render = (accountType, requestedAt = now) => renderToStaticMarkup(createElement(CheckEmail, {
  pending: { email: 'member+buyer@example.invalid', accountType, requestedAt },
  onResend: async () => {}, onCheck: async () => false, onEditEmail: () => {}, onSignIn: () => {},
}));

test('buyer confirmation is a dedicated screen with clear next steps and no password form', t => {
  t.mock.method(Date, 'now', () => now);
  const html = render('buyer');
  assert.match(html, /Check your inbox/);
  assert.match(html, /member\+buyer@example.invalid/);
  assert.match(html, /Complete your buyer profile/);
  assert.match(html, /Follow the verification link/);
  assert.match(html, /spam or junk/);
  assert.match(html, /Wrong email address/);
  assert.doesNotMatch(html, /<form|type="password"|Delivery depends on email setup/);
});

test('legacy seller intent cannot reopen a seller confirmation journey', t => {
  t.mock.method(Date, 'now', () => now);
  const html = render('seller');
  assert.match(html, /Complete your buyer profile/);
  assert.match(html, /submit your ID for review before bidding/);
  assert.doesNotMatch(html, /seller|selling/);
});

test('resend starts with a cooldown and becomes available after a minute', t => {
  t.mock.method(Date, 'now', () => now);
  assert.match(render('buyer'), /<button type="button" disabled="">Resend email in 60s<\/button>/);
  assert.match(render('buyer', now - 61_000), /<button type="button">Resend verification email<\/button>/);
});
