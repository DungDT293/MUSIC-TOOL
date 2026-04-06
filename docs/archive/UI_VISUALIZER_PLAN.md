# Kế hoạch UI Visualizer (theo góp ý mới)

## Mục tiêu
- Đặt preview làm trung tâm, giảm nhiễu (ẩn CPU/GPU/Disk/Key khi chỉnh visualizer).
- Rõ ràng Category vs Preset: loại visualizer ở hàng nút; preset nằm trong tab Preset/Template.
- Chuẩn hóa tab Layers/Audio Reaction/Preset/Export, Việt hóa và thống nhất màu nhấn.

## Work items
1) Ưu tiên preview
   - Ẩn/không render TopBarStats ở `/music/visualizer` (hoặc đưa xuống status/debug).
   - Preview: overlay “Nhấn ▶ để xem preview” (paused) / “Đang tải visualizer…” (loading); badge preset + trạng thái Play/Pause.
   - Player đặt ngay dưới preview (cùng cột).

2) Category vs Preset
   - Hàng nút trên cùng = “Loại visualizer”.
   - Tab Preset/Template chứa preset visualizer (thumbnail/mô tả), không để preset trong tab Layers.
   - Chọn preset → tự set visualizerType phù hợp + áp config.

3) Tab Layers
   - Chỉ 2 khối:
     - Layer list (Background, Visualizer, Logo, Text…): icon + tên + 👁 + 🔒; chuẩn bị hỗ trợ reorder.
     - Thuộc tính layer chọn: Transform (X/Y %, Scale x, Rotation °), Appearance (Opacity %, Hòa trộn). Nút Reset Transform/Appearance.
   - Blend đặt trong “Nâng cao”.

4) Tab Audio Reaction (rút gọn khả thi)
   - Bass/Mid/Treble gain (0.5–2.5), Smoothing (0.3–0.95), Attack/Release preset (Nhanh/Thường/Mượt).
   - Quick mappings mô tả: Bass→Bars, Mid→Glow/Opacity, Treble→Hue/Opacity Particles.
   - Việt hóa: “Phản ứng theo nhạc”, “Nguồn”, “Cường độ”, “Vào/Nhả”.

5) Tab Preset/Template
   - Mẫu visualizer hiển thị tại đây (áp dụng theo loại hiện chọn).
   - Template JSON: Xuất/Tải + info tên, updatedAt.

6) Tab Export
   - Preset 720p30/1080p60/4K30, aspect 16:9/9:16/1:1, summary WxH@FPS.
   - Việt hóa hoàn toàn, gợi ý bitrate H.264.

7) Việt hóa & Accent
   - Chọn một accent (đề xuất #2563eb) cho tab/preset/button chính.
   - Nhãn: “Mẫu visualizer”, “Chế độ hòa trộn”, “Làm sáng”, “Thanh vòng tròn (mới)”.
   - Slider có min/max, đơn vị (x, °, %, Mbps), ô nhập số.

8) Điều khiển gọn (accordion)
   - VisualizerControls: nhóm “Cơ bản” (màu/số thanh), “Chuyển động” (độ nhạy/smoothing), “Hiệu ứng” (gradient/glow/mirror); mặc định mở Cơ bản.

## Lưu ý triển khai
- Không thay đổi logic render audio; chỉ refactor UI/label/layout.
- Giữ tương thích mã hiện tại; preset Circular Bars vẫn dùng hook/config có sẵn.













