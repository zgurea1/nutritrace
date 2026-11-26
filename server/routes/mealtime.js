import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import db from '../db.js';
import { requireAuth, userMgmtActive } from '../middleware/auth.js';
import { wrap } from '../logger.js';
import { makeRateLimiter } from '../middleware/rate-limit.js';
import { inspectArchive } from '../lib/mealtime/archive.js';
import { encodeRecipe, recipePortion } from '../../src/lib/mealtime/recipe.js';
const router = Router();
router.use(requireAuth);
const limit = makeRateLimiter({ max: 5, windowMs: 60000, label: 'mealtime-import' });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 2 } });
const privateRoot = () => path.resolve(process.env.UPLOADS_PATH || './uploads', 'mealtime-private');
function owner(req) { return userMgmtActive() ? req.user.id : null; }
const find = (uid, id) => db.prepare('SELECT * FROM meals WHERE user_id IS ? AND source_app=? AND source_external_id=? AND deleted_at IS NULL').get(uid, 'mealtime', id);
router.post('/import', limit, (req, res, next) => upload.single('file')(req, res, err => {
  if (err) return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: 'Invalid or oversized archive' });
  next();
}), wrap((req, res) => {
  const rows = inspectArchive(req.file?.buffer);
  const uid = owner(req);
  const plan = rows.map(row => {
    const old = find(uid, row.recipe.sourceId);
    // Existing imports are never overwritten, including edited personal copies.
    return { ...row, old, action: !old ? 'create' : old.source_url === 'mealtime-sha256:' + row.digest ? 'skip' : 'conflict' };
  });
  const summary = { recipes: rows.length, create: plan.filter(p => p.action === 'create').length, skipped: plan.filter(p => p.action === 'skip').length, conflicts: plan.filter(p => p.action === 'conflict').length };
  if (req.body.apply !== 'true') return res.json({ ...summary, dryRun: true });
  if (req.body.rightsConfirmed !== 'true') return res.status(400).json({ error: 'Confirm your rights to import this content' });
  if (summary.conflicts) return res.status(409).json({ error: 'Existing recipes differ; no recipes were replaced', ...summary });
  const written = [];
  try {
    fs.mkdirSync(privateRoot(), { recursive: true, mode: 0o700 });
    db.transaction(() => {
      for (const row of plan) {
        if (row.action !== 'create') continue;
        const r = row.recipe, p = recipePortion(r, 1);
        const img = `${row.digest}.${row.ext}`;
        const file = path.join(privateRoot(), img);
        if (!fs.existsSync(file)) { fs.writeFileSync(file, row.image, { flag: 'wx', mode: 0o600 }); written.push(file); }
        db.prepare(`INSERT INTO meals (user_id,name,nutrition,items,img_url,notes,is_recipe,portion,unit,servings,visibility,source_app,source_external_id,source_url,updated_at)
          VALUES (?,?,?,?,?,?,1,?,?,1,'private','mealtime',?,?,datetime('now'))`).run(
          uid, r.title, JSON.stringify(p.nutrition), '[]', `/api/mealtime/images/${img}`, encodeRecipe(r), p.portion, p.unit, r.sourceId, 'mealtime-sha256:' + row.digest);
      }
    })();
  } catch (error) { for (const f of written) fs.rmSync(f, { force: true }); throw error; }
  res.json({ ...summary, dryRun: false });
}));
router.get('/images/:name', wrap((req, res) => {
  const name = req.params.name;
  if (!/^[a-f0-9]{64}\.(jpg|png)$/.test(name)) return res.sendStatus(404);
  const uid = owner(req);
  // Personal notebook images require the owner, even when another meal is shared.
  const linked = db.prepare('SELECT id FROM meals WHERE user_id IS ? AND source_app=? AND img_url=? AND deleted_at IS NULL LIMIT 1').get(uid, 'mealtime', '/api/mealtime/images/' + name);
  if (!linked) return res.sendStatus(404);
  res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  res.sendFile(path.join(privateRoot(), name));
}));
export default router;
