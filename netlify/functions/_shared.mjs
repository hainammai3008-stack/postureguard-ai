import { createClient } from '@supabase/supabase-js';

export function supabaseAdmin(){
  const url=process.env.SUPABASE_URL, key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key) throw new Error('Thiếu cấu hình Supabase');
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
