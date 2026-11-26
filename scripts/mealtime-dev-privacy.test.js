import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { createServer } from 'vite';
test('private notebook archives are denied by Vite, including direct filesystem URLs', async () => {
  await mkdir('.local', { recursive: true });
  const folder = await mkdtemp(resolve('.local/notebook-privacy-'));
  const file = resolve(folder, 'private.zip');
  await writeFile(file, 'private-test-contents', { mode: 0o600 });
  let server;
  try {
    server = await createServer({ server: { port: 0, host: '127.0.0.1' }, logLevel: 'silent' });
    await server.listen();
    const base = `http://127.0.0.1:${server.httpServer.address().port}`;
    for (const path of ['/.local/' + basename(folder) + '/private.zip', '/@fs/' + file]) {
      const r = await fetch(base + path); assert.equal(r.status, 403);
      assert.ok(!(await r.text()).includes('private-test-contents'));
    }
  } finally { await server?.close(); await rm(folder, { recursive: true, force: true }); }
});

test('private notebook data is excluded from Docker context and Git', async () => {
  assert.ok((await readFile('.dockerignore', 'utf8')).split(/\r?\n/).includes('.local'));
  assert.ok((await readFile('.gitignore', 'utf8')).split(/\r?\n/).includes('.local/'));
});
