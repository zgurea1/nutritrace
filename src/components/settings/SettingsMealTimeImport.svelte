<script>
  import { _ } from 'svelte-i18n';
  import { importMealTimeNotebook } from '../../lib/api.js';
  import { isNative } from '../../lib/platform.js';
  let file, preview = null, result = null, busy = false, error = '', rights = false;
  async function run(apply = false) {
    if (!file) return;
    busy = true; error = ''; result = null;
    try {
      const response = await importMealTimeNotebook(file, apply, rights);
      if (apply) {
        result = response; preview = null;
        if (isNative) {
          const { fullSync } = await import('../../lib/sync.js');
          await fullSync(false, true);
        }
      } else preview = response;
    } catch (e) { error = e.message; }
    finally { busy = false; }
  }
</script>
<section class="card" style="padding:20px;margin-top:16px">
  <h3>{$_('mealtime.import_title')}</h3>
  <p class="text-3">{$_('mealtime.import_help')}</p>
  <label>{$_('mealtime.archive')}<input type="file" accept=".zip,application/zip" disabled={busy} on:change={e => { file = e.currentTarget.files?.[0]; preview = null; result = null; error = ''; rights = false; }} /></label>
  <button class="btn btn-secondary" style="margin-top:12px" disabled={!file || busy} on:click={() => run(false)}>{$_('mealtime.preview')}</button>
  {#if preview}
    <p role="status">{$_('mealtime.preview_result', { values: preview })}</p>
    <label style="display:flex;gap:10px;align-items:center"><input type="checkbox" bind:checked={rights} disabled={busy} />{$_('mealtime.rights')}</label>
    <button class="btn btn-primary" style="margin-top:12px" disabled={!rights || busy || preview.conflicts > 0 || preview.create === 0} on:click={() => run(true)}>{busy ? $_('mealtime.importing') : $_('mealtime.import_action')}</button>
  {/if}
  {#if result}<p role="status">{$_('mealtime.import_result', { values: result })}</p>{/if}
  {#if error}<p role="alert" style="color:var(--danger)">{error}</p>{/if}
</section>
