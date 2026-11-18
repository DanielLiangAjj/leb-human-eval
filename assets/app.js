// Entry point: read the Supabase settings, load the items, then show the welcome screen.
import * as config from '../config.js';
import * as api from './api.js';
import * as sync from './sync.js';
import { loadItems } from './state.js';
import { initUI, showWelcome, showFatal } from './views.js';

async function loadConfig() {
  let url = config.SUPABASE_URL || '';
  let key = config.SUPABASE_ANON_KEY || '';
  let statements = config.STATEMENTS_SHEET === true; // the second sheet is off unless config.js turns it on
  // config.local.js (git-ignored) overrides config.js for local testing. It never exists on
  // GitHub Pages, so the lookup is skipped there (no 404 in the console).
  if (!/\.github\.io$/.test(window.location.hostname)) {
    try {
      const local = await import('../config.local.js');
      if (local.SUPABASE_URL) url = local.SUPABASE_URL;
      if (local.SUPABASE_ANON_KEY) key = local.SUPABASE_ANON_KEY;
      if (typeof local.STATEMENTS_SHEET === 'boolean') statements = local.STATEMENTS_SHEET;
    } catch {
      // no local override
    }
  }
  return { url, key, statements };
}

async function main() {
  const { url, key, statements } = await loadConfig();
  api.configure(url, key);
  let data;
  try {
    data = await loadItems({ statements });
  } catch {
    showFatal('The trials could not be loaded. Check your connection and reload the page.');
    return;
  }
  initUI(data);
  sync.start();
  showWelcome();
}

main();
