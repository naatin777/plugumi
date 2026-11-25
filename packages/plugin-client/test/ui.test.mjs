import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { loadUI } from '../dist/ui.js';

function bundle(files, manifest) {
  const directory = mkdtempSync(join(tmpdir(), 'plugumi-ui-'));
  for (const [path, content] of Object.entries(files)) {
    const full = join(directory, ...path.split('/'));
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  writeFileSync(join(directory, 'plugumi-ui.json'), JSON.stringify(manifest));
  return directory;
}

test('loadUI reads files with verified sha256 and panels', () => {
  const content = '<html></html>';
  const sha256 = createHash('sha256').update(content).digest('hex');
  const directory = bundle(
    { 'assets/index.html': content },
    { files: [{ path: 'assets/index.html', sha256 }], panels: [{ panelId: 'main', title: 'Main', entry: 'assets/index.html' }] },
  );
  const ui = loadUI(directory);
  assert.equal(ui.files.length, 1);
  assert.equal(ui.files[0].sha256, sha256);
  assert.equal(new TextDecoder().decode(ui.files[0].data), content);
  assert.equal(ui.panels[0].panelId, 'main');
});

test('loadUI throws when content does not match the declared sha256', () => {
  const directory = bundle(
    { 'index.html': 'actual' },
    { files: [{ path: 'index.html', sha256: '0'.repeat(64) }] },
  );
  assert.throws(() => loadUI(directory), /sha256/);
});

test('loadUI defaults missing files and panels to empty arrays', () => {
  const directory = bundle({}, {});
  assert.deepEqual(loadUI(directory), { files: [], panels: [] });
});
