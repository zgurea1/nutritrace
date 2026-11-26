# MealTime notebook integration

This feature imports an owner's authorized MealTime recipe notebook into the existing NutriTrace personal Recipes catalogue. NutriTrace remains Svelte/Express/SQLite. Its Open Food Facts barcode, name search and scanner integration is retained; no second provider client, database, MealTime backend, account system or paid service is introduced.

## Import the prepared notebook

On the Mac used for this change, the private archive is `.local/notebook.zip`. A visible mode0600 copy is available beside the repository at `../MealTime-notebook-2026-11-26.zip`, for selecting in the file picker. It contains 110 real recipes and their 110 matched photographs. It is ignored by Git, denied by the Vite development server, and is not included in the frontend or Docker image. A custom reverse proxy must allow an upload of at least25MB for this import endpoint.

1. Start/deploy this branch using the existing NutriTrace procedure and sign into the intended account.
2. Open **Settings → Import & Export → Import MealTime notebook**.
3. Select the ZIP and press **Check archive**. This validates the entire file, counts new/already-imported/conflicting recipes and does not create recipes or image files.
4. Confirm your rights to use the content, then press **Import recipes and photos**.
5. Open **Foods → Recipes**. Existing logging, diary snapshots and nutrition calculations are reused.

Import is server-backed. Native standalone mode does not offer this server import. Server-connected Android triggers the existing full sync after import. No real user database was imported, reset or migrated during implementation; tests use disposable SQLite databases.

Existing source IDs are skipped, preserving personal edits. If the supplied source content differs for an already imported ID, the import reports a conflict and does not overwrite any recipe. Do not delete existing recipes or reset a database just to resolve such a conflict. All new recipe rows are written in one transaction. The entire archive is checked before the first write; recipes/files created by a failed transaction are rolled back. Repeating the same archive creates no duplicate rows/files. The importer accepts at most 200 recipes, a 25 MB compressed file, 40 MB total expanded size and 2 MB per entry, with bounded decompression, exact entry names and image SHA-256 validation. Import requests are limited to five per minute per authenticated user (or IP in intentional single-user mode).

## Prepare an archive again

After installing the existing root and server dependencies, use Node 24 for the operator preparation script because the existing MealTime source uses Node's TypeScript stripping:

```sh
node scripts/prepare-mealtime.mjs \
  --source /path/to/trusted/mealtime-pwa \
  --photos /path/to/MealTime_fotografii_retete \
  --out /private/path/notebook.zip
```

The source path executes the owner's trusted existing export helpers. Do not point it at untrusted downloaded code. The script reads the original source and photographs without changing them, validates exact recipe/category/filename associations, writes a new private ZIP with mode0600 and refuses to overwrite an existing file. It never connects to a database. Proprietary recipe text and images are data supplied by the owner, not code bundled into this repository.

## Declared nutrition and unknown weights

All 110 supplied recipes declare KBJU for the whole recipe, originally one serving. NutriTrace stores per-serving nutrition; the adapter maps only the four supplied macro keys and retains the immutable whole-recipe values. Changing servings computes from those originals every time, so repeated saves do not divide again. Missing micronutrients are not filled with invented zeros.

36 recipes have a documented final mass; 74 do not. An unknown weight is stored as a serving-based portion, never as 100g or the sum of raw ingredients. The editor offers an optional measured total cooked weight. Clearing it restores serving-based logging. The diary unit picker does not offer gram conversion for serving-based recipes. The editor preserves full ingredient text, preparation steps, category and source reference separately. Ingredient text edits do not silently recalculate declared KBJU; the screen explains this. No fictitious ingredient food records are created.

The extra source details use a validated version1 envelope in the existing `notes` field. `src/lib/mealtime/recipe.js` is shared by the adapter/server/editor. Personal notes remain separate in the editor, after the envelope. This avoids adding a second recipe table or changing all native schema, sync and backup contracts. Existing notes storage carries the details through web/native sync and backups. Normal NutriTrace recipes still use their existing ingredients-derived editor. Old clients that do not understand this envelope should not edit imported recipes; update clients together with the server.

## Photographs and access

Imported photographs are stored under `UPLOADS_PATH/mealtime-private` and served only through `/api/mealtime/images/:name`. The public static uploads handler blocks this folder, including encoded, repeated-slash and case variants. When user management is enabled, only the importing owner can load the photo; anonymous/other accounts are denied. With user management deliberately disabled, NutriTrace remains its existing single-user self-hosted application: this is not a publicly authenticated or premium mode.

Photo replacement through the recipe editor and native sync uses the private store too. JPEG/PNG up to2MB are supported; external photo URL imports are not offered for this source. Incoming private image paths are checked for ownership, including writes through sync. Native image download sends the existing bearer token only to this server's private image route, never to external image hosts. PWA private images are not added to the public service-worker image cache; viewing them in PWA requires an authenticated connection. Existing native account/cache lifecycle is preserved; physical Android was not tested.

These imports are **personal**, not a premium marketplace or an automatic grant to other users. Sharing of this source is explicitly refused. Entitlements/payments and multi-user publication of a paid notebook would require a separate, reviewed feature. User journals, other users' records and access roles are unchanged.

Back up the existing SQLite database **and** the uploads volume, including `mealtime-private`. The notes envelope and source metadata are included by existing backups; do not restore a partial database without its image volume.

## Verification

The backend currently pins better-sqlite3 9.x and Docker uses Node20. On this Mac, `npm ci` in server fails under Node24, so the unchanged server dependencies were installed/tested using an isolated, checksum-verified official Node20 runtime under ignored `.local/tools`. No dependency upgrade or lockfile change was needed. Frontend build uses the normal Node24 environment. This preserves the project's stack; updating its old runtime/dependencies is a separate task.

- `npm run build`: passed; production PWA generated.
- `npm run i18n:check`: passed; existing incomplete locales continue to fall back to English. New strings are in the English source catalogue.
- `node --test scripts/mealtime-*.test.js` on the backend-compatible runtime: fixture integration tests cover preview/no-write, explicit rights, idempotence, conflict/no-overwrite, owner isolation, static path variants, image replacement, sync, source spoof attempts, declared nutrient scaling and rate limits.
- With `MEALTIME_ARCHIVE_TEST=/private/path/notebook.zip`, the same isolated test imports all110 actual recipes and photos, repeats import, verifies74unknown weights and compares every downloaded image's SHA-256 with the source.
- With `MEALTIME_BROWSER_TEST=1`, `MEALTIME_PLAYWRIGHT_MODULE` and optional `MEALTIME_CHROME_BIN`, the real built app is tested at390px with a temporary database/server: full details, private photo, repeated editor saves, no invented grams, import preview and disabled duplicate import. Screenshots inspected, kept in ignored `.local/qa`.
- Full existing test suite:920tests passed in a disposable code copy with a path without spaces. Direct execution in `APP Nutritrace` first produced nine pre-existing path handling failures (`URL.pathname` retains `%20`); no unrelated test files were rewritten.
- Two additional development privacy tests passed: the ZIP is denied by Vite (regular and /@fs URLs), and .local is excluded from Git and Docker context.
- With MEALTIME_OFF_LIVE=1 during the isolated browser run, the real NutriTrace proxy successfully read product6111035000058 from Open Food Facts. No food or diary was created by this external read.
- Docker source-import wiring is covered by existing tests; the shared recipe helper is explicitly copied into the runtime image. Docker containers, real server deployment, SMTP, physical barcode cameras and native Android/iOS were not executed as part of this change.
