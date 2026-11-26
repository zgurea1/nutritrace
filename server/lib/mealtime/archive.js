import AdmZip from 'adm-zip';
import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { validateRecipe } from '../../../src/lib/mealtime/recipe.js';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = () => { throw Object.assign(Error('Invalid MealTime archive'), { status: 400 }); };
export function inspectArchive(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 25 * 1024 * 1024) fail();
  let zip;
  try { zip = new AdmZip(bytes); } catch { fail(); }
  const entries = zip.getEntries();
  if (entries.length < 2 || entries.length > 201) fail();
  const names = new Set(); let total = 0;
  for (const e of entries) {
    if (e.isDirectory || names.has(e.entryName) || !/^(manifest\.json|images\/[a-z0-9_-]+\.(jpg|png))$/i.test(e.entryName)) fail();
    names.add(e.entryName); total += e.header.size;
    if (e.header.size > 2 * 1024 * 1024 || total > 40 * 1024 * 1024) fail();
  }
  function read(name) {
    const entry = zip.getEntry(name); if (!entry) fail();
    let bytes;
    try {
      const compressed = entry.getCompressedData();
      bytes = entry.header.method === 0 ? compressed : entry.header.method === 8 ? inflateRawSync(compressed, { maxOutputLength: 2 * 1024 * 1024 }) : null;
    } catch { fail(); }
    if (!bytes || bytes.length > 2 * 1024 * 1024 || bytes.length !== entry.header.size) fail();
    return bytes;
  }
  let manifest;
  try { manifest = JSON.parse(read('manifest.json').toString('utf8')); } catch { fail(); }
  if (manifest?.format !== 'nutritrace-mealtime-v1' || !Array.isArray(manifest.recipes) || !manifest.recipes.length || manifest.recipes.length > 200) fail();
  if (entries.length !== manifest.recipes.length + 1) fail();
  const ids = new Set(), images = new Set();
  return manifest.recipes.map(row => {
    let recipe; try { recipe = validateRecipe(row); } catch { fail(); }
    if (ids.has(recipe.sourceId) || images.has(row.image) || !names.has(row.image) || !row.image.startsWith('images/')) fail();
    ids.add(recipe.sourceId); images.add(row.image);
    const image = read(row.image);
    const png = image?.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const jpeg = image?.[0] === 255 && image?.[1] === 216 && image?.[2] === 255;
    if (!image?.length || !(png || jpeg) || (png !== row.image.endsWith('.png')) || sha256(image) !== row.imageSha256) fail();
    const ext = png ? 'png' : 'jpg';
    return { recipe, image, ext, digest: sha256(Buffer.concat([Buffer.from(JSON.stringify(recipe)), image])) };
  });
}
