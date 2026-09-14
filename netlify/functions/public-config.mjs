import {requireUser,json} from './_shared.mjs';
export async function handler(event){
  try{
    const {db}=await requireUser(event);
    if(event.httpMethod!=='GET') return json(405,{error:'Method not allowed'});
    const {data,error}=await db.from('system_config').select('selected_model,model_version,model_url,confidence_threshold,updated_at').eq('id',1).single();
    if(error) throw error; return json(200,data);
  }catch(e){return json(e.statusCode||500,{error:e.message})}
}
