# Cross-Review Protocol — Kiểm tra đối chiếu song song

## Mục đích
4 agents cùng chạy song song để:
1. Đọc code thực tế của TẤT CẢ wave files (không chỉ file mình phụ trách)
2. Kiểm tra chất lượng, tìm bug, đánh giá hiệu ứng
3. Ghi kết quả review vào `cross-reviews/agent-N-crossreview.md`
4. Đề xuất cải thiện cho wave của agent khác (không sửa trực tiếp!)

## Quy tắc
- **CHỈ ĐỌC** code của agent khác — KHÔNG SỬA file của agent khác
- Mỗi agent ghi review vào file riêng trong `cross-reviews/` → không conflict
- Nếu phát hiện bug: ghi rõ file, dòng, vấn đề → agent phụ trách tự fix
- Nếu có đề xuất: ghi suggestion rõ ràng, không ép buộc

## Tiêu chí đánh giá
1. **Correctness**: Code có chạy đúng không? Import đúng helpers?
2. **Performance**: Có vòng lặp quá nặng? Object allocation trong render loop?
3. **Visual quality**: Hiệu ứng V2 có thực sự cải thiện so với V1?
4. **Consistency**: Có follow convention chung? (resolveColorRgba, animTimeMs, ctx.save/restore)
5. **State management**: Persistent state + cleanup có đúng pattern?
6. **Registration**: registerWave() meta đúng id/label/icon/category?

## Output format

```markdown
# Agent N — Cross-Review

## Agent X waves reviewed:
### waveName.ts
- ✅ Tốt: ...
- ⚠️ Cảnh báo: ...
- 🐛 Bug: file, line, vấn đề
- 💡 Đề xuất: ...

## Summary
- Tổng bugs tìm thấy: N
- Tổng đề xuất: N
- Build status: pass/fail
```
