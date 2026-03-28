# Browser Cookie Extractor - Hướng dẫn cài đặt

## Mô tả
Python script để lấy cookie từ trình duyệt và export ra Netscape format để yt-dlp sử dụng.

## Cài đặt dependencies

### Cách 1: Sử dụng browser-cookie3 (Khuyến nghị - dễ cài đặt)
```bash
pip install browser-cookie3
```

### Cách 2: Sử dụng rookiepy (Nhanh hơn, viết bằng Rust)
```bash
pip install rookiepy
```

### Cách 3: Cài cả hai (fallback tự động)
```bash
pip install browser-cookie3 rookiepy
```

## Sử dụng

Script sẽ tự động được gọi từ TypeScript code khi cần lấy cookie từ trình duyệt.

### Manual testing:
```bash
python backend/python/browser_cookie_extractor.py --browser chrome --domain youtube.com --output cookies.txt
```

## Hỗ trợ browsers
- Chrome
- Firefox
- Edge
- Opera
- Brave
- Safari
- Chromium
- Vivaldi

## Lưu ý
- Script sẽ tự động chọn thư viện khả dụng (rookiepy > browser-cookie3)
- Rookiepy xử lý tốt hơn khi browser đang mở (tránh "Database is locked")
- Browser-cookie3 phổ biến hơn và dễ cài đặt hơn



