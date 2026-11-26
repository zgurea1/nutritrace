// A versioned envelope in the existing notes field survives web/native sync and
// backups without adding a second recipe model or changing the SQLite schema.
const PREFIX = '<!-- nutritrace-mealtime:v1\n';
const END = '\n-->\n';
export const MACROS = ['calories', 'proteins', 'fat', 'carbohydrates'];
export function validateRecipe(value) {
  if (!value || value.version !== 1 || !/^[a-z0-9_-]{1,100}$/i.test(value.sourceId || '')) throw Error('Invalid MealTime recipe identity');
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 300) throw Error('Invalid recipe title');
  for (const key of ['ingredients', 'instructions']) {
    if (!Array.isArray(value[key]) || !value[key].length || value[key].length > 150 || value[key].some(s => typeof s !== 'string' || !s.trim() || s.length > 5000)) throw Error('Invalid recipe text');
  }
  if (value.cookedYieldG !== null && (!Number.isFinite(value.cookedYieldG) || value.cookedYieldG <= 0 || value.cookedYieldG > 100000)) throw Error('Invalid cooked yield');
  if (!value.nutrition || MACROS.some(k => !Number.isFinite(value.nutrition[k]) || value.nutrition[k] < 0)) throw Error('Invalid declared nutrition');
  const normalized = {
    version: 1, sourceId: value.sourceId, title: value.title.trim(),
    category: String(value.category || '').slice(0, 300),
    reference: String(value.reference || '').slice(0, 2000),
    cookedYieldG: value.cookedYieldG,
    ingredients: [...value.ingredients], instructions: [...value.instructions],
    nutrition: Object.fromEntries(MACROS.map(k => [k, value.nutrition[k]])),
  };
  if (JSON.stringify(normalized).length > 120000) throw Error('Recipe text is too long');
  return normalized;
}
export function encodeRecipe(recipe, userNotes = '') {
  const notes = PREFIX + JSON.stringify(validateRecipe(recipe)) + END + String(userNotes || '');
  if (notes.length > 150000) throw Error('Recipe notes are too long');
  return notes;
}
export function readRecipe(notes) {
  if (typeof notes !== 'string' || !notes.startsWith(PREFIX) || notes.length > 150000) return null;
  const end = notes.indexOf(END, PREFIX.length);
  if (end < 0) return null;
  try { return { recipe: validateRecipe(JSON.parse(notes.slice(PREFIX.length, end))), userNotes: notes.slice(end + END.length) }; }
  catch { return null; }
}
export function recipePortion(recipe, servings) {
  if (!Number.isSafeInteger(servings) || servings < 1 || servings > 1000) throw Error('Invalid servings');
  const r = validateRecipe(recipe);
  return {
    nutrition: Object.fromEntries(MACROS.map(k => [k, r.nutrition[k] / servings])),
    portion: r.cookedYieldG === null ? 1 : r.cookedYieldG / servings,
    unit: r.cookedYieldG === null ? 'serving' : 'g', servings,
  };
}
