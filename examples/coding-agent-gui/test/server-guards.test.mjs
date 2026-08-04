import assert from 'node:assert/strict';
import test from 'node:test';

import {isAllowedOrigin, isJsonContentType} from '../server-guards.mjs';

const allowed = [
  'http://127.0.0.1:4174',
  'http://localhost:4174',
  'http://localhost:1420',
  'http://tauri.localhost',
  'https://tauri.localhost',
  'tauri://localhost',
  'https://custom.example',
];

test('allows missing origin (non-browser clients)', () => {
  assert.equal(isAllowedOrigin(undefined, allowed), true);
});

test('allows configured same-origin and desktop origins', () => {
  assert.equal(isAllowedOrigin('http://127.0.0.1:4174', allowed), true);
  assert.equal(isAllowedOrigin('http://localhost:4174', allowed), true);
  assert.equal(isAllowedOrigin('http://localhost:1420', allowed), true);
  assert.equal(isAllowedOrigin('http://tauri.localhost', allowed), true);
  assert.equal(isAllowedOrigin('https://tauri.localhost', allowed), true);
  assert.equal(isAllowedOrigin('tauri://localhost', allowed), true);
  assert.equal(isAllowedOrigin('https://custom.example', allowed), true);
});

test('rejects unlisted cross-origin writes', () => {
  assert.equal(isAllowedOrigin('https://example.test', allowed), false);
  assert.equal(isAllowedOrigin('http://127.0.0.1:9999', allowed), false);
  assert.equal(isAllowedOrigin('https://evil.example', allowed), false);
});

test('accepts only JSON request content types', () => {
  assert.equal(isJsonContentType('application/json'), true);
  assert.equal(isJsonContentType('application/json; charset=utf-8'), true);
  assert.equal(isJsonContentType('text/plain'), false);
  assert.equal(isJsonContentType(undefined), false);
});
