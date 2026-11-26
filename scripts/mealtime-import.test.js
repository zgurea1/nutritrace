import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import AdmZip from '../server/node_modules/adm-zip/adm-zip.js';
import { encodeRecipe, readRecipe, recipePortion } from '../src/lib/mealtime/recipe.js';
const realNow = Date.now; let clock = realNow();
Date.now = () => clock;
beforeEach(() => { clock += 61000; });
after(() => { Date.now = realNow; });
const temp = mkdtempSync(join(tmpdir(), 'nutritrace-mealtime-'));
process.env.DB_PATH = join(temp, 'test.db'); process.env.UPLOADS_PATH = join(temp, 'uploads');
process.env.NODE_ENV = 'test'; process.env.JWT_SECRET = 'mealtime-test-only';
const { default: db } = await import('../server/db.js');
const { default: express } = await import('../server/node_modules/express/index.js');
const { default: notebook } = await import('../server/routes/mealtime.js');
const { default: meals } = await import('../server/routes/meals.js');
const { default: sync } = await import('../server/routes/sync.js');
const { authenticate, signToken } = await import('../server/middleware/auth.js');
const { isPrivateUploadPath } = await import('../server/lib/upload-paths.js');
const { sha256, inspectArchive } = await import('../server/lib/mealtime/archive.js');
const app = express(); app.use(express.json({ limit: '5mb' })); app.use(authenticate);
app.use('/api/mealtime', notebook); app.use('/api/meals', meals); app.use('/api/sync', sync);
app.use('/uploads', (req, res, next) => isPrivateUploadPath(req.path) ? res.sendStatus(404) : next(), express.static(process.env.UPLOADS_PATH));
app.use((e, req, res, next) => res.status(e.status || 500).json({ error: e.message }));
const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
after(async () => { await new Promise(r => server.close(r)); db.close(); rmSync(temp, { recursive: true, force: true }); });
const owner = Number(db.prepare("INSERT INTO users (username,password_hash,role) VALUES ('owner','not-a-password','admin')").run().lastInsertRowid);
const other = Number(db.prepare("INSERT INTO users (username,password_hash) VALUES ('other','not-a-password')").run().lastInsertRowid);
const token = signToken({ id: owner, username: 'owner', role: 'admin' });
const stranger = signToken({ id: other, username: 'other', role: 'user' });
const photo = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64');
const source = { version: 1, sourceId: 'test_01', title: 'Owned fixture', ingredients: ['100 g cheese'], instructions: ['Bake.'], cookedYieldG: null, nutrition: { calories: 378, proteins: 30.2, fat: 24.3, carbohydrates: 9.1 }, image: 'images/test_01.png', imageSha256: sha256(photo) };
function archive(rows = [source]) {
 const z = new AdmZip(); z.addFile('manifest.json', Buffer.from(JSON.stringify({ format: 'nutritrace-mealtime-v1', recipes: rows }))); for (const r of rows) z.addFile(r.image, photo); return z.toBuffer();
}
async function upload(bytes, apply = false, auth = token, rights = true) {
 const body = new FormData(); body.append('file', new Blob([bytes]), 'notebook.zip'); body.append('apply', String(apply)); body.append('rightsConfirmed', String(rights));
 return fetch(base + '/api/mealtime/import', { method: 'POST', headers: auth ? { Authorization: 'Bearer ' + auth } : {}, body });
}
async function put(id, body) { return fetch(base + '/api/meals/' + id, { method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
let id, image;
test('authenticated preview does not write; rights and explicit apply are required', async () => {
 assert.equal((await upload(archive(), true, null)).status, 401);
 const r = await upload(archive()); assert.equal(r.status, 200); assert.equal((await r.json()).create, 1);
 assert.equal(db.prepare('SELECT count(*) n FROM meals').get().n, 0);
 assert.equal((await upload(archive(), true, token, false)).status, 400);
 assert.equal((await upload(archive(), true)).status, 200);
 const row = db.prepare('SELECT * FROM meals').get(); id = row.id; image = row.img_url;
 assert.equal(row.user_id, owner); assert.equal(row.visibility, 'private'); assert.equal(row.unit, 'serving'); assert.equal(row.portion, 1);
 assert.equal(readRecipe(row.notes).recipe.ingredients[0], source.ingredients[0]);
});
test('repeat import is idempotent and changed source does not overwrite personal edits', async () => {
 const r = await upload(archive(), true); assert.equal((await r.json()).skipped, 1);
 await put(id, { name: 'Edited personally' });
 assert.equal((await upload(archive(), true)).status, 200);
 assert.equal(db.prepare('SELECT name FROM meals WHERE id=?').get(id).name, 'Edited personally');
 assert.equal((await upload(archive([{ ...source, title: 'Changed source' }]), true)).status, 409);
 assert.equal(db.prepare('SELECT count(*) n FROM meals').get().n, 1);
});
test('private images reject anonymous, foreign owner and static traversal paths', async () => {
 assert.equal((await fetch(base + image)).status, 401);
 assert.equal((await fetch(base + image, { headers: { Authorization: 'Bearer ' + stranger } })).status, 404);
 const r = await fetch(base + image, { headers: { Authorization: 'Bearer ' + token } }); assert.equal(r.status, 200);
 assert.deepEqual(Buffer.from(await r.arrayBuffer()), photo);
 for (const prefix of ['mealtime-private', '%6dealtime-private', 'MEALTIME-PRIVATE', '/mealtime-private']) assert.equal((await fetch(base + '/uploads/' + prefix + '/' + image.split('/').pop())).status, 404);
});
test('portion edits preserve declared totals, unknowns and secure replacement images through sync', async () => {
 const r = readRecipe(db.prepare('SELECT notes FROM meals WHERE id=?').get(id).notes).recipe;
 const notes = encodeRecipe(r, 'My notes');
 const body = { ...recipePortion(r, 2), notes };
 assert.equal((await put(id, body)).status, 200); assert.equal((await put(id, body)).status, 200);
 let row = db.prepare('SELECT * FROM meals WHERE id=?').get(id);
 assert.equal(JSON.parse(row.nutrition).calories, 189); assert.equal(row.portion, 1);
 assert.equal((await put(id, { img_url: 'data:image/png;base64,' + photo.toString('base64') })).status, 200);
 row = db.prepare('SELECT * FROM meals WHERE id=?').get(id); assert.ok(row.img_url.startsWith('/api/mealtime/images/'));
 const pushed = await fetch(base + '/api/sync/push', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ foods: [], meals: [{ ...row, nutrition: JSON.parse(row.nutrition), items: [], server_id: id, client_id: id, updated_at: new Date().toISOString(), img_url: row.img_url }], diary: [] }) });
 assert.equal(pushed.status, 200);
 assert.equal(readRecipe(db.prepare('SELECT notes FROM meals WHERE id=?').get(id).notes).userNotes, 'My notes');
 assert.equal((await put(id, { visibility: 'group' })).status, 400);
 const repost = await fetch(base + '/api/meals', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...row, items: [], nutrition: JSON.parse(row.nutrition), visibility: 'group' }) });
 assert.equal(repost.status, 200);
 assert.equal(db.prepare('SELECT visibility FROM meals WHERE id=?').get(id).visibility, 'private');
});
test('invalid archives fail before writes and protected image IDs cannot be stolen', async () => {
 assert.equal((await upload(archive([{ ...source, imageSha256: 'bad' }]), true)).status, 400);
 const z = new AdmZip(); z.addFile('manifest.json', Buffer.from('{}')); z.addFile('not-allowed.txt', photo);
 assert.equal((await upload(z.toBuffer(), true)).status, 400);
 const own = await fetch(base + '/api/meals', { method: 'POST', headers: { Authorization: 'Bearer ' + stranger, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Foreign fixture', source_app: 'mealtime', source_external_id: 'other', is_recipe: true }) });
 const foreign = await own.json();
 const stealCreate = await fetch(base + '/api/meals', { method: 'POST', headers: { Authorization: 'Bearer ' + stranger, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Steal image', source_app: 'mealtime', source_external_id: 'steal', img_url: image }) });
 assert.equal(stealCreate.status, 403);
 const steal = await fetch(base + '/api/meals/' + foreign.id, { method: 'PUT', headers: { Authorization: 'Bearer ' + stranger, 'Content-Type': 'application/json' }, body: JSON.stringify({ img_url: image }) });
 assert.equal(steal.status, 403);
 const bypass = await fetch(base + '/api/sync/push', { method: 'POST', headers: { Authorization: 'Bearer ' + stranger, 'Content-Type': 'application/json' }, body: JSON.stringify({ foods: [], meals: [{ server_id: foreign.id, client_id: foreign.id, name: 'Foreign fixture', updated_at: new Date().toISOString(), img_url: image, notes: '' }], diary: [] }) });
 assert.equal(bypass.status, 403);
});
if (process.env.MEALTIME_ARCHIVE_TEST) test('complete real notebook imports 110 recipes/photos into a disposable database only', async () => {
 const bytes = readFileSync(process.env.MEALTIME_ARCHIVE_TEST);
 const expected = new Map(inspectArchive(bytes).map(row => [row.recipe.sourceId, sha256(row.image)]));
 const before = db.prepare('SELECT count(*) n FROM meals').get().n;
 const r = await upload(bytes, true); assert.equal(r.status, 200); const summary = await r.json(); assert.equal(summary.create, 110);
 const repeated = await upload(bytes, true); assert.equal((await repeated.json()).skipped, 110);
 assert.equal(db.prepare('SELECT count(*) n FROM meals').get().n, before + 110);
 const rows = db.prepare("SELECT * FROM meals WHERE source_app='mealtime' AND source_external_id != 'test_01' AND user_id=?").all(owner);
 assert.equal(rows.filter(row => readRecipe(row.notes).recipe.cookedYieldG === null).length, 74);
 for (const row of rows) {
   const response = await fetch(base + row.img_url, { headers: { Authorization: 'Bearer ' + token } }); assert.equal(response.status, 200);
   assert.equal(sha256(Buffer.from(await response.arrayBuffer())), expected.get(row.source_external_id));
 }
});

test('import rate limit remains enforced', async () => {
 for (let i = 0; i < 5; i++) assert.equal((await upload(archive())).status, 200);
 const r = await upload(archive()); assert.equal(r.status, 429); assert.ok(r.headers.get('retry-after'));
});

if (process.env.MEALTIME_BROWSER_TEST === '1') test('mobile web import and declared recipe editor', async () => {
 const { checkMealTimeBrowser } = await import('./mealtime-browser.mjs');
 await checkMealTimeBrowser({ token, recipeId: id, archive: process.env.MEALTIME_ARCHIVE_TEST, db, realRecipeId: db.prepare("SELECT id FROM meals WHERE source_external_id='mic_dejun_01' AND source_app='mealtime'").get().id });
});
