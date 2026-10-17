import {isUuid,json,parseBody,requireUser} from './_shared.mjs';

const badPostures=new Set(['leaning_left','leaning_right','leaning_backward','leaning_forward']);
const allowedPostures=new Set([...badPostures,'upright','unknown']);
const allowedFeedbackTypes=new Set(['correct_alert','incorrect_alert','missed_alert']);

export async function handler(event){
  try{
    const {user,db}=await requireUser(event);
    if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed'});
    const body=parseBody(event);
    if(!isUuid(body.session_id))return json(400,{error:'session_id không hợp lệ'});
    const feedbackType=String(body.feedback_type||'incorrect_alert');
    if(!allowedFeedbackTypes.has(feedbackType))return json(400,{error:'feedback_type không hợp lệ'});
    if(!allowedPostures.has(body.posture))return json(400,{error:'posture không hợp lệ'});
    const isMissed=feedbackType==='missed_alert';
    if(!isMissed&&!badPostures.has(body.posture))return json(400,{error:'Phản hồi cảnh báo cần một tư thế sai hợp lệ'});
    const alertedAt=isMissed?null:new Date(body.alerted_at);
    if(!isMissed&&!Number.isFinite(alertedAt.getTime()))return json(400,{error:'alerted_at không hợp lệ'});

    const {data:session,error:sessionError}=await db
      .from('monitor_sessions')
      .select('id,started_at')
      .eq('id',body.session_id)
      .eq('user_id',user.id)
      .single();
    if(sessionError||!session)return json(404,{error:'Không tìm thấy phiên theo dõi'});
    if(!isMissed&&(alertedAt.getTime()<new Date(session.started_at).getTime()-1000||alertedAt.getTime()>Date.now()+60000)){
      return json(400,{error:'Thời điểm cảnh báo không hợp lệ'});
    }

    const reportedAt=new Date().toISOString();
    const {error}=await db.from('incorrect_alert_feedback').insert({
      user_id:user.id,
      session_id:body.session_id,
      feedback_type:feedbackType,
      posture:body.posture,
      alerted_at:alertedAt?.toISOString()||null,
      reported_at:reportedAt
    });
    if(error){
      if(error.code==='23505')return json(409,{error:'Cảnh báo này đã được phản hồi'});
      throw error;
    }
    return json(200,{ok:true,reported_at:reportedAt});
  }catch(error){
    return json(error.statusCode||500,{error:error.message});
  }
}
