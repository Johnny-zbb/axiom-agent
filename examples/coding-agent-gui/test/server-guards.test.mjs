import assert from 'node:assert/strict';
import test from 'node:test';

import {isAllowedWriteOrigin, isJsonContentType} from '../server-guards.mjs';

test('allows same-origin and non-browser write requests', () => {
  assert.equal(isAllowedWriteOrigin(undefined, 4174), true);
  assert.equal(isAllowedWriteOrigin('http://127.0.0.1:4174', 4174), true);
  assert.equal(isAllowedWriteOrigin('http://localhost:4174', 4174), true);
});

test('rejects cross-origin write requests', () => {
  assert.equal(isAllowedWriteOrigin('https://example.test', 4174), false);
  assert.equal(isAllowedWriteOrigin('http://127.0.0.1:9999', 4174), false);
});

test('accepts only JSON request content types', () => {
  assert.equal(isJsonContentType('application/json'), true);
  assert.equal(isJsonContentType('application/json; charset=utf-8'), true);
  assert.equal(isJsonContentType('text/plain'), false);
  assert.equal(isJsonContentType(undefined), false);
});
