// Supabase project settings for the rating site.
// Both values are public by design: the anon (publishable) key only lets visitors call the four
// leb_ functions in supabase/schema.sql; the tables themselves stay closed to it.
// The project is shared with the outcome taxonomy rating site; this site uses only the leb_ tables and functions.
// Leave both empty to run in local-only mode (answers stay in the browser).
// For local testing with other values, create config.local.js (git-ignored) with the same two exports.
export const SUPABASE_URL = 'https://xfpuahqpfndjgzgcgzic.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_3s-0zRRlDynusRjgNUrXCQ_JOeibpAZ';
// The second sheet (short statements another program read from the same abstracts, data/statements.json).
// true (since 2026-11-18): the statements sheet follows the trials sheet. false: the site shows the trials sheet only.
export const STATEMENTS_SHEET = true;
