# GEMINI.md

## Quy tắc thiết kế UI/UX & Phát triển dự án

### 1. QUY TẮC BẮT BUỘC VỀ ICON / EMOJI:
- **TUYỆT ĐỐI KHÔNG ĐƯỢC TỰ Ý THÊM ICON HOẶC EMOJI VÀO GIAO DIỆN (UI).**
- Không tự tiện chèn các emoji (ví dụ: 🎵, 📁, ✏️, 🛡️, 🔍, 📊, 🎲, 🧪, 🚧, 📂,...) hay biểu tượng trang trí vào text, tiêu đề, nút bấm, nhãn, bảng biểu hay thẻ thông tin.
- Chỉ thêm icon khi người dùng yêu cầu cụ thể rõ ràng.
- Giao diện phải luôn giữ phong cách tối giản, chuyên nghiệp, gọn gàng và sử dụng text tiếng Việt rõ ràng thay vì dùng icon/emoji.

### 2. QUY TẮC CODE VÀ IPC:
- Giữ nguyên các hợp đồng IPC và type contracts giữa `electron/`, `backend/`, và `src/`.
- Logic xuất audio và thời lượng nhạc mang tính cốt lõi, không tự ý thay đổi trừ khi được yêu cầu.
- Luôn kiểm thử TypeScript build (`npm run build`) và unit test trước khi hoàn thành công việc.

### 3. QUY TẮC HANDOFF:
- Cập nhật [HANDOFF.md](HANDOFF.md) sau mỗi lần cập nhật/sửa đổi tính năng.

