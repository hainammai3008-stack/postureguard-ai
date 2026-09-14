import crypto from 'crypto';
import { json } from './_shared.mjs';

export async function handler(event) {
  const requestId = crypto.randomUUID();
  console.warn(`[${requestId}] deprecated upload-model endpoint called`, {
    method:event.httpMethod,
    contentLength:event.headers?.['content-length'] || null,
    isBase64Encoded:event.isBase64Encoded
  });
  return json(410, {
    ok:false,
    request_id:requestId,
    stage:'deprecated_endpoint',
    error:'Endpoint upload-model cũ đã được thay thế',
    detail:'Frontend mới dùng prepare-model-upload -> upload trực tiếp Supabase -> finalize-model-upload để tránh giới hạn body của Netlify.'
  });
}
