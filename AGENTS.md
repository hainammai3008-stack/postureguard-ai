# PostureGuard AI — hướng dẫn tiếp tục dự án

Đọc docs/PROJECT_CONTEXT.md trước khi làm việc để nắm yêu cầu, quyết định và trạng thái đã xác minh. Đọc README.md và source liên quan để kiểm tra trạng thái hiện tại; tài liệu ngữ cảnh không thay thế source.

- Trao đổi với người dùng bằng tiếng Việt.
- Làm trên repository hiện tại; không dùng thư mục bản tóm tắt projectless cũ làm source.
- Giữ quyết định hiện hành trừ khi người dùng đổi yêu cầu: bốn mô hình, confidence mặc định 0.50 có cấu hình, trung bình xác suất 10 frame và cảnh báo tiếng Anh lặp theo cấu hình.
- Phân biệt yêu cầu, mô tả lịch sử và hành vi đã kiểm chứng. Kiểm tra database trước khi áp dụng migration.
- Kiểm tra git status và bảo toàn thay đổi local. Không tự áp lại stash upload cũ vì đã bị thay thế bởi luồng signed upload.
- Sau thay đổi đáng kể, cập nhật docs/PROJECT_CONTEXT.md về quyết định, kiểm thử, trạng thái migration/deploy và việc còn lại để tiếp tục trên máy khác.
- Không đưa credentials, .env, token hoặc cookie vào git. Không suy ra đăng nhập Supabase của máy trước có sẵn trên máy mới.
