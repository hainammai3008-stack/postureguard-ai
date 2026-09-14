import crypto from 'crypto';
import { requireAdmin, json, parseBody } from './_shared.mjs';

const allowedModels = new Set(['cnn','resnet50','densenet121','efficientnetb0']);
const safeName = name => /^[A-Za-z0-9._-]+$/.test(name || '');

function fail(statusCode, requestId, stage, error, detail, extra = {}) {
  return json(statusCode, { ok:false, request_id:requestId, stage, error, detail, ...extra });
}

export async function handler(event) {
  const requestId = crypto.randomUUID();
  console.log(`[${requestId}] prepare-model-upload START`, {
    method: event.httpMethod,
    contentLength: event.headers?.['content-length'] || null
  });

  try {
    if (event.httpMethod !== 'POST') {
      return fail(405, requestId, 'method', 'Method not allowed', 'Chỉ hỗ trợ POST');
    }

    const { db } = await requireAdmin(event);
    const body = parseBody(event);
    const modelKey = String(body.model_key || '').trim();
    const version = String(body.model_version || '').trim();
    const files = Array.isArray(body.files) ? body.files : [];

    if (!allowedModels.has(modelKey)) {
      return fail(400, requestId, 'validate', 'model_key không hợp lệ', modelKey);
    }
    if (!/^[A-Za-z0-9._-]+$/.test(version)) {
      return fail(400, requestId, 'validate', 'model_version không hợp lệ', version);
    }
    if (!files.length) {
      return fail(400, requestId, 'validate', 'Thiếu danh sách file', 'Cần model.json và ít nhất một file .bin');
    }

    const names = files.map(f => String(f?.name || ''));
    if (!names.includes('model.json')) {
      return fail(400, requestId, 'validate', 'Thiếu model.json', 'Tên file JSON phải chính xác là model.json');
    }
    if (!names.some(n => n.endsWith('.bin'))) {
      return fail(400, requestId, 'validate', 'Thiếu weight files', 'Cần ít nhất một file *.bin');
    }
    if (new Set(names).size !== names.length) {
      return fail(400, requestId, 'validate', 'Tên file bị trùng', names.join(', '));
    }
    for (const name of names) {
      if (!safeName(name) || (name !== 'model.json' && !name.endsWith('.bin'))) {
        return fail(400, requestId, 'validate', 'Tên file không hợp lệ', name);
      }
    }

    const bucket = process.env.SUPABASE_MODEL_BUCKET || 'ai-models';
    const uploads = [];

    for (const file of files) {
      const name = String(file.name);
      const path = `${modelKey}/${version}/${name}`;
      console.log(`[${requestId}] create signed upload URL`, { bucket, path, size:file.size || null });
      const { data, error } = await db.storage.from(bucket).createSignedUploadUrl(path, { upsert:true });
      if (error) {
        console.error(`[${requestId}] createSignedUploadUrl ERROR`, error);
        return fail(
          Number(error.statusCode || 400),
          requestId,
          'create_signed_upload_url',
          'Không tạo được signed upload URL',
          error.message || String(error),
          { bucket, path }
        );
      }
      uploads.push({
        name,
        path,
        token:data?.token,
        signed_url:data?.signedUrl || data?.signedURL || null,
        content_type:file.type || (name === 'model.json' ? 'application/json' : 'application/octet-stream')
      });
    }

    console.log(`[${requestId}] prepare-model-upload OK`, { bucket, count:uploads.length });
    return json(200, { ok:true, request_id:requestId, bucket, uploads });
  } catch (e) {
    console.error(`[${requestId}] prepare-model-upload EXCEPTION`, e);
    return fail(
      Number(e?.statusCode || 500),
      requestId,
      'exception',
      'Prepare upload failed',
      e?.message || String(e)
    );
  }
}
