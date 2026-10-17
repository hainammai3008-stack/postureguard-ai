import {requireUser,json} from './_shared.mjs';
export async function handler(event){
  try{
    const {user,db}=await requireUser(event);
    if(event.httpMethod!=='GET')return json(405,{error:'Method not allowed'});
    const days=Math.max(1,Math.min(30,Number(event.queryStringParameters?.days||7)));
    const since=new Date(Date.now()-days*86400000).toISOString(),now=Date.now();
    const [sessionsResult,eventsResult,alertsResult,feedbackResult]=await Promise.all([
      db.from('monitor_sessions').select('started_at,ended_at').eq('user_id',user.id).gte('started_at',since),
      db.from('posture_events').select('posture,duration_seconds').eq('user_id',user.id).gte('started_at',since),
      db.from('alerts').select('posture,duration_seconds,channel,sent_at,model_key').eq('user_id',user.id).gte('sent_at',since).order('sent_at',{ascending:false}).limit(30),
      db.from('incorrect_alert_feedback').select('feedback_type').eq('user_id',user.id).gte('reported_at',since)
    ]);
    const error=sessionsResult.error||eventsResult.error||alertsResult.error||feedbackResult.error;
    if(error)throw error;
    const monitored=(sessionsResult.data||[]).reduce((sum,row)=>sum+Math.max(0,(new Date(row.ended_at||now)-new Date(row.started_at))/1000),0);
    let bad=0;const by={};
    for(const row of eventsResult.data||[]){if(row.posture!=='upright'){const duration=Number(row.duration_seconds||0);bad+=duration;by[row.posture]=(by[row.posture]||0)+duration}}
    const feedbackSummary={correct_alert:0,incorrect_alert:0,missed_alert:0};
    for(const row of feedbackResult.data||[])if(row.feedback_type in feedbackSummary)feedbackSummary[row.feedback_type]+=1;
    return json(200,{monitored_seconds:Math.round(monitored),bad_seconds:Math.round(bad),bad_by_posture:by,alerts:alertsResult.data||[],feedback_summary:feedbackSummary});
  }catch(e){return json(e.statusCode||500,{error:e.message})}
}
