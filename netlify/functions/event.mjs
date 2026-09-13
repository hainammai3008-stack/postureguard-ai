import {requireUser,json,parseBody,isUuid} from './_shared.mjs';
const allowed=new Set(['upright','leaning_left','leaning_right','leaning_backward']);
export async function handler(event){
  try{const {user,db}=await requireUser(event);if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed'});const b=parseBody(event);if(!isUuid(b.session_id))return json(400,{error:'session_id không hợp lệ'});if(!allowed.has(b.posture))return json(400,{error:'posture không hợp lệ'});const {error}=await db.from('posture_events').insert({user_id:user.id,session_id:b.session_id,posture:b.posture,confidence:Number(b.confidence||0),model_key:b.model_key||'cnn',started_at:b.started_at||new Date().toISOString(),duration_seconds:Math.max(1,Math.min(86400,Number(b.duration_seconds||1)))});if(error)throw error;return json(200,{ok:true})}catch(e){return json(e.statusCode||500,{error:e.message})}
}
