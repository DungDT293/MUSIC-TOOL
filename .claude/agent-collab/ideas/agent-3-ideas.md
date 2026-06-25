# Agent 3 — Ý tưởng nâng cấp Wave Styles

## Danh sách wave phụ trách
- nebula.ts ✨
- waterripple.ts 💧
- particles.ts ✦
- musicnotes.ts 🎵

---

## 1. Nâng cấp: nebula.ts — Tinh vân
**Hiện trạng**: 4 spiral arms, star particles, supernova glow, orbiting pulsar.
**Nâng cấp**:
- Thêm **dust lanes** (dải bụi tối) giữa các cánh tay xoắn — hiệu ứng contrast ánh sáng/bóng tối như ảnh NASA
- Thêm **color nebula clouds** — soft radial gradients với màu khác nhau xen kẽ giữa các arm
- **Beat-reactive supernova pulse** mạnh hơn — core glow co giãn mạnh theo bass
- Thêm **shooting stars** — tia sáng ngắn bay nhanh theo treble energy

## 2. Nâng cấp: waterripple.ts — Gợn nước
**Hiện trạng**: 12 concentric rings, caustic light, bass burst.
**Nâng cấp**:
- Thêm **rain drops** — droplet impact points xuất hiện random, gây ra wave ripple nhỏ
- **Reflection highlight** — dải sáng phản chiếu dọc từ trên xuống (như mặt nước phản chiếu ánh trăng)
- Rings có **thickness variation** — đoạn gần beat point thì dày hơn, xa thì mỏng
- Caustics (đốm sáng) di chuyển mượt hơn với **Perlin noise-like** pattern

## 3. Nâng cấp: particles.ts — Hạt sáng
**Hiện trạng**: 45 floating particles, twinkle, beat burst.
**Nâng cấp**:
- **Tăng particle count** từ 45 → 60 và thêm size diversity (micro + macro particles)
- Thêm **trail effect** — mỗi particle để lại vệt sáng mờ phía sau khi di chuyển
- **Attraction to beat** — khi bass mạnh, particles bị "hút" về trung tâm nhẹ nhàng
- Thêm **sparkle stars** — 1-2 particles random biến thành hình ngôi sao nhỏ lấp lánh

## 4. Nâng cấp: musicnotes.ts — Nốt nhạc
**Hiện trạng**: H2O Music style với grid, orbit rings, notes, side EQ, corner dots.
**Nâng cấp**:
- **Đổi nốt nhạc bằng path thay vì text** — dùng canvas path vẽ nốt nhạc ♪ thay vì font (render đẹp hơn trên mọi hệ thống)
- Thêm **note trail** — khi xoay, nốt để lại vệt sáng mờ dần
- **Dynamic EQ bar colors** — gradient từ cyan → magenta theo chiều dọc
- Thêm **beat pulse ring** — vòng sáng mở rộng từ tâm khi bass peak

---

## 5. Wave style MỚI: Firefly (Đom đóm) 🔥
**Ý tưởng**: Đom đóm bay lung linh trong đêm tối
- 30-40 đom đóm bay theo đường cong Lissajous
- Mỗi con có **nhịp sáng** riêng (blink pattern), đồng bộ nhẹ với beat
- **Warm yellow-green** color palette (#ffe066, #88ff44)
- Khi bass mạnh → đom đóm sáng đồng loạt (synchronous flash)
- Mỗi đom đóm có "đuôi sáng" ngắn khi bay

## 6. Wave style MỚI: Sakura (Hoa anh đào) 🌸
**Ý tưởng**: Cánh hoa anh đào rơi nhẹ nhàng
- 25-35 cánh hoa được vẽ bằng canvas path (hình oval xoay)
- Rơi từ trên xuống với **sway** (lắc ngang) theo sine wave
- Mỗi cánh có **rotation** khi rơi — xoay chậm tạo depth illusion
- Beat đẩy cánh hoa bay tung lên nhẹ rồi lại rơi xuống
- Palette: hồng pastel (#ffb7c5, #ff69b4) với gradient alpha
- Background glow nhẹ hồng khi có nhiều cánh hoa
