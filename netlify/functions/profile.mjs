import {requireUser,json,parseBody} from './_shared.mjs';
export async function handler(event){
  try{
    const {user,db}=await requireUser(event);
    if(event.httpMethod==='GET'){
      const {data,error}=await db.from('user_profiles').select('*').eq('user_id',user.id).maybeSingle();
      if(error) throw error;
      return json(200,data||{user_id:user.id,student_name:'',parent_email:'',local_alert_seconds:10,email_enabled:true,report_schedule:'session_end'});
    }
    if(event.httpMethod==='POST'){
      const b=parseBody(event);
      const row={
        user_id:user.id,
        student_name:String(b.student_name||'').slice(0,120),
        parent_email:String(b.parent_email||'').slice(0,200),
        local_alert_seconds:Number(b.local_alert_seconds||10),
        email_enabled:!!b.email_enabled,
        report_schedule:['session_end','daily'].includes(b.report_schedule)?b.report_schedule:'session_end',
        updated_at:new Date().toISOString()
      };
      const {error}=await db.from('user_profiles').upsert(row,{onConflict:'user_id'}); if(error) throw error;
      return json(200,{ok:true});
    }
    return json(405,{error:'Method not allowed'});
  }catch(e){return json(e.statusCode||500,{error:e.message})}
}
