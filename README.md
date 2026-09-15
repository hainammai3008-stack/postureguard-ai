# PostureGuard AI v5

Bản này tổ chức sản phẩm thành **User** và **Super Admin**.

## User thường
- Đăng ký / đăng nhập bằng Supabase Auth.
- Theo dõi camera.
- Dashboard riêng.
- Cài đặt cá nhân: tên học sinh, email phụ huynh, ngưỡng cảnh báo âm thanh, bật/tắt báo cáo.
- Khi ngồi sai quá ngưỡng: phát cảnh báo bằng giọng nói.
- Khi kết thúc phiên: gửi một email báo cáo tổng hợp cho phụ huynh.

## Super Admin
- Đăng nhập riêng, không dùng Supabase Auth.
- Username/password đọc từ Netlify Environment Variables.
- Password được lưu dưới dạng MD5 theo yêu cầu demo.
- Chỉ Super Admin được:
  - upload model;
  - activate / rollback model version;
  - xem Model Registry;
  - kiểm tra cấu hình email hệ thống;
  - gửi email test.

## Netlify Environment Variables

```text
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_URL_PUBLIC=https://xxxx.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_MODEL_BUCKET=ai-models

GMAIL_USER=postureguard.demo@gmail.com
GMAIL_APP_PASSWORD=xxxxxxxxxxxxxxxx

SUPER_ADMIN_USERNAME=admin
SUPER_ADMIN_PASSWORD_MD5=<md5-hash>
```

Tạo MD5:

```python
import hashlib
print(hashlib.md5("Posture@123".encode()).hexdigest())
```

> MD5 chỉ phù hợp cho demo/contest, không nên dùng cho production.

## Supabase
1. Tạo project.
2. Chạy `supabase/schema.sql`.
3. Bật Email/Password Auth.
4. Với demo, có thể tắt yêu cầu xác nhận email.

## Model động
Model lưu tại:

```text
ai-models/{model_key}/{version}/
├── model.json
└── *.bin
```

Hỗ trợ:
- MobileNetV2
- ResNet50
- DenseNet121
- EfficientNet-B0

Super Admin upload/activate model mà không cần restart/redeploy.

## Deploy Netlify
Project đã có:

```text
Build command: node scripts/generate-config.mjs
Publish directory: .
Functions directory: netlify/functions
```

Sau khi thêm Environment Variables, trigger deploy lại một lần.

## Thứ tự test
1. Super Admin login.
2. Kiểm tra email hệ thống.
3. Upload model và activate.
4. Đăng ký user.
5. Bật camera.
6. Ngồi sai quá ngưỡng → nghe cảnh báo.
7. Tắt camera → nhận email báo cáo.
8. Xem Dashboard.

## Model upload v6.1 (signed direct upload)
Model files are no longer posted through a Netlify Function. The admin UI first calls `prepare-model-upload`, uploads each file directly to Supabase Storage using signed upload tokens, then calls `finalize-model-upload`. This avoids Netlify request-body limits for TensorFlow.js model shards and returns structured errors with `stage` and `request_id`.


## v6.2 - Super Admin test model bằng ảnh
- Thêm tab **🧪 Test mô hình** trong Super Admin.
- Upload ảnh từ máy và chạy inference trực tiếp bằng TensorFlow.js trên browser.
- Ảnh test không gửi lên server.
- Hiển thị model/version active, TensorFlow.js/backend, lớp dự đoán, confidence và xác suất 4 lớp.
- Dùng cùng preprocessing 224x224 RGB float32 như camera realtime; không chia 255 vì preprocessing MobileNetV2 nằm trong graph hiện tại.

## v6.4 - Repeating posture audio alerts
- Audio warning repeats every `local_alert_seconds` while bad posture continues.
- `unknown` frames no longer reset the bad-posture timer.
- Returning to stable `upright` resets the timer and alert cycle.


## v6.7 - Model được hỗ trợ

Hệ thống chỉ hỗ trợ 4 model: MobileNetV2, ResNet50, DenseNet121, EfficientNet-B0. Với DB đã triển khai bản cũ, chạy `supabase/postureguard_migrate_models_v6_7.sql`.

## v6.8 - Realtime camera pipeline
Realtime camera inference was updated to reduce jitter and improve webcam behavior:
- Center crop 90% of the square person region before inference.
- Resize cropped frame to 224x224.
- Run model on raw RGB float input (no extra /255 normalization).
- Average class probabilities across the latest 10 frames.
- Apply confidence threshold 0.50 after probability averaging.
- Run inference every 250 ms (~4 FPS).
- Uploaded-image admin test remains unchanged and uses the full uploaded image.

## v6.10 - Confidence threshold trong cấu hình hệ thống
- Super Admin có thể cấu hình `confidence_threshold` (mặc định 0.50) tại Model AI.
- Giá trị áp dụng cho cả camera realtime và chức năng test ảnh trong Admin.
- Với database đã tồn tại, chạy `supabase/postureguard_migrate_confidence_v6_10.sql` một lần.

## v6.11 - MoveNet person tracking for realtime

Realtime camera pipeline now uses MoveNet SinglePose Lightning to detect the seated student's upper-body keypoints, builds a padded square person bounding box, and crops dynamically before the active posture classifier. Pose runs every 500 ms while posture classification remains around every 250 ms. The last valid box is reused for up to 2 seconds; if pose detection is unavailable temporarily, classification falls back to the full webcam frame. A green overlay box shows the detected crop region. No database migration is required for this version.


## v6.12 Realtime quality pipeline
- Pose quality gate uses shoulder/hip keypoints before trusting realtime classification.
- Person crop is based on pose upper-body box with 18% padding and square normalization.
- 10-frame probability smoothing now uses weighted average; recent frames have higher weight.
- 3-frame hysteresis is applied before the final posture state changes.
- Pose left/right lean is used only as a weak +0.05 supporting probability signal.
- Existing system confidence threshold remains configurable by Super Admin.
- No database migration is required from v6.11.


## v6.14 Visible pose bounding box
- Pose overlay is forced above video with z-index.
- Green box: current MoveNet detection.
- Yellow box: last valid box reused within 2-second TTL.
- Red status: person not detected.
- Status badge is not mirrored, so text remains readable.


## v6.14 — Upper-body friendly pose quality
- Pose quality no longer requires hips to be visible.
- Minimum pose keypoint score reduced to 0.20; core head/shoulder score to 0.25.
- Head + at least one shoulder is enough to continue posture classification.
- Hip keypoints are optional and only used for left/right pose assist when reliable.
- Bounding box can be created from 3 reliable upper-body keypoints.
- Overlay reports `upper body detected • hip partially hidden` instead of generic low quality.


## v6.15 Beautiful Email Report
- Redesigned session report email with responsive HTML cards, progress bar and detailed posture table.
- Durations are shown in minutes + seconds instead of rounding short events to 0 minutes.
- Keeps plain-text email fallback.
