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
  await assert.rejects(readCredential({ platform: 'unsupported' }), { code: 'missing_credentials' });
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
  assert.equal(dataHome({ platform: 'unsupported' }), undefined);
});


const { mkdtemp, writeFile, chmod, symlink, mkdir, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { readLinuxCredential, linuxCredentialPath } = require('../src/credentials.js');

test('Linux credential/data paths follow absolute XDG paths and file override', () => {
  assert.equal(linuxCredentialPath({ home: '/home/test', credentialFile: '/run/secrets/xunji' }), '/run/secrets/xunji');
  assert.throws(() => linuxCredentialPath({ credentialFile: 'relative/key' }), { code: 'missing_credentials' });
  assert.equal(linuxCredentialPath({ home: '/home/test', credentialFile: undefined, xdgConfigHome: '/config' }), '/config/HealthyFitnessCoach/xunji-api-key');
  assert.equal(linuxCredentialPath({ home: '/home/test', credentialFile: undefined, xdgConfigHome: 'relative' }), '/home/test/.config/HealthyFitnessCoach/xunji-api-key');
  assert.equal(dataHome({ platform: 'linux', home: '/home/test', xdgDataHome: '/data' }), '/data');
  assert.equal(dataHome({ platform: 'linux', home: '/home/test', xdgDataHome: '' }), '/home/test/.local/share');
});

test('Linux file credentials accept owner-only read-only Docker mounts and preserve opaque spaces', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xunji-file-'));
  try {
    const file = join(root, 'key');
    await writeFile(file, '  FAKE_SECRET  \r\n', { mode: 0o600 });
    assert.equal(await readCredential({ platform: 'linux', credentialFile: file }), '  FAKE_SECRET  ');
    await chmod(file, 0o400);
    assert.equal(await readLinuxCredential({ credentialFile: file }), '  FAKE_SECRET  ');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Linux file credentials reject unsafe permissions, symlinks, wrong ownership and invalid content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xunji-file-'));
  try {
    const file = join(root, 'key'), link = join(root, 'link'), directory = join(root, 'dir');
    await writeFile(file, 'PRIVATE_TEST_SECRET', { mode: 0o600 });
    const rejected = options => assert.rejects(readLinuxCredential(options), error => {
      assert.equal(error.code, 'missing_credentials');
      assert.doesNotMatch(JSON.stringify(error), /PRIVATE_TEST_SECRET|xunji-file-/);
      return true;
    });
    for (const mode of [0o644, 0o640, 0o666, 0o700]) {
      await chmod(file, mode); await rejected({ credentialFile: file });
    }
    await chmod(file, 0o600);
    await rejected({ credentialFile: file, uid: process.getuid() + 1 });
    await symlink(file, link); await rejected({ credentialFile: link });
    await mkdir(directory, { mode: 0o700 }); await rejected({ credentialFile: directory });
    await rejected({ credentialFile: join(root, 'missing') });
    for (const value of ['', '   \n', 'KEY\nSECOND', 'KEY\0', 'x'.repeat(16385)]) {
      await writeFile(file, value); await rejected({ credentialFile: file });
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});


test('API key environment override takes precedence across every platform without reading storage', async () => {
  for (const platform of ['linux', 'darwin', 'win32', 'unsupported']) {
    assert.equal(await readCredential({ platform, env: { XUNJI_API_KEY: '  SYNTHETIC_ENV_KEY  ' },
      credentialFile: '/nonexistent', spawnProcess() { throw new Error('must not read keychain'); }
    }), '  SYNTHETIC_ENV_KEY  ');
  }
});

test('invalid explicit environment keys fail closed without leaking or falling back', async () => {
  for (const value of ['', '   ', 'PRIVATE\nKEY', 'PRIVATE\rKEY', 'PRIVATE\0KEY', 'x'.repeat(16385)]) {
    await assert.rejects(readCredential({ platform: 'darwin', env: { XUNJI_API_KEY: value },
      spawnProcess() { throw new Error('must not fall back'); }
    }), error => {
      assert.equal(error.code, 'missing_credentials');
      assert.doesNotMatch(JSON.stringify(error), /PRIVATE/);
      return true;
    });
  }
  assert.equal(await readCredential({ platform: 'darwin', env: {}, spawnProcess: mockSecurity() }), '  FAKE KEY  ');
});
