import crypto from 'crypto';
import {json,parseBody,createAdminToken} from './_shared.mjs';
function md5(text){return crypto.createHash('md5').update(String(text)).digest('hex')}
export async function handler(event){
  if(event.httpMethod!=='POST') return json(405,{error:'Method not allowed'});
  const b=parseBody(event), expectedUser=process.env.SUPER_ADMIN_USERNAME, expectedHash=(process.env.SUPER_ADMIN_PASSWORD_MD5||'').toLowerCase();
  if(!expectedUser||!expectedHash) return json(500,{error:'Chưa cấu hình Super Admin trên Netlify'});
  const actualHash=md5(String(b.password||'')).toLowerCase();
  const okUser=String(b.username||'')===expectedUser;
  const okHash=actualHash.length===expectedHash.length&&crypto.timingSafeEqual(Buffer.from(actualHash),Buffer.from(expectedHash));
  if(!okUser||!okHash) return json(401,{error:'Sai tài khoản hoặc mật khẩu'});
  return json(200,{ok:true,token:createAdminToken(expectedUser),expires_in:28800});
}
