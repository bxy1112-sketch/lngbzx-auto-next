const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');
const scriptPath = path.join(projectRoot, 'lngbzx-auto-next.user.js');
const readmePath = path.join(projectRoot, 'README.md');

function readMetadata() {
  const source = fs.readFileSync(scriptPath, 'utf8');
  const block = source.match(/^\/\/ ==UserScript==\r?\n([\s\S]*?)^\/\/ ==\/UserScript==$/m);
  assert.ok(block, 'the published file must contain a complete userscript metadata block');

  const metadata = new Map();
  for (const line of block[1].split(/\r?\n/)) {
    const entry = line.match(/^\/\/\s+@(\S+)\s+(.+?)\s*$/);
    if (!entry) continue;
    const [, key, value] = entry;
    const values = metadata.get(key) || [];
    values.push(value);
    metadata.set(key, values);
  }
  return metadata;
}

function one(metadata, key) {
  const values = metadata.get(key) || [];
  assert.equal(values.length, 1, `@${key} must appear exactly once`);
  return values[0];
}

test('the public userscript exposes one stable HTTPS install and update endpoint', () => {
  const metadata = readMetadata();
  const downloadURL = one(metadata, 'downloadURL');
  const updateURL = one(metadata, 'updateURL');

  assert.equal(one(metadata, 'version'), '3.0.2');
  assert.equal(downloadURL, updateURL, 'install and update must use the same release source');

  const parsedURL = new URL(downloadURL);
  assert.equal(parsedURL.protocol, 'https:');
  assert.equal(parsedURL.hostname, 'raw.githubusercontent.com');
  assert.match(parsedURL.pathname, /\/main\/lngbzx-auto-next\.user\.js$/);
  assert.doesNotMatch(parsedURL.pathname, /\/[0-9a-f]{40}\//i, 'the update URL cannot pin a commit');
});

test('the public build keeps the same identity, site scope, and minimal permissions', () => {
  const metadata = readMetadata();

  assert.equal(one(metadata, 'name'), '辽宁干部在线学习网：合规连续学习（恢复版）');
  assert.equal(one(metadata, 'namespace'), 'local.codex.lngbzx.recovery.20260825');
  assert.deepEqual(metadata.get('match'), ['https://zyjs.lngbzx.gov.cn/*']);
  assert.deepEqual(metadata.get('grant'), ['GM_getValue', 'GM_setValue']);
  assert.equal(metadata.has('require'), false, 'the public build must not load third-party code');
  assert.equal(metadata.has('connect'), false, 'the public build must not gain network permissions');
});

test('the README one-click link installs the exact published userscript', () => {
  const metadata = readMetadata();
  const downloadURL = one(metadata, 'downloadURL');
  const readme = fs.readFileSync(readmePath, 'utf8');

  assert.match(readme, /\[点此一键安装脚本\]\((https:\/\/[^)]+)\)/);
  assert.ok(
    readme.includes(`[点此一键安装脚本](${downloadURL})`),
    'README must share the same URL declared by @downloadURL',
  );
});

