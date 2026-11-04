'use strict';

const { spawn } = require('node:child_process');
const { join, isAbsolute } = require('node:path');
const { open } = require('node:fs/promises');
const { constants } = require('node:fs');
const { homedir } = require('node:os');

const KEYCHAIN_SERVICE = 'HealthyFitnessCoach.Xunji';
const KEYCHAIN_ACCOUNT = 'xunji-api-key';
const { connectorError } = require('./errors.js');

function credentialPath(localAppData) {
  return join(localAppData, 'HealthyFitnessCoach', 'credentials', 'xunji-credential.dpapi');
}

function isCredentialValue(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function readWindowsCredential({ localAppData = process.env.LOCALAPPDATA, spawnProcess = spawn } = {}) {
  if (!localAppData) return Promise.reject(connectorError('missing_credentials'));
  const path = credentialPath(localAppData).replace(/'/g, "''");
  const command = `$path='${path}'; if (!(Test-Path -LiteralPath $path -PathType Leaf)) { exit 3 }; $secure=Get-Content -LiteralPath $path -Raw | ConvertTo-SecureString; $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure); try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }`;
  return new Promise((resolve, reject) => {
    const child = spawnProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.on('error', () => reject(connectorError('missing_credentials')));
    child.on('close', (code) => {
      const value = output.endsWith('\r\n') ? output.slice(0, -2) : (output.endsWith('\n') ? output.slice(0, -1) : output);
      if (code !== 0 || !isCredentialValue(value)) return reject(connectorError('missing_credentials'));
      resolve(value);
    });
  });
}

function dataHome({ platform = process.platform, home = homedir(), localAppData = process.env.LOCALAPPDATA, xdgDataHome = process.env.XDG_DATA_HOME } = {}) {
  if (platform === 'darwin') return join(home, 'Library', 'Application Support');
  if (platform === 'win32') return localAppData;
  if (platform === 'linux') return xdgDataHome && isAbsolute(xdgDataHome) ? xdgDataHome : join(home, '.local', 'share');
  return undefined;
}

function readMacCredential({ spawnProcess = spawn, timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    let timer;
    let output = '';
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      output = '';
      error ? reject(connectorError('missing_credentials')) : resolve(value);
    };
    try {
      child = spawnProcess('/usr/bin/security', [
        'find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w'
      ], { stdio: ['ignore', 'pipe', 'ignore'] });
      timer = setTimeout(() => { finish(true); child.kill(); }, timeoutMs);
      child.stdout.on('data', chunk => {
        output += chunk;
        if (output.length > 16_384) { finish(true); child.kill(); }
      });
      child.on('error', () => finish(true));
      child.on('close', code => {
        const value = output.endsWith('\n') ? output.slice(0, -1) : output;
        finish(code !== 0 || !isCredentialValue(value), value);
      });
    } catch (_) { finish(true); }
  });
}

// Linux/headless containers: an owner-only file, never a key in argv/env.
function linuxCredentialPath({ credentialFile = process.env.XUNJI_CREDENTIAL_FILE,
  home = homedir(), xdgConfigHome = process.env.XDG_CONFIG_HOME } = {}) {
  if (credentialFile !== undefined) {
    if (!isAbsolute(credentialFile)) throw connectorError('missing_credentials');
    return credentialFile;
  }
  const root = xdgConfigHome && isAbsolute(xdgConfigHome) ? xdgConfigHome : join(home, '.config');
  return join(root, 'HealthyFitnessCoach', 'xunji-api-key');
}

async function readLinuxCredential(options = {}) {
  let handle;
  try {
    const path = linuxCredentialPath(options);
    // O_NONBLOCK prevents a substituted FIFO from hanging before fstat.
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    const uid = options.uid ?? process.getuid?.();
    if (!stat.isFile() || stat.uid !== uid || !(stat.mode & 0o400)
        || ![0o400, 0o600].includes(stat.mode & 0o7777) || stat.size < 1 || stat.size > 16_384) {
      throw connectorError('missing_credentials');
    }
    const bytes = Buffer.alloc(16_385);
    let size = 0;
    while (size < bytes.length) {
      const result = await handle.read(bytes, size, bytes.length - size, null);
      if (!result.bytesRead) break;
      size += result.bytesRead;
    }
    if (size > 16_384) throw connectorError('missing_credentials');
    const value = bytes.subarray(0, size).toString('utf8').replace(/\r?\n$/, '');
    bytes.fill(0);
    if (!isCredentialValue(value) || /[\r\n\0]/.test(value)) throw connectorError('missing_credentials');
    return value;
  } catch (_) {
    // No path, filesystem error, file content or credential in public errors.
    throw connectorError('missing_credentials');
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

function readCredential(options = {}) {
  const apiKey = (options.env || process.env).XUNJI_API_KEY;
  if (apiKey !== undefined) {
    if (!isCredentialValue(apiKey) || Buffer.byteLength(apiKey, 'utf8') > 16_384 || /[\r\n\0]/.test(apiKey)) {
      return Promise.reject(connectorError('missing_credentials'));
    }
    return Promise.resolve(apiKey);
  }
  const platform = options.platform || process.platform;
  if (platform === 'linux') return readLinuxCredential(options);
  if (platform === 'darwin') return readMacCredential(options);
  if (platform === 'win32') return readWindowsCredential(options);
  return Promise.reject(connectorError('missing_credentials'));
}

module.exports = { credentialPath, isCredentialValue, readWindowsCredential,
  readMacCredential, readLinuxCredential, linuxCredentialPath, readCredential, dataHome, KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT };
