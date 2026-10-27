import { createClient } from '@supabase/supabase-js';

const getEnvVar = (key: string): string => {
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[key]) {
    return import.meta.env[key];
  }
  if (typeof process !== 'undefined' && process.env && process.env[key]) {
    return process.env[key] || '';
  }
  return '';
};

const supabaseUrl = getEnvVar('VITE_SUPABASE_URL') || 'https://xgbgyjdojbomkwkuhqpi.supabase.co';
const supabaseAnonKey = getEnvVar('VITE_SUPABASE_ANON_KEY') || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhnYmd5amRvamJvbWt3a3VocXBpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2MTE0NzUsImV4cCI6MjEwNjE4NzQ3NX0.2xX9d_WgTQaLCNuTI7KA96jN-yBsKQ4e8yHF-Hk8f0w';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
