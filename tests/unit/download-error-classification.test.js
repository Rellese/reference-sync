import test from 'node:test';
import assert from 'node:assert/strict';

import { looksOffline } from '../../js/job-control.js';

test('NotOpenSSLWarning without a network failure is not offline', () => {
  assert.equal(
    looksOffline(
      'NotOpenSSLWarning: urllib3 v2 only supports OpenSSL 1.1.1+',
    ),
    false,
  );
});

test('HTTP 400 Bad Request is not offline', () => {
  assert.equal(
    looksOffline(
      'HttpError: 400 Bad Request for media 1234567890',
    ),
    false,
  );
});

test('HTTP 429 Too Many Requests is not offline', () => {
  assert.equal(
    looksOffline('HTTP 429 Too Many Requests'),
    false,
  );
});

test('connection reset is offline', () => {
  assert.equal(
    looksOffline('Connection reset by peer'),
    true,
  );
});

test('SSL error is offline', () => {
  assert.equal(
    looksOffline('SSL error while connecting to remote host'),
    true,
  );
});
