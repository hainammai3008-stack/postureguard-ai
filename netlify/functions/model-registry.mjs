import {requireAdmin,json} from './_shared.mjs';
export async function handler(event){
  try{
    const {db}=await requireAdmin(event);
    if(event.httpMethod!=='GET') return json(405,{error:'Method not allowed'});
    const {data,error}=await db.from('model_registry').select('model_key,model_version,model_url,uploaded_at').order('uploaded_at',{ascending:false}).limit(100);
    if(error) throw error; return json(200,{items:data||[]});
  }catch(e){return json(e.statusCode||500,{error:e.message})}
}
