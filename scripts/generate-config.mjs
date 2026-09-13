import fs from 'fs';
const url=process.env.SUPABASE_URL_PUBLIC || process.env.SUPABASE_URL || '';
const anon=process.env.SUPABASE_ANON_KEY || '';
fs.writeFileSync('config.js', `window.POSTUREGUARD_CONFIG = ${JSON.stringify({SUPABASE_URL:url,SUPABASE_ANON_KEY:anon})};\n`);
console.log('Generated config.js');
