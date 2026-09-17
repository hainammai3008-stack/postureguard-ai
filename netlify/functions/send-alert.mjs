import nodemailer from 'nodemailer';
import {requireUser,json,parseBody,isUuid} from './_shared.mjs';
const DISPLAY={leaning_left:'nghiêng trái',leaning_right:'nghiêng phải',leaning_backward:'ngả về sau',leaning_forward:'nghiêng về trước',upright:'tư thế đúng'};
export async function handler(event){
  try{
    const {user,db}=await requireUser(event);
    if(event.httpMethod!=='POST') return json(405,{error:'Method not allowed'});
    const b=parseBody(event);
    const {data:profile,error:pe}=await db.from('user_profiles').select('*').eq('user_id',user.id).single();
    if(pe) throw pe;
    if(!profile.email_enabled && !b.is_test) return json(400,{error:'User đã tắt gửi email'});
    if(!profile.parent_email?.includes('@')) return json(400,{error:'Chưa cấu hình email phụ huynh'});
    const sender=process.env.GMAIL_USER, pass=process.env.GMAIL_APP_PASSWORD;
    if(!sender||!pass) throw new Error('Thiếu GMAIL_USER/GMAIL_APP_PASSWORD trên Netlify');
    const transporter=nodemailer.createTransport({service:'gmail',auth:{user:sender,pass}});
    const student=profile.student_name||'Học sinh', posture=DISPLAY[b.posture]||b.posture||'tư thế chưa phù hợp', duration=Math.round(Number(b.duration_seconds||0));
    const model=b.model_key||profile.selected_model||'mobilenetv2';
    const subject=b.is_test?'[PostureGuard AI] Email kiểm tra':`[PostureGuard AI] Cảnh báo tư thế của ${student}`;
    const text=b.is_test
      ? `Đây là email kiểm tra từ PostureGuard AI. Cấu hình email đang hoạt động.\n\nNgười nhận: ${profile.parent_email}\nModel đang chọn: ${model}.`
      : `PostureGuard AI phát hiện ${student} đang ngồi ${posture} trong khoảng ${duration} giây.\nModel: ${model}.\n\nVui lòng nhắc học sinh điều chỉnh lại tư thế.\n\nHệ thống không lưu ảnh camera và không nhận diện danh tính.`;
    await transporter.sendMail({from:`PostureGuard AI <${sender}>`,to:profile.parent_email,subject,text});
    const {error}=await db.from('alerts').insert({user_id:user.id,session_id:isUuid(b.session_id||'')?b.session_id:null,posture:b.posture||'leaning_left',duration_seconds:duration,channel:'email',model_key:model}); if(error) throw error;
    return json(200,{ok:true});
  }catch(e){return json(e.statusCode||500,{error:e.message})}
}
