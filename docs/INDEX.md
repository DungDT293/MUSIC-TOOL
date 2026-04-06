# 📚 Docs Index — 93 Media Tool v4.0.2

> Cập nhật: 2026-04-02

---

## 📌 Core (docs/)

| File | Nội dung |
|------|----------|
| [README.md](./README.md) | Tổng quan app, tính năng, tech stack, cài đặt |
| [architecture.md](./architecture.md) | Kiến trúc hệ thống, IPC channels, preload API, data flow |
| [requirements.md](./requirements.md) | Yêu cầu chức năng & phi chức năng (SRS/BRD) |
| [FEATURES_GUIDE.md](./FEATURES_GUIDE.md) | Hướng dẫn chi tiết 10 tính năng chính |
| [external-tools.md](./external-tools.md) | Cách gọi ffmpeg/ffprobe/yt-dlp/exiftool/PowerShell |
| [FUNCTIONALITY_TEST_REPORT.md](./FUNCTIONALITY_TEST_REPORT.md) | Báo cáo test từng feature |

---

## 🔒 Security (docs/security/)

| File | Nội dung |
|------|----------|
| [SECURITY_PLAN.md](./security/SECURITY_PLAN.md) | Trạng thái bảo mật hiện tại v4.0.2 |
| [SECURITY_ALERTING.md](./security/SECURITY_ALERTING.md) | Hệ thống cảnh báo bảo mật |
| [SECURITY_AUDIT_REPORT_v3.6.0.md](./security/SECURITY_AUDIT_REPORT_v3.6.0.md) | White-box OWASP audit report |
| [SECURITY_REFACTORING_COMPLETE_REPORT.md](./security/SECURITY_REFACTORING_COMPLETE_REPORT.md) | 10-phase security refactoring report |
| [SECURITY_TEST_REPORT.md](./security/SECURITY_TEST_REPORT.md) | 17/17 security tests passed |

---

## 📖 Guides (docs/guides/)

| File | Nội dung |
|------|----------|
| [LICENSE_WORKFLOW.md](./guides/LICENSE_WORKFLOW.md) | Luồng license: register → approve → ticket |
| [ATOMICPARSLEY_SETUP.md](./guides/ATOMICPARSLEY_SETUP.md) | Cài đặt AtomicParsley (iTunes atoms cho MP4) |
| [GPU_CPU_ENCODING_PLAN.md](./guides/GPU_CPU_ENCODING_PLAN.md) | GPU/CPU encoding toggle implementation |
| [AUTO_UPDATE_IMPLEMENTATION_PLAN.md](./guides/AUTO_UPDATE_IMPLEMENTATION_PLAN.md) | Kế hoạch auto-update |
| [AUTO_UPDATE_STRATEGIES.md](./guides/AUTO_UPDATE_STRATEGIES.md) | So sánh chiến lược auto-update |
| [VERSION_CONTROL_WORKER_SETUP.md](./guides/VERSION_CONTROL_WORKER_SETUP.md) | Cloudflare Worker version-gating setup |
| [SEO_METADATA_CODE_ANALYSIS.md](./guides/SEO_METADATA_CODE_ANALYSIS.md) | Phân tích source code SEO metadata |
| [SEO_UNICODE_SUPPORT.md](./guides/SEO_UNICODE_SUPPORT.md) | Unicode support cho SEO (Việt, Trung, Nhật) |

---

## 📊 Dashboard (docs/dashboard/)

| File | Nội dung |
|------|----------|
| [DASHBOARD_STATUS.md](./dashboard/DASHBOARD_STATUS.md) | Trạng thái Admin Dashboard (Cloudflare Workers) |
| [DASHBOARD_FEATURE_SUGGESTIONS.md](./dashboard/DASHBOARD_FEATURE_SUGGESTIONS.md) | Đề xuất tính năng mới cho dashboard |

---

## 🛠️ DevOps (docs/devops/)

| File | Nội dung |
|------|----------|
| [README_BACKUP_NHANH.md](./devops/README_BACKUP_NHANH.md) | Hướng dẫn backup nhanh 1 phút |
| [README_BACKUP_UPDATE.md](./devops/README_BACKUP_UPDATE.md) | Hướng dẫn backup + update scripts |
| [TEST_ME_NOW.md](./devops/TEST_ME_NOW.md) | Checklist test nhanh sau khi build |
| TEST-BACKUP-RESULT.txt | Kết quả test backup |
| 📂-DANH-SACH-FILE-BACKUP.txt | Danh sách files trong backup |

---

## 🔬 Research (docs/research/)

| File | Nội dung |
|------|----------|
| [ANALYSIS_REPORT.md](./research/ANALYSIS_REPORT.md) | Phân tích codebase 100% (124KB) |
| [MUSIC_VISUALIZER_RESEARCH.md](./research/MUSIC_VISUALIZER_RESEARCH.md) | Nghiên cứu apps visualizer (Avee Player, MilkDrop, etc.) |
| [SUPER_PROMPT.md](./research/SUPER_PROMPT.md) | Template prompt cho Claude Code audit |
| [RAF_LOOPS_ANALYSIS.md](./research/RAF_LOOPS_ANALYSIS.md) | Phân tích RAF loops trong visualizer |
| wave.md | Code dump visualizer components (scratchpad) |
| song nhac.md | Design notes kiến trúc sóng nhạc |

---

## 📜 History (docs/history/)

Báo cáo hoàn thành Phase 2 Canvas Export Engine (2026-01-17/18):

| File | Nội dung |
|------|----------|
| PHASE2_IMPLEMENTATION_SUMMARY.md | Tóm tắt Phase 2 implementation |
| PHASE2_QUICK_START.md | Quick start guide Phase 2 |
| PHASE2_VISUALIZER_TAB_INTEGRATION.md | Integration guide cho VisualizerTab |
| ✅_PHASE2_COMPLETE.md | Master completion report |
| ✅_EXPORT_MODAL_COMPLETE.md | Export modal hoàn thành |
| ✅_EXPORT_UX_FIXES_COMPLETE.md | Export UX fixes |
| ✅_FINAL_IMPLEMENTATION_SUMMARY.md | Final implementation summary |
| ✅_IPC_WIRED_COMPLETE.md | IPC wired confirmation |
| ✅_LOGGING_IMPLEMENTED.md | Logging implementation |

---

## 🗄️ Archive (docs/archive/)

> ⛔ Files đã lỗi thời — kiến trúc/code được tham chiếu **không còn tồn tại** trong codebase.

| File | Lý do archived |
|------|----------------|
| AUDIO_VISUALIZER_REFACTOR_*.md (3 files) | `src/components/AudioVisualizer/` đã xoá |
| AUDIO_VISUALIZER_INTEGRATION_*.md (2 files) | Kiến trúc cũ |
| AUDIO_SPECTRUM_REBUILD_*.md (2 files) | Thay thế bởi `src/features/song-nhac/` |
| LAYER_MANAGEMENT_PROGRESS.md | Fabric.js layer đã thay thế |
| PLAN_LAYER_MANAGEMENT.md | Fabric.js layer đã thay thế |
| PLAN_FIX_VIZ_VISUALIZER.md | .viz parser không còn |
| ROADMAP_VISUALIZER.md | Fabric.js roadmap cũ |
| BUG_FIX_PROGRESS.md | 13 files "NEW" không tồn tại |
| UI_VISUALIZER_PLAN.md | UI plan cũ |

---

## 📄 Root level (ngoài docs/)

| File | Nội dung |
|------|----------|
| [ROADMAP.md](../ROADMAP.md) | Roadmap dựa trên code hiện tại |
| [TROUBLESHOOTING.md](../TROUBLESHOOTING.md) | Hướng dẫn khắc phục sự cố v4.0.2 |
