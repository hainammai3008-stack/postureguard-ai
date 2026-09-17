# Ngữ cảnh dự án PostureGuard AI

## Cập nhật ứng dụng 5 nhãn — 2026-09-17

- Đã `git fetch origin main`: trước khi cập nhật, remote ở `e3a6ff7`, không có commit mới hơn. Hai commit `59e39d2` (dataset/notebook) và `714f72a` (ứng dụng 5 nhãn) đã push qua GitHub Desktop; `git ls-remote` xác nhận remote main ở `714f72a`. Giữ nguyên các tệp local `colab/models/` và poster chưa được theo dõi.
- Model SavedModel local `colab/models/posture_saved_model.zip` chứa `class_names.json` với thứ tự `leaning_backward`, `leaning_forward`, `leaning_left`, `leaning_right`, `upright`.
- `app.js` v6.16.0 nhận cả output 4 lớp cũ và 5 lớp mới theo đúng thứ tự; thêm nhãn tiếng Việt, cảnh báo tiếng Anh, test ảnh Admin và biểu đồ cho `leaning_forward`. Backend event/email/report và `index.html` đã cập nhật.
- Đã kiểm tra database production Supabase bằng SELECT: `posture_events_posture_check` cũ chỉ có bốn nhãn. Đã chạy `supabase/postureguard_migrate_forward_v6_16.sql` qua SQL Editor, sau đó SELECT xác nhận constraint `posture_events_posture_five_classes_check` có đủ năm nhãn. Chưa deploy ứng dụng hoặc activate model 5 lớp.
- Kiểm thử local: `node --check` các file JS/MJS liên quan đạt; smoke test mapping output 4/5 lớp và lỗi số lớp khác đạt. Chưa chạy camera/browser end-to-end với GraphModel TensorFlow.js.

## Cập nhật dataset chuẩn — 2026-09-17

- Quyết định mới nhất của người dùng: bộ dataset chuẩn có 5 nhãn `leaning_backward`, `leaning_forward`, `leaning_left`, `leaning_right`, `upright`; bỏ `head_down` vì sáu ZIP hiện có không có nhãn này.
- Bộ 5 lớp `colab/posture_dataset_standard_5class.zip` được tạo từ nguồn multiclass v5 (gộp ba split gốc rồi chia lại theo nhóm frame). Train 3.035 ảnh; val/test mỗi tập 400 ảnh, 80 ảnh/lớp. Loại 183 ảnh do frame gốc có nhãn mâu thuẫn.
- Chưa sửa model/app hiện đang dùng 4 lớp để nhận `leaning_forward`; chưa train lại. Tất cả notebook cần cùng thứ tự nhãn 5 lớp và cùng split trước khi benchmark mới.
- Bốn notebook Colab đã cập nhật để upload `posture_dataset_standard_5class.zip`, dùng cùng split cố định và nhãn theo đúng thứ tự; MobileNetV2 không còn tự chia dữ liệu; EfficientNet-B0 sửa từ code B1; gói SavedModel thêm `class_names.json`. Đã kiểm tra cấu trúc notebook và cú pháp các ô Python, chưa chạy train trên Colab/GPU.
- Để đồng bộ GitHub, ZIP chuẩn 5 lớp được chia thành bốn phần dưới 40 MiB trong `colab/dataset_parts/`, có manifest SHA-256. Chạy `python3 scripts/assemble_standard_5class_dataset.py` sau khi clone để khôi phục ZIP. Source ZIP Roboflow gốc vẫn là tệp local, không đưa lên Git.

- Sáu ZIP nguồn hiện ở `colab/dataset/`; là file local chưa commit. Không đưa ZIP/dataset lớn vào Git.
- Đã tạo `scripts/build_standard_dataset.py` và bộ `colab/posture_dataset_standard/` từ nguồn multiclass v5. Split gốc của nguồn này thiếu lớp ở val/test, nên chỉ lấy phần train có đủ bốn nhãn rồi chia lại theo nhóm frame.
- Kết quả: train 1.954 ảnh (backward 296, left 377, right 510, upright 771); val 320 và test 320, mỗi lớp 80 ảnh. 102 ảnh bị loại do cùng frame gốc có nhãn mâu thuẫn. Có manifest nguồn/hash và báo cáo JSON.
- Các ZIP COCO/binary/nhãn khác không được ép thành bốn lớp. Xem `colab/DATASET_STANDARD.md` về cách dùng và giới hạn dữ liệu.
- Đã xem contact sheet mẫu. Chưa train lại bốn mô hình, chưa đánh giá trên bộ test mới. Chưa kiểm chứng khả năng tổng quát hóa trên người mới vì thiếu ID người/video gốc.

Dự án AI nhận diện tư thế ngồi qua webcam, có quản trị mô hình và cảnh báo âm thanh.

## Nguồn ngữ cảnh

- Cuộc trò chuyện ChatGPT: Phát triển AI tư thế ngồi.
- ID: 6aa26782-4a8c-83ec-9e52-792a225c6a4e.
- Dự án ChatGPT gốc: Posture Guard AI - Hưng Nam Đạt.
- Ngày chuyển ngữ cảnh: 2026-09-15.
- Tóm tắt này dựa trên các trao đổi gần nhất đã đọc, không phải bản xuất toàn bộ lịch sử.

## Kiến trúc đã thống nhất

- Frontend triển khai trên Netlify; Netlify Functions xử lý các tác vụ backend.
- Supabase lưu dữ liệu, cấu hình, model registry và tệp mô hình trong Storage.
- TensorFlow.js chạy suy luận tại trình duyệt; ảnh camera và ảnh test không gửi lên server theo thiết kế đã trao đổi.
- Model Keras được export SavedModel rồi chuyển thành TensorFlow.js GraphModel: model.json cùng các shard .bin.
- Phiên bản TensorFlow.js được nhắc trong lịch sử: 4.22.0, đã xác nhận trong index.html ngày 2026-09-15.

## Các quyết định hiện hành

### Mô hình và nhãn

Chỉ hỗ trợ MobileNetV2, ResNet50, DenseNet121, EfficientNet-B0. Đã yêu cầu loại lựa chọn CNN cũ.

Năm nhãn tư thế mới: leaning_backward, leaning_forward, leaning_left, leaning_right, upright. Model cũ bốn nhãn vẫn được hỗ trợ theo thứ tự leaning_backward, leaning_left, leaning_right, upright. unknown là trạng thái dưới ngưỡng tin cậy, không phải lớp học. Thứ tự đầu ra phải đối chiếu metadata của từng model.

### Camera realtime

Webcam → crop vuông vùng trung tâm khoảng 90% → resize 224×224 → model → probabilities → trung bình xác suất 10 frame gần nhất → ngưỡng confidence → tư thế cuối.

- Tần suất khoảng 250 ms/lần, tức 4 lần/giây.
- Ngưỡng hiện hành: 0.50, thay thế đề xuất 0.65 trước đó.
- Confidence >= ngưỡng: nhận tư thế; dưới ngưỡng: unknown.
- Không chia thêm /255 đối với MobileNetV2 hiện tại vì preprocessing được mô tả là đã nằm trong graph. Phải kiểm tra riêng từng model khi có source/model thực.
- Vấn đề được báo cáo: MobileNetV2 nhận ảnh upload khá tốt nhưng camera realtime kém hơn.

### Super Admin

- Quản lý model/version và chọn model Active.
- Upload model: trình duyệt xin signed upload token qua Netlify, tải từng tệp trực tiếp lên Supabase Storage, rồi gọi finalize.
- Các function được nhắc: prepare-model-upload.mjs, finalize-model-upload.mjs.
- Hiển thị tiến độ upload và lỗi với HTTP status, stage, request_id, detail.
- Tab Test mô hình: upload và preview ảnh, detect bằng model Active, hiển thị model/version, backend/version TensorFlow.js, nhãn, confidence và xác suất bốn lớp; có nút tải lại model Active.
- Ảnh test resize 224×224, không crop như camera.
- Ngưỡng confidence được đưa vào Cấu hình hệ thống / Model AI, mặc định 0.50 và dùng chung camera cùng test ảnh.

### Cảnh báo âm thanh

- Có nút Test âm thanh trong cài đặt cá nhân.
- Dùng giọng tiếng Anh en-US/en-GB, các câu đã chọn:
  - Please sit straight. You are leaning left.
  - Please sit straight. You are leaning right.
  - Please sit straight. You are leaning backward.
  - Please sit straight. You are leaning forward.
- Sai tư thế quá thời gian cấu hình thì cảnh báo, tiếp tục sai thì lặp theo thời gian đó; ví dụ mỗi 10 giây.
- unknown xen kẽ không reset timer; upright ổn định reset chu kỳ.
- Ghi alert-log mỗi lần cảnh báo.

## Source chính và trạng thái đã xác minh — 2026-09-15

- Repository: https://github.com/hainammai3008-stack/postureguard-ai
- Nhánh chính: main.
- Commit ứng dụng đã pull: d99f417 — system confidence.
- app.js khai báo APP_VERSION=6.10.0; package.json vẫn ghi 5.0.0, nên không suy ra phiên bản tính năng chỉ từ package.json.
- Dự án sidebar Codex: postureguard-ai. Trên máy hiện tại, thư mục source là /Users/huymq85/private/postureguard-ai/projects/postureguard-ai. Máy khác có thể dùng đường dẫn khác.
- Đã kiểm tra source: bốn model, confidence mặc định 0.50, trung bình 10 frame, khoảng cách 250 ms, crop 0.90, các câu cảnh báo tiếng Anh và luồng prepare/upload/finalize đều có trong code.
- Khi pull bằng --ff-only --autostash, hai file app.js và netlify/functions/upload-model.mjs bị conflict với phần sửa upload local cũ. Đã giữ phiên bản mới từ GitHub vì luồng multipart cũ đã được thay thế.
- Bản sửa local cũ còn trong stash ở máy này: 687a0a7 (được hiển thị là stash@{0} khi xử lý). Stash KHÔNG được push lên GitHub. Không tự pop vì sẽ đưa luồng upload cũ trở lại; xác minh bằng git stash list trước khi tham chiếu vị trí stash.
- Kiểm tra node --check app.js và node --check netlify/functions/upload-model.mjs đã đạt sau pull. Chưa chạy kiểm thử camera/browser hoặc deploy trong phiên này.

## Supabase đã kết nối và kiểm tra

- Dashboard: https://supabase.com/dashboard/project/rerilknktawamkjqedig
- Project ref: rerilknktawamkjqedig; tên postureguard-ai; nhánh main.
- Người dùng đã tự đăng nhập Supabase qua trình duyệt trong Codex. Đây là phiên đăng nhập của máy hiện tại, không phải credential đã lưu trong repo, CLI hay MCP.
- Ngày 2026-09-15, truy vấn chỉ đọc trong SQL Editor xác nhận:
  - system_config.confidence_threshold tồn tại, numeric, NOT NULL, default 0.500.
  - Có CHECK confidence_threshold > 0 AND confidence_threshold <= 1.
  - system_config.selected_model và model_registry.model_key có constraint chỉ chấp nhận mobilenetv2, resnet50, densenet121, efficientnetb0.
  - selected_model mặc định mobilenetv2; model_key ở monitor_sessions, posture_events, alerts, reports cũng mặc định mobilenetv2.
- Vì vậy phần schema của hai migration sau đã hiện diện; không chạy lại chỉ vì lịch sử chat trước nói cần chạy:
  - supabase/postureguard_migrate_models_v6_7.sql
  - supabase/postureguard_migrate_confidence_v6_10.sql
- Chưa kiểm tra giá trị cấu hình đang lưu trong từng row, model Active thực tế, toàn bộ dữ liệu legacy hoặc toàn bộ schema. Default 0.500 không đồng nghĩa row đang dùng chắc chắn là 0.500.
- Trang tổng quan hiển thị No migrations nhưng có bảng app_migrations; không dùng dòng tổng quan để kết luận SQL thủ công chưa được áp dụng.
- Dashboard hiển thị cảnh báo RLS chưa bật trên public.app_migrations. Chưa sửa vấn đề này; cần xem quyền truy cập và cách bảng được dùng trước khi thay đổi.
- Trong phiên này chỉ chạy SELECT, chưa ALTER/UPDATE/DELETE trên Supabase.

## Điểm cần lưu ý khi phát triển tiếp

- Yêu cầu trong chat nói reset cảnh báo khi upright ổn định. Source hiện tại reset ngay khi nhãn cuối sau smoothing là upright, chưa thấy bộ đếm riêng yêu cầu upright liên tục vài giây. Không mô tả đó là cơ chế đã được kiểm chứng.
- index.html còn dòng hướng dẫn test ảnh ghi ngưỡng 65%, trong khi code mặc định 50% và ngưỡng có thể cấu hình. Đây là chênh lệch nội dung UI đã phát hiện, chưa sửa trong tác vụ lưu ngữ cảnh.
- Preprocessing không /255 đã có trong source, nhưng việc mọi model đều nhúng đúng preprocessing chưa được kiểm chứng bằng artifact model thực tế.
- Nếu tiếp tục xử lý chất lượng realtime: so sánh cùng một frame webcam qua hai luồng, kiểm tra probabilities/preprocessing trước khi kết luận phải train lại. Capture frame và hiển thị xác suất realtime từng được đề xuất, chưa coi là tính năng đã triển khai.
- Hướng train/export đã thảo luận: train trên Colab, export .keras sang SavedModel, tải ZIP về Mac để convert GraphModel; môi trường convert riêng Python 3.11, TensorFlow 2.16.1, tensorflowjs 4.22.0, numpy 1.26.4 và setuptools<81 từng được hướng dẫn. Đây là lịch sử xử lý tương thích, không phải môi trường đã kiểm tra trên máy mới.
- User thường: Supabase Auth, dashboard, cài đặt học sinh/email phụ huynh/ngưỡng cảnh báo, phiên camera và báo cáo khi kết thúc phiên. Super Admin đăng nhập riêng qua backend. README hiện mô tả mật khẩu MD5 cho demo; chưa thay đổi auth trong phiên này.
- Chưa biết URL site Netlify hoặc xác nhận commit mới nhất đã deploy. Supabase và source local được kiểm tra riêng, không suy ra môi trường production đã đồng bộ.

## Quy trình làm việc trên nhiều máy

1. Clone repo trên máy mới, thêm đúng thư mục vào project Codex và đọc AGENTS.md cùng tài liệu này.
2. Trước khi làm, kiểm tra git status và pull thay đổi mới; bảo toàn các thay đổi chưa commit.
3. Sau công việc, cập nhật tài liệu về quyết định mới, kiểm thử, migration thực sự đã áp dụng và việc còn lại; commit/push để máy khác nhận được.
4. Ngữ cảnh trong repo là bản bàn giao được duy trì, không phải tự động đồng bộ nguyên văn mọi cuộc trò chuyện Codex.
5. Thiết lập dependencies, biến môi trường và đăng nhập dịch vụ riêng trên từng máy. Không commit .env, mật khẩu, service-role key, token hoặc cookie.
6. Có thể dùng Remote/Handoff nếu các máy đã kết nối và hỗ trợ; tác vụ hiện tại chưa thiết lập kết nối nhiều máy.

## Phạm vi và ưu tiên

Người dùng trao đổi bằng tiếng Việt; tiếng Anh là lựa chọn riêng cho âm thanh cảnh báo. Người dùng muốn làm trực tiếp trên repo chính, giữ ngữ cảnh trong repo và đồng bộ qua GitHub.

Tài liệu này tổng hợp toàn bộ ngữ cảnh dự án hiện đã biết từ cuộc trao đổi hiện tại, các lượt gần nhất đã đọc trong chat gốc và kiểm tra source/database. Không phải bản xuất nguyên văn toàn bộ chat gốc hoặc tệp đính kèm. Các đường dẫn ZIP từng có trong chat không đồng nghĩa các tệp đó hiện có tại workspace.

Chưa có yêu cầu phát triển tính năng tiếp theo. Không tự dựng lại ứng dụng, chạy migration, thay đổi auth hoặc deploy chỉ từ danh sách vấn đề ở trên.
