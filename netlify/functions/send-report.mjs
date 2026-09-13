import nodemailer from 'nodemailer';
import {requireUser,json,parseBody,isUuid} from './_shared.mjs';

const DISPLAY={leaning_left:'Nghiêng trái',leaning_right:'Nghiêng phải',leaning_backward:'Ngả về sau',upright:'Tư thế đúng'};

export async function handler(event){
  try{
    const {user,db}=await requireUser(event);
    if(event.httpMethod!=='POST') return json(405,{error:'Method not allowed'});
    const b=parseBody(event);

    const {data:profile,error:pe}=await db.from('user_profiles').select('*').eq('user_id',user.id).single();
    if(pe) throw pe;
    if(!profile.parent_email?.includes('@')) return json(400,{error:'Chưa cấu hình email phụ huynh'});

    let session=null, events=[];
    if(b.is_test){
      session={id:'test',model_key:'cnn',started_at:new Date(Date.now()-30*60000).toISOString(),ended_at:new Date().toISOString()};
      events=[
        {posture:'upright',duration_seconds:1200},
        {posture:'leaning_left',duration_seconds:360},
        {posture:'leaning_right',duration_seconds:120},
        {posture:'leaning_backward',duration_seconds:120}
      ];
    }else{
      if(!isUuid(b.session_id||'')) return json(400,{error:'session_id không hợp lệ'});
      const {data:s,error:se}=await db.from('monitor_sessions').select('*').eq('id',b.session_id).eq('user_id',user.id).single();
      if(se) throw se; session=s;
      const {data:e,error:ee}=await db.from('posture_events').select('posture,duration_seconds').eq('session_id',b.session_id).eq('user_id',user.id);
      if(ee) throw ee; events=e||[];
    }

    const monitored=Math.max(1,Math.round((new Date(session.ended_at||new Date())-new Date(session.started_at))/1000));
    let upright=0,bad=0; const by={};
    for(const e of events){
      const d=Number(e.duration_seconds||0);
      if(e.posture==='upright') upright+=d;
      else {bad+=d;by[e.posture]=(by[e.posture]||0)+d;}
    }
    const correctPct=Math.max(0,Math.min(100,(monitored-bad)/monitored*100));
    const worst=Object.entries(by).sort((a,b)=>b[1]-a[1])[0];

    const sender=process.env.GMAIL_USER,pass=process.env.GMAIL_APP_PASSWORD;
    if(!sender||!pass) throw new Error('Thiếu GMAIL_USER/GMAIL_APP_PASSWORD trên Netlify');
    const transporter=nodemailer.createTransport({service:'gmail',auth:{user:sender,pass}});

    const lines=[
      `BÁO CÁO TƯ THẾ NGỒI HỌC`,
      ``,
      `Học sinh: ${profile.student_name||'Học sinh'}`,
      `Thời gian theo dõi: ${Math.round(monitored/60)} phút`,
      `Tỷ lệ ngồi đúng: ${correctPct.toFixed(1)}%`,
      `Thời gian ngồi sai: ${Math.round(bad/60)} phút`,
      `Tư thế sai nhiều nhất: ${worst?DISPLAY[worst[0]]:'Không có'}${worst?` (${Math.round(worst[1]/60)} phút)`:''}`,
      ``,
      `Chi tiết:`,
      ...Object.entries(by).map(([k,v])=>`- ${DISPLAY[k]||k}: ${Math.round(v/60)} phút`),
      ``,
      `Model AI: ${session.model_key}`,
      ``,
      `PostureGuard AI không lưu hình ảnh camera và không nhận diện danh tính.`
    ];

    await transporter.sendMail({
      from:`PostureGuard AI <${sender}>`,
      to:profile.parent_email,
      subject:`[PostureGuard AI] Báo cáo tư thế - ${profile.student_name||'Học sinh'}`,
      text:lines.join('\n')
    });

    await db.from('reports').insert({
      user_id:user.id,
      session_id:b.is_test?null:session.id,
      recipient:profile.parent_email,
      monitored_seconds:monitored,
      bad_seconds:bad,
      correct_percent:correctPct,
      model_key:session.model_key||'cnn'
    });

    return json(200,{ok:true});
  }catch(e){return json(e.statusCode||500,{error:e.message})}
}
