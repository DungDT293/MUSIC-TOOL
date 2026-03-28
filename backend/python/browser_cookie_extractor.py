"""
Browser Cookie Extractor - Lấy cookie từ trình duyệt và export ra Netscape format

Sử dụng browser_cookie3 hoặc rookiepy để lấy cookie từ trình duyệt local,
sau đó export ra file Netscape format để yt-dlp có thể sử dụng.

Usage (CLI):
  python browser_cookie_extractor.py --browser chrome --domain youtube.com --output cookies.txt

Output:
  - Tạo file cookies.txt ở định dạng Netscape
  - In JSON result ra stdout: {"success": true, "cookie_file": "path/to/cookies.txt", "cookie_count": 123}
"""

import argparse
import json
import sys
import os
from typing import Optional, Dict, Any
from pathlib import Path

# Thử import browser_cookie3 trước (phổ biến hơn)
try:
    import browser_cookie3
    HAS_BROWSER_COOKIE3 = True
except ImportError:
    HAS_BROWSER_COOKIE3 = False

# Thử import rookiepy (nhanh hơn, viết bằng Rust)
try:
    import rookiepy
    HAS_ROOKIEPY = True
except ImportError:
    HAS_ROOKIEPY = False

if not HAS_BROWSER_COOKIE3 and not HAS_ROOKIEPY:
    sys.stderr.write(
        "[BrowserCookieExtractor] Cần cài đặt một trong các thư viện sau:\n"
        "  pip install browser-cookie3\n"
        "  hoặc\n"
        "  pip install rookiepy\n"
    )
    sys.exit(1)


def get_cookies_from_browser(browser: str, domain: Optional[str] = None) -> Any:
    """
    Lấy cookies từ trình duyệt sử dụng browser_cookie3 hoặc rookiepy.
    
    Args:
        browser: Tên trình duyệt ('chrome', 'firefox', 'edge', 'opera', 'brave', 'safari')
        domain: Domain để filter cookies (ví dụ: 'youtube.com'). None = lấy tất cả
    
    Returns:
        CookieJar object từ thư viện được sử dụng
    """
    browser_lower = browser.lower()
    
    # Ưu tiên rookiepy vì nhanh hơn và xử lý locked files tốt hơn
    if HAS_ROOKIEPY:
        try:
            # Map browser name to rookiepy format
            browser_map = {
                'chrome': 'chrome',
                'firefox': 'firefox',
                'edge': 'edge',
                'opera': 'opera',
                'brave': 'brave',
                'safari': 'safari',
                'vivaldi': 'vivaldi',
                'chromium': 'chromium',
            }
            
            rookiepy_browser = browser_map.get(browser_lower)
            if not rookiepy_browser:
                raise ValueError(f"Browser '{browser}' không được hỗ trợ bởi rookiepy")
            
            # Lấy cookies từ rookiepy
            cookies = rookiepy.load(rookiepy_browser)
            
            # Filter theo domain nếu có
            if domain:
                filtered_cookies = []
                for cookie in cookies:
                    if domain in cookie.domain or cookie.domain in domain:
                        filtered_cookies.append(cookie)
                return filtered_cookies
            
            return cookies
        except Exception as e:
            sys.stderr.write(f"[BrowserCookieExtractor] rookiepy failed: {e}\n")
            # Fallback to browser_cookie3
            if HAS_BROWSER_COOKIE3:
                pass
            else:
                raise
    
    # Fallback to browser_cookie3
    if HAS_BROWSER_COOKIE3:
        try:
            # Map browser name to browser_cookie3 function
            browser_func_map = {
                'chrome': browser_cookie3.chrome,
                'firefox': browser_cookie3.firefox,
                'edge': browser_cookie3.edge,
                'opera': browser_cookie3.opera,
                'brave': browser_cookie3.brave,
                'safari': browser_cookie3.safari,
                'chromium': browser_cookie3.chromium,
            }
            
            browser_func = browser_func_map.get(browser_lower)
            if not browser_func:
                raise ValueError(f"Browser '{browser}' không được hỗ trợ bởi browser_cookie3")
            
            # Lấy cookies từ browser_cookie3
            if domain:
                return browser_func(domain_name=domain)
            else:
                return browser_func()
        except Exception as e:
            raise Exception(f"Không thể lấy cookie từ {browser}: {e}")
    
    raise Exception("Không có thư viện nào khả dụng để lấy cookie")


def export_to_netscape_format(cookies: Any, output_file: str, domain: Optional[str] = None) -> int:
    """
    Export cookies ra file Netscape format (định dạng mà yt-dlp sử dụng).
    
    Format Netscape:
    # Netscape HTTP Cookie File
    # This is a generated file! Do not edit.
    
    .domain.com	TRUE	/path	FALSE	timestamp	name	value
    
    Args:
        cookies: CookieJar hoặc list cookies
        output_file: Đường dẫn file output
        domain: Domain để filter (optional)
    
    Returns:
        Số lượng cookies đã export
    """
    cookie_count = 0
    
    with open(output_file, 'w', encoding='utf-8') as f:
        # Write Netscape header
        f.write("# Netscape HTTP Cookie File\n")
        f.write("# This is a generated file! Do not edit.\n\n")
        
        # Xử lý cookies từ browser_cookie3 (CookieJar)
        if HAS_BROWSER_COOKIE3 and hasattr(cookies, '__iter__'):
            for cookie in cookies:
                # Filter theo domain nếu có
                if domain and domain not in cookie.domain:
                    continue
                
                # Netscape format: domain, flag, path, secure, expiration, name, value
                # domain: domain của cookie (có thể bắt đầu bằng .)
                # flag: TRUE nếu domain áp dụng cho subdomains
                # path: path của cookie
                # secure: TRUE nếu cookie chỉ gửi qua HTTPS
                # expiration: Unix timestamp (0 = session cookie)
                # name: tên cookie
                # value: giá trị cookie
                
                domain_str = cookie.domain
                if not domain_str.startswith('.'):
                    domain_str = '.' + domain_str
                
                flag = 'TRUE' if cookie.domain.startswith('.') else 'FALSE'
                path = cookie.path if cookie.path else '/'
                secure = 'TRUE' if cookie.secure else 'FALSE'
                
                # Expiration: 0 nếu không có, hoặc Unix timestamp
                expiration = '0'
                if hasattr(cookie, 'expires') and cookie.expires:
                    try:
                        expiration = str(int(cookie.expires))
                    except:
                        expiration = '0'
                
                f.write(f"{domain_str}\t{flag}\t{path}\t{secure}\t{expiration}\t{cookie.name}\t{cookie.value}\n")
                cookie_count += 1
        
        # Xử lý cookies từ rookiepy (list of Cookie objects)
        elif HAS_ROOKIEPY and isinstance(cookies, list):
            for cookie in cookies:
                # Filter theo domain nếu có
                if domain and domain not in cookie.domain:
                    continue
                
                # Rookiepy Cookie object có các thuộc tính: name, value, domain, path, secure, expires
                domain_str = cookie.domain
                if not domain_str.startswith('.'):
                    domain_str = '.' + domain_str
                
                flag = 'TRUE' if cookie.domain.startswith('.') else 'FALSE'
                path = getattr(cookie, 'path', '/') or '/'
                secure = 'TRUE' if getattr(cookie, 'secure', False) else 'FALSE'
                
                expiration = '0'
                if hasattr(cookie, 'expires') and cookie.expires:
                    try:
                        expiration = str(int(cookie.expires))
                    except:
                        expiration = '0'
                
                f.write(f"{domain_str}\t{flag}\t{path}\t{secure}\t{expiration}\t{cookie.name}\t{cookie.value}\n")
                cookie_count += 1
    
    return cookie_count


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Lấy cookie từ trình duyệt và export ra Netscape format"
    )
    parser.add_argument(
        '--browser',
        required=True,
        choices=['chrome', 'firefox', 'edge', 'opera', 'brave', 'safari', 'chromium', 'vivaldi'],
        help='Trình duyệt để lấy cookie'
    )
    parser.add_argument(
        '--domain',
        default=None,
        help='Domain để filter cookies (ví dụ: youtube.com). Mặc định: lấy tất cả'
    )
    parser.add_argument(
        '--output',
        required=True,
        help='Đường dẫn file output (Netscape format)'
    )
    
    args = parser.parse_args()
    
    try:
        # Lấy cookies từ trình duyệt
        cookies = get_cookies_from_browser(args.browser, args.domain)
        
        # Export ra Netscape format
        cookie_count = export_to_netscape_format(cookies, args.output, args.domain)
        
        # Output JSON result
        result: Dict[str, Any] = {
            "success": True,
            "cookie_file": os.path.abspath(args.output),
            "cookie_count": cookie_count,
            "browser": args.browser,
            "domain": args.domain or "all",
        }
        
        json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
        
    except Exception as e:
        # Output error as JSON
        result: Dict[str, Any] = {
            "success": False,
            "error": str(e),
            "browser": args.browser,
            "domain": args.domain or "all",
        }
        json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
        sys.exit(1)


if __name__ == "__main__":
    main()



