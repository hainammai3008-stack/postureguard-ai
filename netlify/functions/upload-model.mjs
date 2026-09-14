import Busboy from 'busboy';
import crypto from 'crypto';
import {requireAdmin,json} from './_shared.mjs';

const allowedModels=new Set(['cnn','resnet50','densenet121','efficientnetb0']);

function requestId(){
  return crypto.randomBytes(6).toString('hex');
}

function parseMultipart(event){
  return new Promise((resolve,reject)=>{
    const fields={},files=[];
    let bb;
    try{
      bb=Busboy({headers:event.headers});
    }catch(e){
      return reject(Object.assign(e,{stage:'parse_multipart_init'}));
    }
    bb.on('field',(n,v)=>fields[n]=v);
    bb.on('file',(name,stream,info)=>{
      const chunks=[];
      stream.on('data',d=>chunks.push(d));
      stream.on('error',e=>reject(Object.assign(e,{stage:'parse_multipart_file'})));
      stream.on('end',()=>files.push({
        fieldname:name,
        filename:info.filename,
        mimeType:info.mimeType,
        buffer:Buffer.concat(chunks)
      }));
    });
    bb.on('error',e=>reject(Object.assign(e,{stage:'parse_multipart'})));
    bb.on('finish',()=>resolve({fields,files}));
    try{
      bb.end(Buffer.from(event.body||'',event.isBase64Encoded?'base64':'binary'));
    }catch(e){
      reject(Object.assign(e,{stage:'parse_multipart_body'}));
    }
  });
}

function publicUrl(modelKey,version){
  const base=process.env.SUPABASE_URL;
  const bucket=process.env.SUPABASE_MODEL_BUCKET||'ai-models';
  return `${base}/storage/v1/object/public/${bucket}/${modelKey}/${version}/model.json`;
}

function fail(statusCode,id,stage,error,extra={}){
  const detail=error?.message||String(error||'Unknown error');
  console.error('[upload-model]',{request_id:id,stage,detail,...extra,error});
  return json(statusCode,{ok:false,error:'Upload model failed',detail,stage,request_id:id,...extra});
}

export async function handler(event){
  const id=requestId();
  console.log('[upload-model] START',{
    request_id:id,
    method:event.httpMethod,
    content_type:event.headers?.['content-type']||event.headers?.['Content-Type'],
    content_length:event.headers?.['content-length']||event.headers?.['Content-Length'],
    isBase64Encoded:event.isBase64Encoded
  });

  try{
    if(event.httpMethod!=='POST') return json(405,{error:'Method not allowed',request_id:id});

    let db;
    try{
      ({db}=await requireAdmin(event));
    }catch(e){
      return fail(e.statusCode||401,id,'auth',e);
    }

    let parsed;
    try{
      parsed=await parseMultipart(event);
    }catch(e){
      return fail(400,id,e.stage||'parse_multipart',e);
    }

    const {fields,files}=parsed;
    const modelKey=String(fields.model_key||'');
    const version=String(fields.model_version||'').trim();
    const activate=String(fields.activate||'false')==='true';

    console.log('[upload-model] PARSED',{
      request_id:id,
      modelKey,
      version,
      activate,
      files:files.map(f=>({field:f.fieldname,name:f.filename,size:f.buffer?.length||0,mimeType:f.mimeType}))
    });

    if(!allowedModels.has(modelKey)) return fail(400,id,'validate_model_key',new Error('model_key không hợp lệ'),{model_key:modelKey});
    if(!/^[A-Za-z0-9._-]+$/.test(version)) return fail(400,id,'validate_model_version',new Error('model_version không hợp lệ'),{model_version:version});

    const jf=files.find(f=>f.fieldname==='model_json');
    const bins=files.filter(f=>f.fieldname==='weight_files');
    if(!jf) return fail(400,id,'validate_files',new Error('Thiếu model.json'));
    if(!bins.length) return fail(400,id,'validate_files',new Error('Thiếu weight files *.bin'));
    if(jf.filename!=='model.json') return fail(400,id,'validate_files',new Error('File JSON phải tên model.json'),{filename:jf.filename});
    for(const f of bins){
      if(!f.filename.endsWith('.bin')) return fail(400,id,'validate_files',new Error(`${f.filename} không phải .bin`),{filename:f.filename});
    }

    const bucket=process.env.SUPABASE_MODEL_BUCKET||'ai-models';
    for(const f of [jf,...bins]){
      const storagePath=`${modelKey}/${version}/${f.filename}`;
      console.log('[upload-model] SUPABASE_UPLOAD',{request_id:id,bucket,path:storagePath,size:f.buffer.length});
      const {error}=await db.storage.from(bucket).upload(storagePath,f.buffer,{
        contentType:f.mimeType||'application/octet-stream',
        upsert:true
      });
      if(error) return fail(Number(error.statusCode)||400,id,'supabase_storage',error,{bucket,file:f.filename,path:storagePath});
    }

    const model_url=publicUrl(modelKey,version);
    const {error:me}=await db.from('model_registry').upsert({
      model_key:modelKey,
      model_version:version,
      model_url,
      uploaded_at:new Date().toISOString()
    },{onConflict:'model_key,model_version'});
    if(me) return fail(Number(me.code)||400,id,'model_registry',me,{model_key:modelKey,model_version:version});

    let config=null;
    if(activate){
      config={id:1,selected_model:modelKey,model_version:version,model_url,updated_at:new Date().toISOString()};
      const {error:ce}=await db.from('system_config').upsert(config,{onConflict:'id'});
      if(ce) return fail(Number(ce.code)||400,id,'system_config',ce,{model_key:modelKey,model_version:version});
    }

    console.log('[upload-model] SUCCESS',{request_id:id,model_url,activate});
    return json(200,{ok:true,model_url,config,request_id:id});
  }catch(e){
    return fail(e.statusCode||500,id,e.stage||'unhandled',e);
  }
}
