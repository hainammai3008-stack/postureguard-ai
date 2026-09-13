import {requireUser,json,parseBody} from './_shared.mjs';

const models=new Set(['cnn','resnet50','densenet121','efficientnetb0']);

function publicModelUrl(modelKey,version){
  const base=process.env.SUPABASE_URL;
  const bucket=process.env.SUPABASE_MODEL_BUCKET||'ai-models';
  return `${base}/storage/v1/object/public/${bucket}/${modelKey}/${version}/model.json`;
}

export async function handler(event){
  try{
    const {db}=await requireUser(event);

    if(event.httpMethod==='GET'){
      const {data,error}=await db.from('system_config').select('*').eq('id',1).single();
      if(error) throw error;
      const row={...data};
      if(!row.model_url && row.selected_model && row.model_version){
        row.model_url=publicModelUrl(row.selected_model,row.model_version);
      }
      return json(200,row);
    }

    if(event.httpMethod==='POST'){
      const b=parseBody(event);
      if(!models.has(b.selected_model)) return json(400,{error:'Model không hợp lệ'});
      const version=String(b.model_version||'v1').trim();
      if(!/^[A-Za-z0-9._-]+$/.test(version)) return json(400,{error:'Version không hợp lệ'});

      const model_url=publicModelUrl(b.selected_model,version);
      const row={
        id:1,
        selected_model:b.selected_model,
        model_version:version,
        model_url,
        updated_at:new Date().toISOString()
      };

      const {error}=await db.from('system_config').upsert(row,{onConflict:'id'});
      if(error) throw error;

      return json(200,{ok:true,config:row});
    }

    return json(405,{error:'Method not allowed'});
  }catch(e){return json(e.statusCode||500,{error:e.message})}
}
