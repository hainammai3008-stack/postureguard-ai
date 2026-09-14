import crypto from 'crypto';
import { requireAdmin, json, parseBody } from './_shared.mjs';

const allowedModels = new Set(['mobilenetv2','resnet50','densenet121','efficientnetb0']);

function fail(statusCode, requestId, stage, error, detail, extra = {}) {
  return json(statusCode, { ok:false, request_id:requestId, stage, error, detail, ...extra });
}

function publicUrl(modelKey, version) {
  const base = process.env.SUPABASE_URL;
  const bucket = process.env.SUPABASE_MODEL_BUCKET || 'ai-models';
  return `${base}/storage/v1/object/public/${bucket}/${modelKey}/${version}/model.json`;
}

export async function handler(event) {
  const requestId = crypto.randomUUID();
  console.log(`[${requestId}] finalize-model-upload START`, { method:event.httpMethod });

  try {
    if (event.httpMethod !== 'POST') {
      return fail(405, requestId, 'method', 'Method not allowed', 'Chỉ hỗ trợ POST');
    }

    const { db } = await requireAdmin(event);
    const body = parseBody(event);
    const modelKey = String(body.model_key || '').trim();
    const version = String(body.model_version || '').trim();
    const activate = body.activate === true || String(body.activate) === 'true';
    const uploadedFiles = Array.isArray(body.uploaded_files) ? body.uploaded_files : [];

    if (!allowedModels.has(modelKey)) {
      return fail(400, requestId, 'validate', 'model_key không hợp lệ', modelKey);
    }
    if (!/^[A-Za-z0-9._-]+$/.test(version)) {
      return fail(400, requestId, 'validate', 'model_version không hợp lệ', version);
    }
    if (!uploadedFiles.includes('model.json') || !uploadedFiles.some(x => String(x).endsWith('.bin'))) {
      return fail(400, requestId, 'validate', 'Danh sách file upload chưa đầy đủ', uploadedFiles.join(', '));
    }

    const model_url = publicUrl(modelKey, version);
    console.log(`[${requestId}] register model`, { modelKey, version, model_url, uploadedFiles });

    const { error: registryError } = await db
      .from('model_registry')
      .upsert({
        model_key:modelKey,
        model_version:version,
        model_url,
        uploaded_at:new Date().toISOString()
      }, { onConflict:'model_key,model_version' });

    if (registryError) {
      console.error(`[${requestId}] model_registry ERROR`, registryError);
      return fail(
        Number(registryError.code === '42501' ? 403 : 400),
        requestId,
        'model_registry',
        'Không ghi được model_registry',
        registryError.message || String(registryError),
        { code:registryError.code || null }
      );
    }

    let config = null;
    if (activate) {
      config = {
        id:1,
        selected_model:modelKey,
        model_version:version,
        model_url,
        updated_at:new Date().toISOString()
      };
      const { error: configError } = await db
        .from('system_config')
        .upsert(config, { onConflict:'id' });

      if (configError) {
        console.error(`[${requestId}] system_config ERROR`, configError);
        return fail(
          400,
          requestId,
          'system_config',
          'Upload file thành công nhưng activate model thất bại',
          configError.message || String(configError),
          { code:configError.code || null, model_url }
        );
      }
    }

    console.log(`[${requestId}] finalize-model-upload OK`);
    return json(200, { ok:true, request_id:requestId, model_url, config });
  } catch (e) {
    console.error(`[${requestId}] finalize-model-upload EXCEPTION`, e);
    return fail(
      Number(e?.statusCode || 500),
      requestId,
      'exception',
      'Finalize upload failed',
      e?.message || String(e)
    );
  }
}
