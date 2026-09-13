import nodemailer from 'nodemailer';
import {requireAdmin,json,parseBody} from './_shared.mjs';
export async function handler(event){
  try{
    await requireAdmin(event);
    const sender=process.env.GMAIL_USER||'', pass=process.env.GMAIL_APP_PASSWORD||'';
    if(event.httpMethod==='GET') return json(200,{sender:sender||null,configured:!!(sender&&pass)});
    if(event.httpMethod==='POST'){
      const b=parseBody(event),to=String(b.to||'').trim();
      if(!to.includes('@')) return json(400,{error:'Email nhận thử không hợp lệ'});
      if(!sender||!pass) return json(500,{error:'Chưa cấu hình Gmail trên Netlify'});
      const transporter=nodemailer.createTransport({service:'gmail',auth:{user:sender,pass}});
      await transporter.sendMail({from:`PostureGuard AI <${sender}>`,to,subject:'[PostureGuard AI] Kiểm tra email hệ thống',text:'Email hệ thống PostureGuard AI đang hoạt động bình thường.'});
      return json(200,{ok:true});
    }
    return json(405,{error:'Method not allowed'});
  }catch(e){return json(e.statusCode||500,{error:e.message})}
}
