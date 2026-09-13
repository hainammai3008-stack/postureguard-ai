# PostureGuard AI v4 — Dynamic AI Model

Phiên bản này bổ sung khả năng **upload/activate model động mà không restart hoặc redeploy Netlify**.

## Kiến trúc

```text
Admin/System Config
        │
        ├── Upload model.json + *.bin
        ▼
Supabase Storage
ai-models/
├── cnn/v1/
├── cnn/v2/
├── resnet50/v1/
├── densenet121/v1/
└── efficientnetb0/v3/
        │
        ▼
model_registry
        │
        ▼
system_config
(selected_model, version, URL)
        │
        ▼
Browser
tf.loadGraphModel(model_url)
```

## Chức năng hiện có

- Supabase Auth: đăng ký/đăng nhập.
- Cấu hình riêng từng user:
  - tên học sinh
  - email phụ huynh
  - ngưỡng cảnh báo âm thanh
  - bật/tắt báo cáo email
- Model AI là cấu hình chung toàn hệ thống.
- Upload model động lên Supabase Storage.
- Activate model/version mới không redeploy.
- Browser tự `dispose()` model cũ và load model mới.
- Camera TensorFlow.js.
- Upload ảnh.
- Cảnh báo âm thanh khi ngồi sai vượt ngưỡng.
- Email phụ huynh là báo cáo tổng hợp khi kết thúc phiên.
- Dashboard theo user.

## 1. Supabase

Chạy:

```text
supabase/schema.sql
```

Schema tạo:

- `user_profiles`
- `system_config`
- `model_registry`
- `monitor_sessions`
- `posture_events`
- `alerts`
- `reports`
- Storage bucket public `ai-models`

## 2. Netlify Environment Variables

```text
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_URL_PUBLIC=https://xxxx.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_MODEL_BUCKET=ai-models
GMAIL_USER=postureguard.demo@gmail.com
GMAIL_APP_PASSWORD=xxxxxxxxxxxxxxxx
```

## 3. Upload model động

Trong web:

```text
Cấu hình hệ thống
→ Upload model mới
→ chọn loại model
→ nhập version
→ chọn model.json
→ chọn tất cả *.bin
→ Upload
```

Nếu bật **Activate ngay sau khi upload**:

1. files được upload vào Supabase Storage;
2. `model_registry` được cập nhật;
3. `system_config` trỏ sang version mới;
4. browser dispose model cũ;
5. `tf.loadGraphModel()` load model mới.

Không restart app và không redeploy Netlify.

## 4. Quy ước model

Mỗi model/version phải có:

```text
model.json
group1-shard1ofN.bin
...
```

Cả 4 model phải thống nhất:

```text
Input: 224 x 224 x 3
Output classes:
0 leaning_backward
1 leaning_left
2 leaning_right
3 upright
```

Khuyến nghị đưa preprocessing vào trong graph trước khi export để frontend luôn gửi RGB float 0..255.

## 5. Rollback

Ví dụ active hiện tại:

```text
efficientnetb0 / v3
```

Muốn rollback:

```text
Model: EfficientNet-B0
Version: v2
→ Activate model/version
```

Frontend sẽ load lại v2 ngay.

## 6. Lưu ý upload lớn

TF.js model có thể có nhiều file weights lớn. Netlify Functions có giới hạn kích thước request tùy plan/runtime.

Nếu model lớn, hướng production tốt hơn là:
- browser upload trực tiếp lên Supabase Storage bằng signed upload URL;
- Netlify Function chỉ tạo signed URL và activate version.

Bản v4 hiện tại dùng multipart upload qua Function để demo đơn giản.
