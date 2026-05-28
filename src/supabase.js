// Supabase client singleton — used for auth and the employees table.
// Existing REST fetch calls in main.js continue to work as-is.
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL =
  localStorage.getItem('skdla_sb_url') ||
  import.meta.env.VITE_SUPABASE_URL ||
  '';
const SUPABASE_KEY =
  localStorage.getItem('skdla_sb_key') ||
  import.meta.env.VITE_SUPABASE_KEY ||
  '';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
