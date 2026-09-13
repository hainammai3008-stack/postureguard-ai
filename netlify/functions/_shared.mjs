import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

export function supabaseAdmin(){
  const url=process.env.SUPABASE_URL, key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key) throw new Error('Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
export function json(statusCode,body){return{statusCode,headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify(body)}}
export function parseBody(event){try{return JSON.parse(event.body||'{}')}catch{return{}}}
export function isUuid(v=''){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)}

export async function requireUser(event){
  const auth=event.headers.authorization||event.headers.Authorization||'';
  const token=auth.startsWith('Bearer ')?auth.slice(7):'';
  if(!token) throw Object.assign(new Error('Unauthorized'),{statusCode:401});
  const db=supabaseAdmin();
  const {data,error}=await db.auth.getUser(token);
  if(error||!data.user) throw Object.assign(new Error('Unauthorized'),{statusCode:401});
  return {user:data.user,db};
}
function adminSecret(){return process.env.SUPER_ADMIN_PASSWORD_MD5||'missing-admin-secret'}
export function createAdminToken(username){
  const exp=Date.now()+8*60*60*1000;
  const payload=Buffer.from(JSON.stringify({u:username,exp})).toString('base64url');
  const sig=crypto.createHmac('sha256',adminSecret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
export function verifyAdminToken(token=''){
  try{
    const [payload,sig]=token.split('.'); if(!payload||!sig)return false;
    const expected=crypto.createHmac('sha256',adminSecret()).update(payload).digest('base64url');
    if(sig.length!==expected.length)return false;
    if(!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))return false;
    const data=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
    return data.u===process.env.SUPER_ADMIN_USERNAME&&Number(data.exp)>Date.now();
  }catch{return false}
}
export async function requireAdmin(event){
  const auth=event.headers.authorization||event.headers.Authorization||'';
  const token=auth.startsWith('Bearer ')?auth.slice(7):'';
  if(!verifyAdminToken(token)) throw Object.assign(new Error('Admin unauthorized'),{statusCode:401});
  return {db:supabaseAdmin()};
}
