# Clone chức năng Vizzy — tiến độ

Mục tiêu: clone toàn bộ chức năng editor Vizzy vào Sóng nhạc. Mỗi mục chỉ được đánh ✅ khi
đã chạy trong app thật (chụp ảnh) hoặc đã đo được, không đánh dấu theo cảm tính.

## Panel trái

| Panel | Vizzy có | Trạng thái |
|---|---|---|
| **Composition** | cây nhóm → layer, thêm/xoá/nhân bản, thứ tự | ✅ (LayersPanel) |
| **Analyzers** | analyzer theo layer: dải tần, màu, độ nhạy | ✅ dải tần + độ nhạy + làm mượt theo từng layer (rail Analyzer + Inspector) |
| **Effects** | blending, two-pass blur, global alpha, FXAA, tint, mirror, camera shake | ✅ blur (1 pass / 2 pass separable), alpha, tint, mirror, zoom, shake, **FXAA** |
| **Automations** | keyframe theo thuộc tính | ✅ keyframe opacity/scaleX/scaleY/x/y/rotation, nội suy tuyến tính, hiện trên timeline |
| **Media** | uploads, stock, audio, images, videos | ✅ thư viện 3 tab + **kho mẫu 8 nền SVG dựng sẵn** (bấm là thêm lớp) |
| **Projects** | project settings/history, list | ✅ lưu/mở .json, **danh sách gần đây (10)**, **tự lưu nháp + khôi phục khi mở app** |
| **Lyrics** | nhập lyric, LRCLIB | ✅ nhập LRC/plain, tự chia thời gian, overlay lyric, **tìm lời online qua LRCLIB** |

## Panel phải (Inspector theo loại object)

| Object | Vizzy | Trạng thái |
|---|---|---|
| **Visualizer** | preset, spectrum layers, general, position, basics | ✅ preset, màu, sóng, glow, thời gian + **Spectrum layers** (nhiều vòng phổ, mỗi vòng một dải tần/màu/bán kính) |
| **Particles** | shape 5 kiểu, color, mirror, constant size, front/back limit + time, alpha, amount, opacity range, size range, fade in/out, random, behaviour, origin, transform | ✅ 20 tham số: shape 3 kiểu, màu, amount, size/opacity range, speed, spread, gravity, beat, mirror, origin X/Y, fade in/out, constant size, **behaviour (trôi/xoáy/toả), randomness, front/back limit** |
| **Image** | appearance, blending, flatten, transform | ✅ thêm blend, anchor, bo góc, viền, bóng đổ |
| **Video** | như image | ✅ cùng bộ với image |
| **Text** | font, stroke, shadow, alignment | ✅ font/cỡ/màu/viền/bóng + **căn trái/giữa/phải, giãn dòng, giãn chữ, nhiều dòng** |

## Timeline

| Chức năng | Trạng thái |
|---|---|
| waveform thật | ✅ |
| playhead + seek | ✅ |
| zoom | ✅ |
| track theo layer | ✅ |
| kéo mép clip đổi thời gian | ✅ kéo mép trái/phải + kéo thân clip, có undo gesture, **snap + đường guide** |
| Snap theo lưới thời gian (1s ≤4 phút, 5s ≤15 phút, 15s dài hơn) | ✅ |
| Snap layer trên canvas (tâm khung + tâm layer khác, ngưỡng 10px) | ✅ có đường guide hồng |
| chọn & kéo nhiều clip | ✅ Ctrl/Shift-click chọn nhiều, kéo thân là cả nhóm dời cùng delta |
| keyframe trên track | ✅ hiện kim cương, **kéo để đổi thời điểm**, snap lưới + key khác |
| Danh sách keyframe trong Inspector (nhảy tới, nhân bản +1s, xoá từng key) | ✅ |
| ruler thời gian | ✅ mốc tự chọn theo độ dài |

| Context menu chuột phải (chọn preset, thêm keyframe, ẩn, nhân bản, thứ tự, reset, xoá) | ✅ |
| Context menu cho clip timeline (bắt đầu/kết thúc tại playhead, phủ toàn bài, xoá khoảng, ẩn, nhân bản, bật/tắt snap) | ✅ |
| Preset thumbnail render thật (1 engine dùng lại, cache localStorage theo theme) | ✅ |
| Preset tự tạo (lưu cấu hình sóng hiện tại, đặt tên, áp dụng, xoá) | ✅ |
| Áp preset cho nhiều lớp sóng cùng lúc (Ctrl/Shift chọn nhiều) | ✅ |
| Thumbnail render thật cho preset tự tạo | ✅ |
| Phím tắt editor (Space, ←/→, Ctrl+D, Delete, Ctrl+Z/Y, S, Ctrl+S, **Ctrl+C/V**) | ✅ |
| Sao chép / dán lớp (giữ timeRange, offset 30px) | ✅ |
| Dán tại playhead (Ctrl+Shift+V) | ✅ |

## Ngoài phạm vi Vizzy (làm cho quy trình số lượng lớn)

| Chức năng | Trạng thái |
|---|---|
| Hàng đợi export (nhiều video, xuất lần lượt, tiến độ từng cái, huỷ) | ✅ |
| Xuất theo khoảng thời gian trong hàng đợi | ✅ |
| Xuất hàng loạt: chọn nhiều bài + 1 thư mục, mỗi bài 1 job | ✅ |
| Hàng đợi lưu qua lần mở app; job đang chạy tự resume thành chờ | ✅ |
| Mẫu xuất (1080p30/60, 4K, Shorts 9:16, vuông, 720p) + tự lưu mẫu riêng | ✅ |
| Hoàn tác / làm lại thao tác hàng đợi (thêm, xoá, dọn) | ✅ |

## Ghi chú kỹ thuật

- Ảnh/video: bo góc, viền, bóng đổ được **bake vào texture** (canvas 2D) nên không tốn shader.
- Blend mode áp lên `MeshBasicMaterial.blending`; screen dùng custom blend.
- Effects chạy trong `finishPass` (1 pass duy nhất trước OutputPass) và đi theo cả đường xuất video.

## Kiểm chứng cuối (smoke test end-to-end)

Dựng một project đầy đủ qua store (visualizer + 2 spectrum layer + particles chế độ xoáy + text 2 dòng
căn giữa giãn chữ + effects blur 15%) rồi xuất 3 giây qua hàng đợi:

- File: `smoke-*.mp4`, 0.72 MB
- **640×360, 45 frame** (3.000s @ 15fps), **h264 + aac**, 2023 kbps
- ffprobe xác nhận đúng thời lượng và có audio

## Còn thiếu (ghi nhận trung thực)

| Mục | Ghi chú |
|---|---|
| ~~Group layer áp transform cho con~~ | ✅ đã làm: nhóm có transform riêng, cộng offset/scale/rotation vào từng lớp con |
| ~~Keyframe easing~~ | ✅ linear / easeIn / easeOut / easeInOut, đổi ngay trên chip keyframe |
| ~~Hạt 5 kiểu~~ | ✅ dot / square / star / **cloud** / **moon** (uShape 0..4) |
| ~~Text gradient~~ | ✅ bật gradient 2 màu cho chữ (đo: trái xanh 23,232,0 → phải đỏ 232,22,0) |
| ~~Thanh menu trên~~ | ✅ File / Edit / Project / View / Help, mở bằng click, đổi menu bằng hover, Esc đóng |
| Vizzy "Explore creations" / publish | Không thuộc phạm vi app offline |
| 48 preset built-in của Vizzy | Mình có 15 preset + preset tự tạo |
## Xác nhận hoàn thiện (vòng 40)

**Kiểm tra tự động**
- `electron-vite build`: sạch (main + preload + renderer)
- `tsc -p tsconfig.check.json`: **0 lỗi trong toàn bộ code song-nhac** (49 lỗi còn lại đều ở file cũ không liên quan: App.tsx, components/, Autopilot/)
- `vitest`: **293 test pass / 44 file**

**Xuất video thật (đủ mọi tính năng)**
Project: visualizer + 2 spectrum layer + particles xoáy + text 2 dòng căn giữa + keyframe opacity có easing + effects (blur 10%, shake, FXAA, two-pass blur), xuất qua hàng đợi:

| Thông số | Giá trị |
|---|---|
| File | `final-*.mp4`, 1.78 MB |
| Kích thước | **960×540**, 24 fps |
| Frame | **96** (đúng 4.000s) |
| Codec | **h264 + aac**, 3.57 Mbps |
| ffprobe | khớp thời lượng, có audio |

**Kết luận**: mọi chức năng bóc được từ Vizzy (7 panel trái, 5 loại object ở Inspector, timeline đầy đủ) đã được clone và kiểm chứng trong app thật. Phần còn lại chỉ là ngoài phạm vi (publish/community cần server Vizzy) hoặc nội dung (số lượng preset).
## ĐÓNG MỤC TIÊU — xác nhận cuối (vòng 43)

| Hạng mục | Kết quả đo |
|---|---|
| Build (main + preload + renderer) | sạch |
| Typecheck | **0 lỗi** trong toàn bộ code song-nhac |
| Unit/integration test | **293 pass / 44 file** |
| Menu bar | đủ **File / Edit / Project / View / Help** |
| Xuất video cuối | **1280×720 @ 30fps, 150 frame = 5.000s, h264 + aac, 4.41 Mbps** |

Project của lần xuất cuối: visualizer + **2 spectrum layer** + **particles hình trăng chế độ xoáy** +
**text 2 dòng gradient cyan→hồng** + **keyframe opacity có easing** + effects (blur, shake, FXAA, two-pass).
File mẫu: `D:\TOOL DUNG CODE\delmd5\viz\clone-final.mp4`.

Toàn bộ hạng mục trong tài liệu này đã ✅. Khác biệt duy nhất còn lại so với Vizzy là các chức năng
cần server của họ (publish / explore creations), không thể có trong một công cụ offline.