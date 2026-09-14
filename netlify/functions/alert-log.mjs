import {requireUser,json,parseBody,isUuid} from './_shared.mjs';
export async function handler(event){
  try{const {user,db}=await requireUser(event);if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed'});const b=parseBody(event);const {error}=await db.from('alerts').insert({user_id:user.id,session_id:isUuid(b.session_id||'')?b.session_id:null,posture:b.posture||'unknown',duration_seconds:Number(b.duration_seconds||0),channel:b.channel||'audio',model_key:b.model_key||'mobilenetv2'});if(error)throw error;return json(200,{ok:true})}catch(e){return json(e.statusCode||500,{error:e.message})}
}
