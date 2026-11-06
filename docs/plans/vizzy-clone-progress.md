# Clone chức năng Vizzy — tiến độ

Mục tiêu: clone toàn bộ chức năng editor Vizzy vào Sóng nhạc. Mỗi mục chỉ được đánh ✅ khi
đã chạy trong app thật (chụp ảnh) hoặc đã đo được, không đánh dấu theo cảm tính.

## Panel trái

| Panel | Vizzy có | Trạng thái |
|---|---|---|
| **Composition** | cây nhóm → layer, thêm/xoá/nhân bản, thứ tự | ✅ (LayersPanel) |
| **Analyzers** | analyzer theo layer: dải tần, màu, độ nhạy | ✅ dải tần + độ nhạy + làm mượt theo từng layer (rail Analyzer + Inspector) |
| **Effects** | blending, two-pass blur, global alpha, FXAA, tint, mirror, camera shake | 🟡 có 6/8: blur, alpha, tint, mirror, zoom, shake (thiếu FXAA, two-pass riêng) |
| **Automations** | keyframe theo thuộc tính | ❌ chưa có |
| **Media** | uploads, stock, audio, images, videos | 🟡 chọn file được, chưa có thư viện |
| **Projects** | project settings/history, list | ❌ chưa có (app chưa lưu project) |
| **Lyrics** | nhập lyric, LRCLIB | ❌ chưa có |

## Panel phải (Inspector theo loại object)

| Object | Vizzy | Trạng thái |
|---|---|---|
| **Visualizer** | preset, spectrum layers, general, position, basics | 🟡 ~12 tham số (preset, màu, sóng, glow, thời gian) |
| **Particles** | shape 5 kiểu, color, mirror, constant size, front/back limit + time, alpha, amount, opacity range, size range, fade in/out, random, behaviour, origin, transform | 🟡 11 tham số (shape 3 kiểu, màu, amount, size/opacity range, speed, spread, gravity, beat, mirror) |
| **Image** | appearance, blending, flatten, transform | ✅ thêm blend, anchor, bo góc, viền, bóng đổ |
| **Video** | như image | ✅ cùng bộ với image |
| **Text** | font, stroke, shadow, alignment | 🟡 font/cỡ/màu/viền/bóng, chưa có căn lề nhiều dòng |

## Timeline

| Chức năng | Trạng thái |
|---|---|
| waveform thật | ✅ |
| playhead + seek | ✅ |
| zoom | ✅ |
| track theo layer | ✅ |
| kéo mép clip đổi thời gian | ❌ |
| keyframe trên track | ❌ |
| ruler thời gian | ❌ |

## Ghi chú kỹ thuật

- Ảnh/video: bo góc, viền, bóng đổ được **bake vào texture** (canvas 2D) nên không tốn shader.
- Blend mode áp lên `MeshBasicMaterial.blending`; screen dùng custom blend.
- Effects chạy trong `finishPass` (1 pass duy nhất trước OutputPass) và đi theo cả đường xuất video.
