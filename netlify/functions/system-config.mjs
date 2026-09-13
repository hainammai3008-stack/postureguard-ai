import {requireAdmin,json,parseBody} from './_shared.mjs';
const models=new Set(['cnn','resnet50','densenet121','efficientnetb0']);
function publicModelUrl(modelKey,version){const base=process.env.SUPABASE_URL,bucket=process.env.SUPABASE_MODEL_BUCKET||'ai-models';return `${base}/storage/v1/object/public/${bucket}/${modelKey}/${version}/model.json`}
export async function handler(event){
  try{
    const {db}=await requireAdmin(event);
    if(event.httpMethod==='GET'){
      const {data,error}=await db.from('system_config').select('*').eq('id',1).single(); if(error)throw error; return json(200,data);
    }
    if(event.httpMethod==='POST'){
      const b=parseBody(event); if(!models.has(b.selected_model))return json(400,{error:'Model không hợp lệ'});
      const version=String(b.model_version||'v1').trim(); if(!/^[A-Za-z0-9._-]+$/.test(version))return json(400,{error:'Version không hợp lệ'});
      const {data:exists,error:re}=await db.from('model_registry').select('id').eq('model_key',b.selected_model).eq('model_version',version).maybeSingle(); if(re)throw re;
      if(!exists)return json(400,{error:'Version này chưa được upload'});
      const row={id:1,selected_model:b.selected_model,model_version:version,model_url:publicModelUrl(b.selected_model,version),updated_at:new Date().toISOString()};
      const {error}=await db.from('system_config').upsert(row,{onConflict:'id'}); if(error)throw error; return json(200,{ok:true,config:row});
    }
    return json(405,{error:'Method not allowed'});
  }catch(e){return json(e.statusCode||500,{error:e.message})}
}
