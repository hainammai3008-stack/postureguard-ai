import Busboy from 'busboy';
import {requireUser,json} from './_shared.mjs';

const allowedModels=new Set(['cnn','resnet50','densenet121','efficientnetb0']);

function parseMultipart(event){
  return new Promise((resolve,reject)=>{
    const fields={};
    const files=[];
    const bb=Busboy({headers:event.headers});

    bb.on('field',(name,val)=>{fields[name]=val;});

    bb.on('file',(name,stream,info)=>{
      const chunks=[];
      stream.on('data',d=>chunks.push(d));
      stream.on('end',()=>files.push({
        fieldname:name,
        filename:info.filename,
        mimeType:info.mimeType,
        buffer:Buffer.concat(chunks)
      }));
    });

    bb.on('error',reject);
    bb.on('finish',()=>resolve({fields,files}));

    const raw=Buffer.from(event.body||'', event.isBase64Encoded?'base64':'binary');
    bb.end(raw);
  });
}

function publicUrl(modelKey,version){
  const base=process.env.SUPABASE_URL;
  const bucket=process.env.SUPABASE_MODEL_BUCKET||'ai-models';
  return `${base}/storage/v1/object/public/${bucket}/${modelKey}/${version}/model.json`;
}

export async function handler(event){
  try{
    if(event.httpMethod!=='POST') return json(405,{error:'Method not allowed'});
    const {db}=await requireUser(event);

    // Demo: mọi user đăng nhập đều có thể vào tab System.
    // Nếu muốn chặt hơn, thêm role admin vào user_profiles và check tại đây.

    const {fields,files}=await parseMultipart(event);
    const modelKey=String(fields.model_key||'');
    const version=String(fields.model_version||'').trim();
    const activate=String(fields.activate||'false')==='true';

    if(!allowedModels.has(modelKey)) return json(400,{error:'model_key không hợp lệ'});
    if(!/^[A-Za-z0-9._-]+$/.test(version)) return json(400,{error:'model_version không hợp lệ'});

    const jsonFile=files.find(f=>f.fieldname==='model_json');
    const bins=files.filter(f=>f.fieldname==='weight_files');

    if(!jsonFile) return json(400,{error:'Thiếu model.json'});
    if(!bins.length) return json(400,{error:'Thiếu weight files *.bin'});
    if(jsonFile.filename!=='model.json') return json(400,{error:'File JSON phải tên là model.json'});

    for(const f of bins){
      if(!f.filename.endsWith('.bin')) return json(400,{error:`File ${f.filename} không phải .bin`});
    }

    const bucket=process.env.SUPABASE_MODEL_BUCKET||'ai-models';

    // upload all model files
    const all=[jsonFile,...bins];
    for(const f of all){
      const path=`${modelKey}/${version}/${f.filename}`;
      const {error}=await db.storage.from(bucket).upload(path,f.buffer,{
        contentType:f.mimeType||'application/octet-stream',
        upsert:true
      });
      if(error) throw error;
    }

    const model_url=publicUrl(modelKey,version);

    // register model version
    const {error:me}=await db.from('model_registry').upsert({
      model_key:modelKey,
      model_version:version,
      model_url,
      uploaded_at:new Date().toISOString()
    },{onConflict:'model_key,model_version'});
    if(me) throw me;

    let config=null;
    if(activate){
      config={
        id:1,
        selected_model:modelKey,
        model_version:version,
        model_url,
        updated_at:new Date().toISOString()
      };
      const {error:ce}=await db.from('system_config').upsert(config,{onConflict:'id'});
      if(ce) throw ce;
    }

    return json(200,{ok:true,model_url,config});
  }catch(e){
    console.error(e);
    return json(e.statusCode||500,{error:e.message});
  }
}
