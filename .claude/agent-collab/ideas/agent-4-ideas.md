# Agent 4 — Ý tưởng nâng cấp wave styles

## Wave styles phụ trách
beatbars, helix, aurora, heartbeat, starburst, matrix, spectrum3d

---

## 1. beatbars.ts — Nâng cấp

**Hiện trạng**: Horizontal bars từ dưới lên, reflection, beat sweep.
**Nâng cấp**:
- Thêm peak hold indicator (thanh sáng nhỏ ở đỉnh, rơi chậm theo gravity)
- Thêm bass sub-bass section riêng (2-3 thanh rộng hơn ở bên trái cho bass)
- Thêm stereo separation hiệu ứng — bars bên trái và phải reactive khác nhau
- Cải thiện reflection: thêm ripple effect trên mặt phản chiếu

## 2. helix.ts — Nâng cấp

**Hiện trạng**: DNA double helix, 3D depth, connecting rungs.
**Nâng cấp**:
- Thêm phosphorescence effect — glow trail khi helix xoay
- Thêm enzyme particles nhỏ chạy dọc theo strand, tốc độ theo beat
- Smooth out strands bằng Catmull-Rom spline thay vì lineTo
- Thêm depth fog — nodes xa mờ dần tạo chiều sâu thực tế hơn

## 3. aurora.ts — Nâng cấp

**Hiện trạng**: 5 ribbon curtains, multi-frequency sway.
**Nâng cấp**:
- Thêm vertical light rays (cột sáng dọc) phía sau ribbons
- Thêm star field background — các ngôi sao nhỏ nhấp nháy phía sau aurora
- Cải thiện ribbon: thêm sub-ribbons nhỏ hơn tách ra từ ribbon chính khi treble cao
- Thêm ground reflection — aurora phản chiếu mờ ở dưới

## 4. heartbeat.ts — Nâng cấp

**Hiện trạng**: ECG scanning cursor, QRS complex, grid paper.
**Nâng cấp**:
- Thêm BPM counter display — text hiển thị nhịp tim ước tính từ beat detection
- Thêm multi-lead ECG — 2-3 dòng ECG song song (Lead I, II, III)
- Thêm heart shape pulse animation — hình trái tim nhịp đập tại vị trí cursor
- Cải thiện grid: thêm major/minor grid lines giống giấy ECG thật

## 5. starburst.ts — Nâng cấp

**Hiện trạng**: Radiating rays, central glow, beat halo.
**Nâng cấp**:
- Thêm secondary burst ring — vòng thứ 2 lệch phase
- Thêm particle trails — hạt sáng bay ra theo ray khi beat mạnh
- Thêm lens flare effect tại tâm
- Thêm rotating outer ring với spectrum bars nhỏ

## 6. matrix.ts — Nâng cấp

**Hiện trạng**: 30 columns falling chars, head white, flickering.
**Nâng cấp**:
- Thêm depth layers — columns ở background nhỏ hơn và mờ hơn
- Thêm "awakening" effect — khi beat mạnh, chars biến thành spectrum bars tạm thời
- Thêm horizontal scan line (a la CRT) chạy từ trên xuống
- Thêm column grouping — columns gần nhau phản ứng cùng frequency band

## 7. spectrum3d.ts — Nâng cấp

**Hiện trạng**: 6 depth rows, perspective scaling, wave cascade.
**Nâng cấp**:
- Thêm connecting lines giữa đỉnh các bar liền kề (mountain silhouette)
- Thêm color temperature mapping — bass = warm (đỏ), treble = cool (xanh)
- Thêm rotating camera effect — góc nhìn 3D xoay chậm
- Cải thiện depth: thêm ground plane grid phối cảnh

---

## Wave style MỚI đề xuất

### 1. Oscilloscope (oscilloscope)
**Icon**: 📟 **Category**: tech
**Mô tả**: Màn hình oscilloscope cổ điển — Lissajous pattern (X-Y mode).
Dùng 2 channel audio (left/right hoặc waveform + spectrum) để tạo hình dạng Lissajous.
Phosphor green color, slow fade trail, grid paper, beam focus dot.
**Audio-reactive**: Waveform samples drive X/Y coordinates, spectrum modulates intensity.

### 2. Vinyl (vinyl)
**Icon**: 💿 **Category**: artistic
**Mô tả**: Đĩa vinyl đang quay — grooves reactive theo spectrum.
Vòng tròn đồng tâm (grooves) với khoảng cách biến thiên theo spectrum.
Tonearm needle indicator, label center area, spinning animation.
**Audio-reactive**: Groove depth = spectrum amplitude, rotation speed = BPM/beat.
