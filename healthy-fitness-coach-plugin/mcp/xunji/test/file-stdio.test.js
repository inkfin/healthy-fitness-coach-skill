'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, writeFile, chmod, rm } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

test('headless file credentials work through MCP stdio and unsafe permissions fail closed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xunji-stdio-file-'));
  const path = join(root, 'key');
  const client = new Client({ name: 'file-provider-test', version: '1.0.0' });
  const bootstrap = `
    const { createMcpServer } = require('./src/server.js');
    const { readCredential } = require('./src/credentials.js');
    const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
    const { server } = createMcpServer({
      credentialProvider: () => readCredential({ platform: 'linux' }),
      localAppData: process.env.TEST_DATA_HOME,
      client: { protocol: 'v2', async fetchDay(date, credential) {
        if (credential !== 'SYNTHETIC_FILE_CREDENTIAL') throw new Error('wrong fixture');
        return { records: [] };
      } }
    });
    server.connect(new StdioServerTransport());
  `;
  try {
    await writeFile(path, 'SYNTHETIC_FILE_CREDENTIAL\n', { mode: 0o600 });
    const transport = new StdioClientTransport({ command: process.execPath, args: ['-e', bootstrap],
      cwd: join(__dirname, '..'), env: { ...process.env, XUNJI_CREDENTIAL_FILE: path, TEST_DATA_HOME: root }, stderr: 'ignore' });
    await client.connect(transport);
    assert.equal((await client.listTools()).tools.length, 7);
    const good = await client.callTool({ name: 'xunji_get_training_day', arguments: { date: '2026-11-04' } });
    assert.equal(good.isError, undefined);
    assert.deepEqual(good.structuredContent.records, []);
    assert.equal(good.structuredContent.data_freshness, 'network');
    await chmod(path, 0o644);
    const bad = await client.callTool({ name: 'xunji_get_training_day', arguments: { date: '2026-11-04' } });
    assert.equal(bad.isError, true);
    assert.equal(JSON.parse(bad.content[0].text).error.code, 'missing_credentials');
    assert.doesNotMatch(JSON.stringify([good, bad]), /SYNTHETIC_FILE_CREDENTIAL/);
  } finally { await client.close(); await rm(root, { recursive: true, force: true }); }
});
