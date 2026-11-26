import fs from 'node:fs';
import path from 'node:path';
import db from '../../db.js';
import { sha256 } from './archive.js';
import { detectImageTypeFromBuffer } from '../image-magic.js';
// Source-specific image writes never use the publicly served uploads path.
export function notebookImage(uid, url) {
  if (!url) return null;
  const data = /^data:image\/(jpeg|png);base64,([a-z0-9+/=]+)$/i.exec(url);
  if (data) {
    const bytes = Buffer.from(data[2], 'base64');
    const kind = detectImageTypeFromBuffer(bytes);
    if (bytes.length > 2 * 1024 * 1024 || !['jpeg', 'png'].includes(kind)) throw Object.assign(Error('Use a JPEG or PNG photo up to 2 MB'), { status: 400 });
    const name = sha256(bytes) + (kind === 'png' ? '.png' : '.jpg');
    const folder = path.resolve(process.env.UPLOADS_PATH || './uploads', 'mealtime-private');
    fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
    const file = path.join(folder, name);
    if (!fs.existsSync(file)) fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
    return '/api/mealtime/images/' + name;
  }
  // Cached native paths are normalized by the existing client before writes.
  const pathname = String(url).startsWith('http') ? new URL(url).pathname : String(url);
  const match = /\/api\/mealtime\/images\/[a-f0-9]{64}\.(jpg|png)$/.exec(pathname);
  const relative = match?.[0];
  if (!relative || !db.prepare('SELECT id FROM meals WHERE user_id IS ? AND img_url=? AND source_app=? AND deleted_at IS NULL').get(uid, relative, 'mealtime'))
    throw Object.assign(Error('This notebook photo is not owned by this account'), { status: 403 });
  return relative;
}
