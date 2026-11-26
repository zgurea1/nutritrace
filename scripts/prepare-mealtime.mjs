// Operator-only data adapter. No MealTime content or credentials are shipped in Git.
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import AdmZip from '../server/node_modules/adm-zip/adm-zip.js';
import { validateRecipe } from '../src/lib/mealtime/recipe.js';
const { values } = parseArgs({ options: { source: { type: 'string' }, photos: { type: 'string' }, out: { type: 'string' } } });
if (!values.source || !values.photos || !values.out) throw Error('Usage: node scripts/prepare-mealtime.mjs --source /trusted/mealtime-pwa --photos /recipe/photos --out /private/notebook.zip');
const { providedRecipesBundle } = await import(pathToFileURL(resolve(values.source, 'scripts/lib/provided-recipes.mjs')));
const { matchRecipePhotos } = await import(pathToFileURL(resolve(values.source, 'scripts/lib/recipe-photos.mjs')));
const bundle = providedRecipesBundle();
const photos = await matchRecipePhotos(bundle.recipes, resolve(values.photos));
const zip = new AdmZip();
const recipes = bundle.recipes.map((r, i) => {
  const photo = photos[i];
  if (photo.externalId !== r.external_id) throw Error('Photo identity mismatch');
  const image = 'images/' + r.external_id + (photo.mime === 'image/png' ? '.png' : '.jpg');
  zip.addFile(image, photo.bytes);
  const n = r.declaredNutrition.nutrients;
  return { ...validateRecipe({ version: 1, sourceId: r.external_id, title: r.title,
    category: r.metadata.category, reference: r.declaredNutrition.reference,
    ingredients: r.ingredientText, instructions: r.instructions, cookedYieldG: r.cooked_yield_g,
    nutrition: { calories: n.energyKcal, proteins: n.proteinG, fat: n.fatG, carbohydrates: n.carbohydrateG },
  }), image, imageSha256: createHash('sha256').update(photo.bytes).digest('hex') };
});
zip.addFile('manifest.json', Buffer.from(JSON.stringify({ format: 'nutritrace-mealtime-v1', recipes })));
await writeFile(resolve(values.out), zip.toBuffer(), { mode: 0o600, flag: 'wx' });
console.log(JSON.stringify({ recipes: recipes.length, photos: photos.length, unknownWeight: recipes.filter(r => r.cookedYieldG === null).length, databaseChanged: false }));
