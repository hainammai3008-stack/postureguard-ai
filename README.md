# PostureGuard AI v2

Bản này mở rộng project theo 3 yêu cầu:

1. **User đăng ký / đăng nhập đơn giản** bằng Supabase Auth (email + password).
2. **Mỗi user có cấu hình riêng**:
   - tên học sinh
   - email phụ huynh
   - model AI đang dùng
   - thời gian cảnh báo tại chỗ
   - thời gian gửi email
   - bật/tắt email
3. **Chọn 1 trong 4 model**:
   - CNN
   - ResNet50
   - DenseNet121
   - EfficientNet-B0

## Kiến trúc

```text
Browser / Netlify
├── Supabase Auth
├── TensorFlow.js
│   ├── CNN
│   ├── ResNet50
│   ├── DenseNet121
│   └── EfficientNet-B0
├── Camera / Upload
└── Dashboard
       │
       └── Netlify Functions
             ├── Supabase DB
             └── Gmail -> email phụ huynh
```

## Kiến trúc v3

```text
CẤU HÌNH HỆ THỐNG
└── Chọn 1 model AI dùng chung
    ├── CNN
    ├── ResNet50
    ├── DenseNet121
    └── EfficientNet-B0

USER
├── Đăng ký / đăng nhập
├── Tên học sinh
├── Email phụ huynh
├── Ngưỡng cảnh báo âm thanh
└── Bật/tắt báo cáo email

CAMERA
↓
AI phát hiện tư thế
↓
Sai quá ngưỡng
→ cảnh báo âm thanh ngay cho học sinh
↓
Kết thúc phiên học
→ tổng hợp dữ liệu
→ gửi email báo cáo phụ huynh
```

## Email phụ huynh

Email không còn được gửi ngay khi học sinh ngồi sai quá lâu.

Thay vào đó:
- ngồi sai quá ngưỡng → **chỉ cảnh báo bằng âm thanh**;
- khi kết thúc phiên → hệ thống tính:
  - thời gian theo dõi;
  - tỷ lệ ngồi đúng;
  - tổng thời gian ngồi sai;
  - tư thế sai nhiều nhất;
  - chi tiết thời gian từng loại;
  - model AI đang sử dụng;
- sau đó gửi **một báo cáo tổng hợp** tới email phụ huynh.

## Cấu hình model

Model được lưu trong `system_config`, là cấu hình chung cho toàn hệ thống.

User không được chọn model trong phần hồ sơ cá nhân.

## Supabase

Chạy `supabase/schema.sql`.

Bảng chính:
- `user_profiles`
- `system_config`
- `monitor_sessions`
- `posture_events`
- `alerts`
- `reports`

## Netlify variables

```text
SUPABASE_URL
SUPABASE_URL_PUBLIC
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
GMAIL_USER
GMAIL_APP_PASSWORD
```

## Model files

```text
models/
├── cnn/
├── resnet50/
├── densenet121/
└── efficientnetb0/
```

Mỗi folder gồm `model.json` + `*.bin`.

## Luồng demo nên trình bày

1. Đăng nhập user.
2. Cấu hình email phụ huynh + ngưỡng cảnh báo.
3. Ở tab Cấu hình hệ thống, chọn model AI.
4. Bật camera.
5. Ngồi sai quá ngưỡng → nghe cảnh báo bằng giọng nói.
6. Tiếp tục phiên học.
7. Tắt camera.
8. Hệ thống gửi email báo cáo tổng hợp cho phụ huynh.
9. Mở Dashboard để xem lịch sử.
