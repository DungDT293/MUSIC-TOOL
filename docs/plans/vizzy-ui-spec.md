# Vizzy editor — số đo bóc tách từ trang thật

Nguồn: `https://vizzy.io/editor?project=P50QtonsBCSY1eo76ZXVd`, đo bằng CDP ở viewport 1920×897.
Trang là SPA; đo được cả khi **chưa đăng nhập** (project mở công khai).

## Vùng chính

| Vùng | Toạ độ (x, y, w, h) | Nền | Bo góc | Ghi chú |
|---|---|---|---|---|
| Header | 8, 8, 1904, 32 | `#131313` | 8px | menu File/Edit/Project/View/Help + Donate + Release + Sign in |
| Cột trái (rail + Composition) | 9, 49, 520, 582 | `#131313` | 3px dưới | rail icon 60px + panel cây lớp |
| Canvas preview | 556, 58, 962, 533 | trong suốt | — | tỷ lệ 16:9, căn giữa vùng giữa |
| Panel phải (Objects/Visualizer) | ~1543, 58, 360, 582 | `#131313` | 3px | tab + preset + accordion |
| Timeline | 23, 737, 1874, 143 | trong suốt | — | waveform + track + transport |

## Preset grid

- Thumbnail **38×38 px**, bo tròn, **6 cột**, tổng **48 preset** trong bản của họ.
- Không có nhãn chữ dưới thumbnail — chỉ tooltip.
- Bên dưới là nút mở rộng và các section accordion (Spectrum layers, General, Positioning & Size, Basics).

## Timeline

- Thanh transport nằm trong timeline, không nằm dưới canvas.
- Trái: zoom (- / Zoom: 1 / +), timecode `00:00.00 / 03:04.32`.
- Giữa: nút ⏮ ⏪ ▶ ⏩ ⏭.
- Phải: tên file audio + nút "Choose audio" + volume slider.
- Waveform cao ~60px (dải xanh), bên dưới là các track ~20px, header track có icon + tên.

## Màu & font

- Nền panel `#131313`, chữ chính `#ffffff` / `#eeeeee`, chữ phụ `rgba(255,255,255,0.7)`.
- Accent: `#6200ee` (tím) và `#8bc34a` (xanh lá) cho trạng thái.
- Font: **Source Sans Pro 13.2px/400** cho gần như toàn bộ UI (12px, 14.4px cho phụ).

## Đã áp vào app của mình

- Preset grid đổi sang **6 cột, ô vuông** (trước là 2 cột ảnh lớn).
- Timeline có **zoom +/-**, timecode, transport giữa, tên file bên phải.
- Tab Objects/Visualizer giữ nguyên, preset nằm trong tab Visualizer.

## Chưa áp (cần làm tiếp)

- Rail icon + nhãn dọc (đang là nút chữ).
- Section accordion trong panel phải (đang là các khối phẳng).
- Track header có icon, cột tên cố định 132px (đã có) + ruler thời gian phía trên waveform.
- Palette `#131313` + Source Sans Pro (app đang dùng nền `#0b1220`, font Inter/system).
