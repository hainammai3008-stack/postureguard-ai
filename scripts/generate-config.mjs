import fs from 'fs';

const config = {
  SUPABASE_URL: process.env.SUPABASE_URL_PUBLIC || process.env.SUPABASE_URL || '',
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || ''
};

fs.writeFileSync('config.js', `window.POSTUREGUARD_CONFIG = ${JSON.stringify(config)};\n`);
console.log('Generated config.js');
