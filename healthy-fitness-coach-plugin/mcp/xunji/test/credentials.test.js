'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const { credentialPath, isCredentialValue, readWindowsCredential } = require('../src/credentials.js');

test('credential helper only accepts non-empty in-memory values and uses LocalAppData path shape', () => {
  assert.equal(isCredentialValue('FAKE_TEST_CREDENTIAL'), true);
  assert.equal(isCredentialValue(''), false);
  assert.match(credentialPath('C:\\Temp'), /HealthyFitnessCoach[\\/]credentials[\\/]xunji-credential\.dpapi$/);
});

test('credential reader removes only the PowerShell line terminator', async () => {
  const spawnProcess = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    queueMicrotask(() => { child.stdout.emit('data', Buffer.from('  OPAQUE VALUE  \r\n')); child.emit('close', 0); });
    return child;
  };
  const value = await readWindowsCredential({ localAppData: 'C:\\Temp', spawnProcess });
  assert.equal(value, '  OPAQUE VALUE  ');
});

test('credential scripts use DPAPI SecureString storage and scoped deletion', () => {
  const scripts = join(__dirname, '..', 'scripts');
  const setup = readFileSync(join(scripts, 'set-credential.ps1'), 'utf8');
  const remove = readFileSync(join(scripts, 'remove-credential.ps1'), 'utf8');
  assert.match(setup, /Read-Host\s+-AsSecureString/);
  assert.match(setup, /ConvertFrom-SecureString/);
  assert.match(remove, /GetFullPath/);
  assert.match(remove, /Remove-Item/);
});

const { readMacCredential, readCredential, dataHome, KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT } = require('../src/credentials.js');

function mockSecurity({ value = '  FAKE KEY  \n', code = 0, error = false, onSpawn = () => {} } = {}) {
  return (command, args, options) => {
    onSpawn(command, args, options);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.kill = () => {};
    queueMicrotask(() => {
      if (error) child.emit('error', new Error('PRIVATE_ERROR_MUST_NOT_LEAK'));
      else child.stdout.emit('data', Buffer.from(value));
      child.emit('close', code);
    });
    return child;
  };
}

test('macOS reads only the dedicated Keychain item and preserves opaque whitespace', async () => {
  const value = await readCredential({ platform: 'darwin', spawnProcess: mockSecurity({ onSpawn(command, args, options) {
    assert.equal(command, '/usr/bin/security');
    assert.deepEqual(args, ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w']);
    assert.deepEqual(options.stdio, ['ignore', 'pipe', 'ignore']);
  } }) });
  assert.equal(value, '  FAKE KEY  ');
});

test('macOS missing, denied, empty and failed Keychain reads expose no secret or native error', async () => {
  for (const options of [{ code: 44, value: 'PRIVATE' }, { code: 36 }, { value: '\n' }, { error: true }]) {
    await assert.rejects(readMacCredential({ spawnProcess: mockSecurity(options) }), error => {
      assert.equal(error.code, 'missing_credentials');
      assert.doesNotMatch(error.message, /PRIVATE/);
      return true;
    });
  }
  await assert.rejects(readCredential({ platform: 'linux' }), { code: 'missing_credentials' });
});

test('macOS stalled Keychain process is killed on timeout', async () => {
  let killed = false;
  await assert.rejects(readMacCredential({ timeoutMs: 5, spawnProcess() {
    const child = new EventEmitter(); child.stdout = new EventEmitter();
    child.kill = () => { killed = true; };
    return child;
  } }), { code: 'missing_credentials' });
  assert.equal(killed, true);
});

test('platform data directories preserve Windows and avoid project-local macOS caches', () => {
  assert.equal(dataHome({ platform: 'darwin', home: '/Users/test', localAppData: '/wrong' }), '/Users/test/Library/Application Support');
  assert.equal(dataHome({ platform: 'win32', localAppData: 'C:\\Local' }), 'C:\\Local');
  assert.equal(dataHome({ platform: 'linux' }), undefined);
});
