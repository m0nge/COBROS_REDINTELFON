import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://xgbgyjdojbomkwkuhqpi.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhnYmd5amRvamJvbWt3a3VocXBpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2MTE0NzUsImV4cCI6MjEwNjE4NzQ3NX0.2xX9d_WgTQaLCNuTI7KA96jN-yBsKQ4e8yHF-Hk8f0w';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
