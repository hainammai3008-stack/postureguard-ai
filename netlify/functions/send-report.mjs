import nodemailer from 'nodemailer';
import { requireUser, json, parseBody, isUuid } from './_shared.mjs';

const DISPLAY = {
  leaning_left: 'Nghiêng trái',
  leaning_right: 'Nghiêng phải',
  leaning_backward: 'Ngả về sau',
  leaning_forward: 'Nghiêng về trước',
  upright: 'Tư thế đúng'
};

const MODEL_DISPLAY = {
  mobilenetv2: 'MobileNetV2',
  resnet50: 'ResNet50',
  densenet121: 'DenseNet121',
  efficientnetb0: 'EfficientNet-B0'
};

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds || 0)));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  if (minutes <= 0) return `${secs} giây`;
  if (secs === 0) return `${minutes} phút`;
  return `${minutes} phút ${secs} giây`;
}

function postureRows(by) {
  const order = ['leaning_left', 'leaning_right', 'leaning_backward', 'leaning_forward'];
  return order.map((key) => ({
    key,
    label: DISPLAY[key],
    seconds: Number(by[key] || 0)
  }));
}

function buildHtmlReport({ studentName, monitored, bad, correctPct, worst, by, modelKey }) {
  const safeStudent = escapeHtml(studentName || 'Học sinh');
  const safeModel = escapeHtml(MODEL_DISPLAY[modelKey] || modelKey || '—');
  const rows = postureRows(by);
  const correct = Math.max(0, Math.min(100, Number(correctPct || 0)));
  const statusLabel = correct >= 90 ? 'Rất tốt' : correct >= 75 ? 'Khá tốt' : 'Cần chú ý';
  const statusBg = correct >= 90 ? '#e8f7ef' : correct >= 75 ? '#eef4ff' : '#fff4e5';
  const statusColor = correct >= 90 ? '#117a49' : correct >= 75 ? '#2457b8' : '#9a5a00';
  const worstLabel = worst ? `${DISPLAY[worst[0]] || worst[0]} · ${formatDuration(worst[1])}` : 'Không ghi nhận';

  const detailRows = rows.map((r) => `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid #edf1f7;color:#475569;font-size:14px;">${escapeHtml(r.label)}</td>
      <td style="padding:12px 0;border-bottom:1px solid #edf1f7;color:#0f172a;font-size:14px;font-weight:700;text-align:right;">${formatDuration(r.seconds)}</td>
    </tr>`).join('');

  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>PostureGuard AI</title>
</head>
<body style="margin:0;padding:0;background:#f3f6fb;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f3f6fb;padding:28px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:640px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 8px 28px rgba(15,23,42,.08);">
          <tr>
            <td style="padding:26px 30px;background:linear-gradient(135deg,#17345f,#2457b8);color:#ffffff;">
              <div style="font-size:13px;font-weight:700;letter-spacing:.9px;opacity:.82;">POSTUREGUARD AI</div>
              <div style="font-size:26px;font-weight:800;margin-top:8px;line-height:1.25;">Báo cáo tư thế ngồi học</div>
              <div style="font-size:14px;opacity:.85;margin-top:8px;">Tóm tắt phiên theo dõi của ${safeStudent}</div>
            </td>
          </tr>

          <tr>
            <td style="padding:26px 30px 8px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td width="50%" valign="top" style="padding-right:7px;">
                    <div style="background:#f7f9fc;border:1px solid #e8edf5;border-radius:14px;padding:16px;">
                      <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.4px;">Thời gian theo dõi</div>
                      <div style="font-size:20px;font-weight:800;margin-top:6px;">${formatDuration(monitored)}</div>
                    </div>
                  </td>
                  <td width="50%" valign="top" style="padding-left:7px;">
                    <div style="background:${statusBg};border-radius:14px;padding:16px;">
                      <div style="font-size:12px;color:${statusColor};text-transform:uppercase;letter-spacing:.4px;">Tỷ lệ ngồi đúng</div>
                      <div style="font-size:26px;font-weight:800;color:${statusColor};margin-top:4px;">${correct.toFixed(1)}%</div>
                      <div style="font-size:12px;font-weight:700;color:${statusColor};margin-top:3px;">${statusLabel}</div>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:14px 30px 0;">
              <div style="font-size:13px;font-weight:700;color:#334155;margin-bottom:8px;">Mức độ duy trì tư thế đúng</div>
              <div style="height:10px;background:#e9eef6;border-radius:999px;overflow:hidden;">
                <div style="height:10px;width:${correct.toFixed(1)}%;background:#3b82f6;border-radius:999px;"></div>
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:24px 30px 0;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f8fafc;border:1px solid #e7ecf3;border-radius:14px;">
                <tr>
                  <td style="padding:16px 18px;">
                    <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.4px;">Tổng thời gian tư thế chưa đúng</div>
                    <div style="font-size:18px;font-weight:800;margin-top:5px;">${formatDuration(bad)}</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 18px 16px;">
                    <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.4px;">Tư thế cần chú ý nhất</div>
                    <div style="font-size:16px;font-weight:700;margin-top:5px;">${escapeHtml(worstLabel)}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:26px 30px 0;">
              <div style="font-size:17px;font-weight:800;margin-bottom:6px;">Chi tiết tư thế</div>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                ${detailRows}
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:24px 30px 0;">
              <div style="background:#eef4ff;border-radius:12px;padding:14px 16px;font-size:13px;color:#34517d;line-height:1.6;">
                <strong>Mô hình AI:</strong> ${safeModel}<br>
                Kết quả được tổng hợp từ các sự kiện tư thế trong phiên và dùng để hỗ trợ hình thành thói quen ngồi học tốt hơn.
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:24px 30px 28px;">
              <div style="border-top:1px solid #edf1f7;padding-top:18px;color:#64748b;font-size:12px;line-height:1.6;">
                🔒 PostureGuard AI không lưu hình ảnh camera và không nhận diện danh tính.<br>
                Báo cáo này được gửi tự động sau khi kết thúc phiên theo dõi.
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function handler(event) {
  try {
    const { user, db } = await requireUser(event);
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

    const b = parseBody(event);
    if (!isUuid(b.session_id || '')) return json(400, { error: 'session_id không hợp lệ' });

    const { data: profile, error: pe } = await db.from('user_profiles').select('*').eq('user_id', user.id).single();
    if (pe) throw pe;
    if (!profile.email_enabled) return json(200, { ok: true, skipped: true });
    if (!profile.parent_email?.includes('@')) return json(400, { error: 'Chưa cấu hình email phụ huynh' });

    const { data: session, error: se } = await db.from('monitor_sessions').select('*').eq('id', b.session_id).eq('user_id', user.id).single();
    if (se) throw se;

    const { data: events, error: ee } = await db.from('posture_events').select('posture,duration_seconds').eq('session_id', b.session_id).eq('user_id', user.id);
    if (ee) throw ee;

    const monitored = Math.max(1, Math.round((new Date(session.ended_at || new Date()) - new Date(session.started_at)) / 1000));
    let bad = 0;
    const by = {};

    for (const e of events || []) {
      const d = Number(e.duration_seconds || 0);
      if (e.posture !== 'upright') {
        bad += d;
        by[e.posture] = (by[e.posture] || 0) + d;
      }
    }

    const correctPct = Math.max(0, Math.min(100, ((monitored - bad) / monitored) * 100));
    const worst = Object.entries(by).sort((a, b) => b[1] - a[1])[0];
    const sender = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_APP_PASSWORD;

    if (!sender || !pass) throw new Error('Thiếu GMAIL_USER/GMAIL_APP_PASSWORD trên Netlify');

    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: sender, pass } });
    const studentName = profile.student_name || 'Học sinh';
    const details = postureRows(by);

    const lines = [
      'POSTUREGUARD AI - BÁO CÁO TƯ THẾ NGỒI HỌC',
      '',
      `Học sinh: ${studentName}`,
      `Thời gian theo dõi: ${formatDuration(monitored)}`,
      `Tỷ lệ ngồi đúng: ${correctPct.toFixed(1)}%`,
      `Thời gian tư thế chưa đúng: ${formatDuration(bad)}`,
      `Tư thế cần chú ý nhất: ${worst ? `${DISPLAY[worst[0]] || worst[0]} (${formatDuration(worst[1])})` : 'Không ghi nhận'}`,
      '',
      'Chi tiết:',
      ...details.map((r) => `- ${r.label}: ${formatDuration(r.seconds)}`),
      '',
      `Model AI: ${MODEL_DISPLAY[session.model_key] || session.model_key}`,
      '',
      'PostureGuard AI không lưu hình ảnh camera và không nhận diện danh tính.'
    ];

    const html = buildHtmlReport({
      studentName,
      monitored,
      bad,
      correctPct,
      worst,
      by,
      modelKey: session.model_key
    });

    await transporter.sendMail({
      from: `PostureGuard AI <${sender}>`,
      to: profile.parent_email,
      subject: `[PostureGuard AI] Báo cáo tư thế - ${studentName}`,
      text: lines.join('\n'),
      html
    });

    await db.from('reports').insert({
      user_id: user.id,
      session_id: session.id,
      recipient: profile.parent_email,
      monitored_seconds: monitored,
      bad_seconds: bad,
      correct_percent: correctPct,
      model_key: session.model_key || 'mobilenetv2'
    });

    return json(200, { ok: true });
  } catch (e) {
    return json(e.statusCode || 500, { error: e.message });
  }
}
