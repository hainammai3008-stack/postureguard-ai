import {requireUser,json,parseBody} from './_shared.mjs';
const models=new Set(['cnn','resnet50','densenet121','efficientnetb0']);
export async function handler(event){
  try{
    const {db}=await requireUser(event);
    if(event.httpMethod==='GET'){
      const {data,error}=await db.from('system_config').select('*').eq('id',1).single();
      if(error) throw error;
      return json(200,data);
    }
    if(event.httpMethod==='POST'){
      const b=parseBody(event);
      if(!models.has(b.selected_model)) return json(400,{error:'Model không hợp lệ'});
      const {error}=await db.from('system_config').upsert({id:1,selected_model:b.selected_model,updated_at:new Date().toISOString()},{onConflict:'id'});
      if(error) throw error;
      return json(200,{ok:true});
    }
    return json(405,{error:'Method not allowed'});
  }catch(e){return json(e.statusCode||500,{error:e.message})}
}
