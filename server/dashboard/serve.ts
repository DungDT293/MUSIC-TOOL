/**
 * Dashboard HTML — serves the admin dashboard as a single-page inline HTML response
 * Extracted from index.ts for maintainability
 */

export function serveDashboard(): Response {
  // SECURITY: Content Security Policy for dashboard
  // Allow self, Chart.js CDN, and inline styles (dashboard uses inline styles)
  const cspPolicy = 
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; " +
    "font-src 'self' data: https://cdn.jsdelivr.net; " +
    "connect-src 'self'; " +
    "frame-src 'none'; " +
    "object-src 'none'; " +
    "base-uri 'self';"

  // Dashboard HTML (inline template)
  const dashboardHTML = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bảng Điều Khiển Bảo Mật - 93 Media Tool</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; min-height: 100vh; }
    .app-layout { display: flex; min-height: 100vh; }
    /* === SIDEBAR === */
    .sidebar { width: 260px; min-width: 260px; background: linear-gradient(180deg, #0f172a 0%, #1e293b 100%); border-right: 1px solid #334155; display: flex; flex-direction: column; height: 100vh; position: fixed; top: 0; left: 0; overflow-y: auto; z-index: 100; }
    .sidebar-brand { padding: 20px 16px; border-bottom: 1px solid #334155; }
    .sidebar-brand h1 { font-size: 18px; color: #f1f5f9; font-weight: 700; }
    .sidebar-brand .brand-sub { font-size: 11px; color: #64748b; margin-top: 4px; }
    .sidebar-group { padding: 12px 0; }
    .sidebar-group-title { padding: 8px 16px; font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 1.2px; font-weight: 700; }
    .sidebar-item { display: flex; align-items: center; gap: 10px; padding: 10px 16px; color: #94a3b8; cursor: pointer; font-size: 14px; font-weight: 500; transition: all 0.15s; border-left: 3px solid transparent; text-decoration: none; }
    .sidebar-item:hover { background: rgba(14, 165, 233, 0.08); color: #e2e8f0; }
    .sidebar-item.active { color: #0ea5e9; background: rgba(14, 165, 233, 0.12); border-left-color: #0ea5e9; }
    .sidebar-item .icon { width: 20px; text-align: center; font-size: 16px; }
    .sidebar-footer { margin-top: auto; padding: 12px 16px; border-top: 1px solid #334155; }
    .sidebar-footer .sidebar-item { padding: 8px 0; border-left: none; }
    /* === MAIN CONTENT === */
    .main-content { flex: 1; margin-left: 260px; padding: 24px 30px; min-height: 100vh; }
    .container { max-width: 1400px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #334155; }
    h1 { color: #f1f5f9; font-size: 28px; font-weight: 600; }
    .header-info { color: #94a3b8; font-size: 14px; }
    .page-title { font-size: 22px; color: #f1f5f9; font-weight: 600; margin-bottom: 20px; display: flex; align-items: center; gap: 10px; }
    .controls { display: flex; gap: 15px; margin-bottom: 30px; flex-wrap: wrap; background: #1e293b; padding: 15px; border-radius: 8px; border: 1px solid #334155; }
    .controls select, .controls input { padding: 10px 14px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #e2e8f0; font-size: 14px; transition: all 0.2s; }
    .controls select:focus, .controls input:focus { outline: none; border-color: #0ea5e9; box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.1); }
    .controls button { padding: 10px 20px; background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%); border: none; border-radius: 6px; color: white; cursor: pointer; font-size: 14px; font-weight: 500; transition: all 0.2s; }
    .controls button:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(14, 165, 233, 0.3); }
    .controls button:active { transform: translateY(0); }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; margin-bottom: 30px; }
    .stat-card { background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border: 1px solid #334155; border-radius: 12px; padding: 24px; position: relative; overflow: hidden; transition: all 0.3s; }
    .stat-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 4px; background: linear-gradient(90deg, #0ea5e9, #0284c7); }
    .stat-card:hover { transform: translateY(-4px); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3); border-color: #0ea5e9; }
    .stat-card h3 { font-size: 13px; color: #94a3b8; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 500; }
    .stat-card .value { font-size: 36px; font-weight: 700; line-height: 1; margin-bottom: 8px; }
    .stat-card .label { font-size: 12px; color: #64748b; }
    .stat-card.total .value { color: #0ea5e9; }
    .stat-card.critical .value { color: #ef4444; }
    .stat-card.high .value { color: #f97316; }
    .stat-card.medium .value { color: #eab308; }
    .stat-card.low .value { color: #22c55e; }
    .chart-container { background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border: 1px solid #334155; border-radius: 12px; padding: 24px; margin-bottom: 30px; }
    .chart-container h2 { margin-bottom: 24px; font-size: 18px; font-weight: 600; color: #f1f5f9; }
    .events-table { background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border: 1px solid #334155; border-radius: 12px; overflow: hidden; }
    .events-table table { width: 100%; border-collapse: collapse; }
    .events-table th { background: #0f172a; padding: 14px 16px; text-align: left; font-size: 12px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; border-bottom: 2px solid #334155; }
    .events-table td { padding: 14px 16px; border-bottom: 1px solid #334155; font-size: 14px; }
    .events-table tr:hover { background: rgba(14, 165, 233, 0.05); }
    .events-table tr:last-child td { border-bottom: none; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
    .badge-critical { background: rgba(239, 68, 68, 0.2); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); }
    .badge-high { background: rgba(249, 115, 22, 0.2); color: #f97316; border: 1px solid rgba(249, 115, 22, 0.3); }
    .badge-medium { background: rgba(234, 179, 8, 0.2); color: #eab308; border: 1px solid rgba(234, 179, 8, 0.3); }
    .badge-low { background: rgba(34, 197, 94, 0.2); color: #22c55e; border: 1px solid rgba(34, 197, 94, 0.3); }
    .loading { text-align: center; padding: 40px 20px; color: #94a3b8; font-size: 14px; }
    .error { background: linear-gradient(135deg, #7f1d1d 0%, #991b1b 100%); border: 1px solid #dc2626; border-radius: 8px; padding: 16px; margin-bottom: 20px; color: #fca5a5; display: flex; align-items: center; gap: 12px; }
    .error::before { content: '⚠️ '; font-size: 20px; }
    .auth-overlay { display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #0f172a; padding: 20px; }
    .auth-form { background: #111827; border: 1px solid #253348; border-radius: 12px; padding: 34px 32px 28px; max-width: 420px; width: 100%; box-shadow: 0 18px 60px rgba(0, 0, 0, 0.42); }
    .auth-logo { width: 48px; height: 48px; margin: 0 auto 18px; border-radius: 12px; display: flex; align-items: center; justify-content: center; background: #0f172a; color: #38bdf8; border: 1px solid #334155; font-size: 24px; font-weight: 800; }
    .auth-form h2 { margin-bottom: 8px; color: #f8fafc; font-size: 24px; text-align: center; font-weight: 700; }
    .auth-subtitle { text-align: center; color: #94a3b8; font-size: 14px; margin-bottom: 28px; }
    .auth-field-label { display: block; color: #94a3b8; font-size: 13px; font-weight: 500; margin-bottom: 8px; }
    .auth-input-wrapper { display: flex; align-items: center; background: #0f172a; border: 2px solid #334155; border-radius: 10px; transition: all 0.2s; margin-bottom: 8px; }
    .auth-input-wrapper:focus-within { border-color: #0ea5e9; box-shadow: 0 0 0 4px rgba(14, 165, 233, 0.15); }
    .auth-input-wrapper input { flex: 1; padding: 14px 16px; background: transparent; border: none; color: #e2e8f0; font-size: 15px; outline: none; min-width: 0; }
    .auth-input-wrapper input::placeholder { color: #475569; }
    .auth-input-wrapper .toggle-btn { padding: 10px 14px; background: none; border: none; color: #64748b; cursor: pointer; font-size: 18px; border-radius: 0 8px 8px 0; transition: color 0.2s; flex-shrink: 0; }
    .auth-input-wrapper .toggle-btn:hover { color: #e2e8f0; }
    .auth-form button#loginButton { width: 100%; padding: 13px; background: #0ea5e9; border: none; border-radius: 8px; color: white; cursor: pointer; font-size: 15px; font-weight: 700; margin-top: 18px; transition: all 0.2s; }
    .auth-form button#loginButton:hover { background: #0284c7; box-shadow: 0 8px 24px rgba(14, 165, 233, 0.24); }
    .auth-form button#loginButton:active { transform: translateY(0); }
    .auth-help { margin-top: 18px; border-top: 1px solid #253348; padding-top: 16px; color: #64748b; text-align: center; font-size: 12px; line-height: 1.6; }
    .auth-help button { color: #38bdf8; background: none; border: none; cursor: pointer; font-size: 12px; padding: 0; }
    .auth-help button:hover { text-decoration: underline; }
    .hidden { display: none; }
    code { background: rgba(14, 165, 233, 0.1); padding: 2px 6px; border-radius: 4px; font-family: 'Courier New', monospace; font-size: 12px; color: #0ea5e9; }
    .empty-state { text-align: center; padding: 40px 20px; color: #64748b; }
    .data-table { width: 100%; border-collapse: collapse; }
    .data-table th { padding: 10px 12px; text-align: left; font-size: 12px; color: #94a3b8; border-bottom: 1px solid #334155; text-transform: uppercase; letter-spacing: .04em; }
    .data-table td { padding: 12px; border-bottom: 1px solid #253348; color: #dbeafe; }
    .data-table td.number, .data-table th.number { text-align: right; }
    .data-table td.center, .data-table th.center { text-align: center; }
    .muted-note { color: #64748b; font-size: 12px; margin-top: 8px; }
    .chart-empty { display: flex; min-height: 220px; align-items: center; justify-content: center; color: #64748b; border: 1px dashed #334155; border-radius: 8px; }
    .tabs { display: none; }
    .tab { display: none; }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
    .status-badge { display: inline-block; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; }
    .status-cho_duyet { background: rgba(234, 179, 8, 0.2); color: #eab308; border: 1px solid rgba(234, 179, 8, 0.3); }
    .status-cho_phep { background: rgba(34, 197, 94, 0.2); color: #22c55e; border: 1px solid rgba(34, 197, 94, 0.3); }
    .status-chan { background: rgba(239, 68, 68, 0.2); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); }
    .action-btn { padding: 6px 12px; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 500; margin: 0 2px; transition: all 0.2s; display: inline-flex; align-items: center; justify-content: center; min-width: 70px; white-space: nowrap; }
    .btn-approve { background: #22c55e; color: white; }
    .btn-approve:hover { background: #16a34a; }
    .btn-block { background: #ef4444; color: white; }
    .btn-block:hover { background: #dc2626; }
    .btn-unblock { background: #0ea5e9; color: white; }
    .btn-unblock:hover { background: #0284c7; }
    .btn-edit { background: #6366f1; color: white; }
    .btn-edit:hover { background: #4f46e5; }
    .modal { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.7); z-index: 1000; align-items: center; justify-content: center; }
    .modal.active { display: flex; }
    .modal-content { background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border: 1px solid #334155; border-radius: 12px; padding: 30px; max-width: 500px; width: 90%; max-height: 90vh; overflow-y: auto; }
    .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
    .modal-header h2 { color: #f1f5f9; font-size: 20px; }
    .modal-close { background: none; border: none; color: #94a3b8; font-size: 24px; cursor: pointer; padding: 0; width: 30px; height: 30px; }
    .modal-close:hover { color: #e2e8f0; }
    .form-group { margin-bottom: 20px; }
    .form-group label { display: block; color: #94a3b8; font-size: 14px; margin-bottom: 8px; font-weight: 500; }
    .form-group input, .form-group select { width: 100%; padding: 10px 14px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #e2e8f0; font-size: 14px; }
    .form-group input:focus, .form-group select:focus { outline: none; border-color: #0ea5e9; box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.1); }
    .form-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 24px; }
    .form-actions button { padding: 10px 20px; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500; }
    .btn-cancel { background: #64748b; color: white; }
    .btn-cancel:hover { background: #475569; }
    .btn-save { background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%); color: white; }
    .btn-save:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(14, 165, 233, 0.3); }
    .json-viewer { background: #0f172a; padding: 16px; border-radius: 6px; font-family: 'Courier New', monospace; font-size: 12px; max-height: 400px; overflow-y: auto; white-space: pre-wrap; word-break: break-all; }
    .machines-list { max-height: 300px; overflow-y: auto; }
    .machine-item { padding: 10px; background: #0f172a; border-radius: 6px; margin-bottom: 8px; border: 1px solid #334155; }
    .machine-item code { display: block; margin-bottom: 6px; color: #0ea5e9; }
    .machine-item .info { font-size: 12px; color: #94a3b8; }
    .clickable { cursor: pointer; color: #0ea5e9; }
    .clickable:hover { text-decoration: underline; }
    .icon-btn { padding: 8px 10px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #e2e8f0; cursor: pointer; }
    .icon-btn:hover { border-color: #0ea5e9; }
    .field-row { display: flex; gap: 8px; align-items: center; }
    .field-text { color: #e2e8f0; word-break: break-word; }
    /* Toggle switch */
    .toggle-switch { position: relative; display: inline-block; width: 44px; height: 24px; vertical-align: middle; }
    .toggle-switch input { opacity: 0; width: 0; height: 0; }
    .toggle-slider { position: absolute; inset: 0; background: #334155; border-radius: 24px; transition: .3s; cursor: pointer; }
    .toggle-slider:before { content: ""; position: absolute; height: 18px; width: 18px; left: 3px; bottom: 3px; background: white; border-radius: 50%; transition: .3s; }
    .toggle-switch input:checked + .toggle-slider { background: #22c55e; }
    .toggle-switch input:checked + .toggle-slider:before { transform: translateX(20px); }
    /* Dropdown actions */
    .action-dropdown { position: relative; display: inline-block; }
    .action-dropdown-btn { padding: 6px 14px; background: #334155; border: 1px solid #475569; border-radius: 6px; color: #e2e8f0; cursor: pointer; font-size: 13px; display: flex; align-items: center; gap: 6px; }
    .action-dropdown-btn:hover { background: #475569; }
    .action-dropdown-menu { display: none; position: absolute; right: 0; top: 100%; margin-top: 4px; background: #1e293b; border: 1px solid #334155; border-radius: 8px; min-width: 180px; z-index: 50; box-shadow: 0 8px 24px rgba(0,0,0,0.4); overflow: hidden; }
    .action-dropdown.open .action-dropdown-menu { display: block; }
    .action-dropdown-item { display: flex; align-items: center; gap: 8px; padding: 10px 14px; color: #e2e8f0; cursor: pointer; font-size: 13px; transition: background 0.15s; border: none; background: none; width: 100%; text-align: left; }
    .action-dropdown-item:hover { background: rgba(14,165,233,0.1); }
    .action-dropdown-item.danger { color: #ef4444; }
    .action-dropdown-item.danger:hover { background: rgba(239,68,68,0.1); }
    .action-dropdown-divider { height: 1px; background: #334155; margin: 4px 0; }
  </style>
</head>
<body>
  <div id="authOverlay" class="auth-overlay">
    <div id="authForm" class="auth-form">
      <div class="auth-logo">93</div>
      <h2>93 Media Tool</h2>
      <p class="auth-subtitle">Dang nhap bang quan tri</p>
      <label class="auth-field-label" for="emailInput">Email</label>
      <div class="auth-input-wrapper">
        <input type="email" id="emailInput" placeholder="admin@example.com" autocomplete="username">
      </div>
      <label class="auth-field-label" for="tokenInput">Mat khau</label>
      <div class="auth-input-wrapper">
        <input type="password" id="tokenInput" placeholder="Nhap mat khau..." autocomplete="current-password">
        <button type="button" id="tokenToggleBtn" class="toggle-btn" onclick="toggleTokenVisibility()" title="Hien/an mat khau">Show</button>
      </div>
      <div id="authError" class="error hidden" style="margin-top: 12px; margin-bottom: 0;"></div>
      <button id="loginButton">Dang Nhap</button>
    </div>
  </div>
  <div id="dashboard" class="app-layout hidden">
    <!-- LEFT SIDEBAR -->
    <nav class="sidebar" id="sidebar">
      <div class="sidebar-brand">
        <h1>🛡️ 93 Media</h1>
        <div class="brand-sub">Admin Dashboard</div>
      </div>

      <div class="sidebar-group" data-owner-only="true">
        <div class="sidebar-group-title">TONG QUAN</div>
        <div class="sidebar-item active" onclick="switchTab('events')" data-tab="events"><span class="icon">D</span> Dashboard</div>
        <div class="sidebar-item" onclick="switchTab('top')" data-tab="top"><span class="icon">T</span> Top Users & May</div>
      </div>

      <div class="sidebar-group">
        <div class="sidebar-group-title">NGUOI DUNG</div>
        <div class="sidebar-item" onclick="switchTab('users')" data-tab="users"><span class="icon">U</span> Quan Ly Nguoi Dung</div>
        <div class="sidebar-item" onclick="switchTab('licenses')" data-tab="licenses"><span class="icon">K</span> Quan Ly License</div>
      </div>

      <div class="sidebar-group" data-owner-only="true">
        <div class="sidebar-group-title">BAO MAT</div>
        <div class="sidebar-item" onclick="switchTab('auditLogs')" data-tab="auditLogs"><span class="icon">L</span> Log Xac Thuc</div>
        <div class="sidebar-item" onclick="switchTab('autoBlock')" data-tab="autoBlock"><span class="icon">S</span> Giam Sat Bao Mat</div>
      </div>

      <div class="sidebar-group" data-owner-only="true">
        <div class="sidebar-group-title">NHAT KY</div>
        <div class="sidebar-item" onclick="switchTab('activity')" data-tab="activity"><span class="icon">A</span> Log Admin</div>
        <div class="sidebar-item" onclick="switchTab('admins')" data-tab="admins"><span class="icon">M</span> Quan Ly Admin</div>
      </div>

      <div class="sidebar-footer" data-owner-only="true">
        <div class="sidebar-group-title">HE THONG</div>
        <div class="sidebar-item" onclick="switchTab('versionPolicy')" data-tab="versionPolicy"><span class="icon">V</span> Phien Ban</div>
        <div class="sidebar-item" onclick="switchTab('settings')" data-tab="settings"><span class="icon">C</span> Cai Dat</div>
      </div>
    </nav>

    <!-- MAIN CONTENT -->
    <div class="main-content">
      <div class="container">
        <div class="header">
          <div class="header-info">Cập nhật lần cuối: <span id="lastUpdate">-</span></div>
        </div>
    <div id="eventsTab" class="tab-content active">
    <div class="controls">
      <select id="severityFilter">
        <option value="">Tất cả mức độ</option>
        <option value="critical">Nghiêm trọng</option>
        <option value="high">Cao</option>
        <option value="medium">Trung bình</option>
        <option value="low">Thấp</option>
      </select>
      <select id="eventTypeFilter">
        <option value="">Tất cả loại sự kiện</option>
      </select>
      <input type="number" id="hoursFilter" value="24" min="1" max="168" placeholder="Giờ">
      <button onclick="refreshData()">Làm mới</button>
      <button onclick="autoRefresh()">Tự động: <span id="autoRefreshStatus">TẮT</span></button>
      <button onclick="exportEvents('csv')" style="background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);">Xuất CSV</button>
      <button onclick="exportEvents('json')" style="background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);">Xuất JSON</button>
    </div>
    <div id="errorContainer"></div>
    <div class="stats-grid">
      <div class="stat-card total">
        <h3>Tổng sự kiện</h3>
        <div class="value" id="totalEvents">-</div>
        <div class="label" id="totalEventsLabel">trong 24 giờ qua</div>
      </div>
      <div class="stat-card critical">
        <h3>Nghiêm trọng</h3>
        <div class="value" id="criticalCount">-</div>
        <div class="label">cần xử lý ngay</div>
      </div>
      <div class="stat-card high">
        <h3>Cao</h3>
        <div class="value" id="highCount">-</div>
        <div class="label">ưu tiên xử lý</div>
      </div>
      <div class="stat-card medium">
        <h3>Trung bình</h3>
        <div class="value" id="mediumCount">-</div>
        <div class="label">theo dõi</div>
      </div>
      <div class="stat-card low">
        <h3>Thấp</h3>
        <div class="value" id="lowCount">-</div>
        <div class="label">thông tin</div>
      </div>
    </div>
    <div class="chart-container">
        <h2>Phân tích theo loại sự kiện</h2>
        <div id="typeChartEmpty" class="chart-empty hidden">Không có dữ liệu trong khoảng thời gian đã chọn</div>
        <canvas id="typeChart" style="max-height: 300px;"></canvas>
    </div>
    <div class="chart-container">
      <h2>Phân tích theo mức độ</h2>
      <div id="severityChartEmpty" class="chart-empty hidden">Không có dữ liệu trong khoảng thời gian đã chọn</div>
      <canvas id="severityChart" style="max-height: 300px;"></canvas>
    </div>
    <div class="chart-container">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <h2 style="margin: 0;">Xu hướng theo thời gian</h2>
        <div style="display: flex; gap: 10px; align-items: center;">
          <select id="timelineGroupBy" onchange="loadTimeline()" style="padding: 8px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #e2e8f0; font-size: 12px;">
            <option value="hour">Theo giờ</option>
            <option value="day" selected>Theo ngày</option>
            <option value="week">Theo tuần</option>
          </select>
        </div>
      </div>
      <div id="timelineTrend" style="margin-bottom: 15px; padding: 12px; background: #0f172a; border-radius: 8px; border: 1px solid #334155;">
        <div style="display: flex; gap: 20px; align-items: center;">
          <div>
            <div style="font-size: 12px; color: #94a3b8; margin-bottom: 4px;">Xu hướng</div>
            <div id="timelineTrendValue" style="font-size: 18px; font-weight: 600; color: #0ea5e9;">-</div>
          </div>
          <div>
            <div style="font-size: 12px; color: #94a3b8; margin-bottom: 4px;">Kỳ hiện tại</div>
            <div id="timelineCurrentCount" style="font-size: 18px; font-weight: 600; color: #22c55e;">-</div>
          </div>
          <div>
            <div style="font-size: 12px; color: #94a3b8; margin-bottom: 4px;">Kỳ trước</div>
            <div id="timelinePreviousCount" style="font-size: 18px; font-weight: 600; color: #64748b;">-</div>
          </div>
        </div>
      </div>
      <div id="timelineChartEmpty" class="chart-empty hidden">Không có dữ liệu xu hướng trong khoảng thời gian đã chọn</div>
      <canvas id="timelineChart" style="max-height: 400px;"></canvas>
    </div>
    <div class="events-table">
      <table>
        <thead>
          <tr>
            <th>Thời gian</th>
            <th>Loại sự kiện</th>
            <th>Mức độ</th>
            <th>Thông điệp</th>
            <th>Mã máy</th>
            <th>Người dùng</th>
            <th>Phiên bản</th>
            <th>Chi tiết</th>
          </tr>
        </thead>
        <tbody id="eventsTableBody">
          <tr><td colspan="8" class="loading">Đang tải dữ liệu...</td></tr>
        </tbody>
      </table>
    </div>
    </div>
    <div id="usersTab" class="tab-content">
      <div class="controls">
        <input type="text" id="userSearchInput" placeholder="🔍 Tìm kiếm (tài khoản, mã máy)..." style="flex: 1; min-width: 200px;">
        <select id="userStatusFilter">
          <option value="">Tất cả Trạng Thái</option>
          <option value="CHO_DUYET">Chờ Duyệt</option>
          <option value="CHO_PHEP">Đã Cho Phép</option>
          <option value="CHAN">Đã Chặn</option>
        </select>
        <button onclick="loadUsers()">🔄 Làm Mới</button>
        <button onclick="exportUsers('csv')" style="background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);">📥 Xuất CSV</button>
        <button onclick="exportUsers('json')" style="background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);">📥 Xuất JSON</button>
      </div>
      <div id="bulkActionsBar" style="display: none; background: #1e293b; padding: 12px; border-radius: 8px; margin-bottom: 15px; border: 1px solid #334155;">
        <span id="selectedCount" style="color: #0ea5e9; font-weight: 600; margin-right: 15px;">0 đã chọn</span>
        <button onclick="bulkUpdateUsers('CHO_PHEP')" class="action-btn btn-approve" style="margin: 0 5px;">✅ Duyệt Hàng Loạt</button>
        <button onclick="bulkUpdateUsers('CHAN')" class="action-btn btn-block" style="margin: 0 5px;">🚫 Chặn Hàng Loạt</button>
        <button onclick="bulkUpdateUsers('CHO_DUYET')" class="action-btn" style="background: #eab308; color: white; margin: 0 5px;">⏸️ Về Chờ Duyệt</button>
        <button onclick="clearSelection()" style="background: #64748b; color: white; padding: 6px 12px; border: none; border-radius: 6px; cursor: pointer; margin-left: 10px;">✖️ Bỏ Chọn</button>
      </div>
      <div class="events-table">
        <table>
          <thead>
          <tr>
            <th style="width: 40px;"><input type="checkbox" id="selectAllUsers" onchange="toggleSelectAll()"></th>
            <th>Tài Khoản</th>
            <th>Mật Khẩu</th>
            <th>Mã Máy</th>
            <th>Trạng Thái</th>
            <th>Số Máy</th>
            <th>Key Kích Hoạt</th>
            <th>Trạng Thái Key</th>
            <th>Hoạt Động Cuối</th>
            <th style="width: 100px; text-align: center;">Phiên Bản</th>
            <th style="width: 150px; text-align: center;">Thao Tác</th>
          </tr>
          </thead>
          <tbody id="usersTableBody">
            <tr><td colspan="11" class="loading">Đang tải dữ liệu...</td></tr>
          </tbody>
        </table>
      </div>
      <div id="usersPagination" style="display: flex; justify-content: space-between; align-items: center; margin-top: 20px; padding: 15px; background: #1e293b; border-radius: 8px; border: 1px solid #334155;">
        <div style="color: #94a3b8; font-size: 14px;">
          <span id="usersPaginationInfo">Hiển thị 0-0 / 0</span>
        </div>
        <div style="display: flex; gap: 10px;">
          <button onclick="changeUsersPage(-1)" id="usersPrevBtn" style="padding: 8px 16px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #e2e8f0; cursor: pointer;">◀ Trước</button>
          <span id="usersPageNumbers" style="display: flex; gap: 5px; align-items: center;"></span>
          <button onclick="changeUsersPage(1)" id="usersNextBtn" style="padding: 8px 16px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #e2e8f0; cursor: pointer;">Sau ▶</button>
        </div>
        <select id="usersPageSize" onchange="loadUsers()" style="padding: 8px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #e2e8f0;">
          <option value="10">10 / trang</option>
          <option value="25" selected>25 / trang</option>
          <option value="50">50 / trang</option>
          <option value="100">100 / trang</option>
        </select>
      </div>
    </div>
    <div id="topTab" class="tab-content">
      <div class="controls">
        <input type="number" id="topHoursFilter" value="24" min="1" max="168" placeholder="Giờ">
        <button onclick="loadTopData()">Làm mới</button>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px;">
        <div class="chart-container">
          <h2>Máy có nhiều sự kiện nhất</h2>
          <div id="topMachinesList" class="loading">Đang tải...</div>
        </div>
        <div class="chart-container">
          <h2>Người dùng có nhiều sự kiện nhất</h2>
          <div id="topUsernamesList" class="loading">Đang tải...</div>
        </div>
      </div>
      <div class="chart-container" style="margin-top: 20px;">
        <h2>Máy sử dụng app nhiều nhất</h2>
        <div id="topMachinesByUsageList" class="loading">Đang tải...</div>
      </div>
      <div class="chart-container" style="margin-top: 20px;">
        <h2>Người dùng xuất video nhiều nhất</h2>
        <div id="topUsersVideoExportsList" class="loading">Đang tải...</div>
      </div>
    </div>
    <div id="activityTab" class="tab-content">
      <div class="controls">
        <select id="activityActionFilter">
          <option value="">Tất cả Hành Động</option>
          <option value="approve">Duyệt</option>
          <option value="block">Chặn</option>
          <option value="unblock">Bỏ Chặn</option>
          <option value="edit">Chỉnh Sửa</option>
          <option value="bulk_approve">Duyệt Hàng Loạt</option>
          <option value="bulk_block">Chặn Hàng Loạt</option>
          <option value="bulk_unblock">Bỏ Chặn Hàng Loạt</option>
          <option value="revoke_key">Thu Hồi Key</option>
          <option value="regenerate_key">Tạo Lại Key</option>
        </select>
        <select id="activityTargetFilter">
          <option value="">Tất cả Đối Tượng</option>
          <option value="user">Người Dùng</option>
          <option value="license">License</option>
          <option value="system">Hệ Thống</option>
        </select>
        <input type="number" id="activityHoursFilter" value="24" min="1" max="168" placeholder="Giờ">
        <button onclick="loadActivityLog()">🔄 Làm Mới</button>
      </div>
      <div class="events-table">
        <table>
          <thead>
            <tr>
              <th>Thời Gian</th>
              <th>Hành Động</th>
              <th>Đối Tượng</th>
              <th>Tên</th>
              <th>Giá Trị Cũ</th>
              <th>Giá Trị Mới</th>
              <th>IP Admin</th>
            </tr>
          </thead>
          <tbody id="activityTableBody">
            <tr><td colspan="7" class="loading">Đang tải dữ liệu...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
    <div id="auditLogsTab" class="tab-content">
      <div class="controls">
        <select id="auditEventTypeFilter">
          <option value="">Tất cả Loại</option>
          <option value="REGISTER">Đăng Ký</option>
          <option value="APPROVE">Duyệt</option>
          <option value="KEY_VALIDATE">Xác Thực Key</option>
          <option value="KEY_FAIL">Key Sai</option>
          <option value="KEY_LOCK">Key Bị Khóa</option>
          <option value="KEY_UNLOCK">Mở Khóa Key</option>
          <option value="KEY_REVOKE">Thu Hồi Key</option>
          <option value="LOGIN">Đăng Nhập</option>
          <option value="LOGOUT">Đăng Xuất</option>
          <option value="TAMPER">Tamper Detection</option>
          <option value="MACHINE_REBIND">Đổi Máy</option>
        </select>
        <select id="auditSeverityFilter">
          <option value="">Tất cả Mức Độ</option>
          <option value="info">Info</option>
          <option value="warning">Warning</option>
          <option value="error">Error</option>
          <option value="critical">Critical</option>
        </select>
        <input type="text" id="auditUsernameFilter" placeholder="🔍 Username..." style="flex: 1; min-width: 150px;">
        <input type="text" id="auditMachineIdFilter" placeholder="🔍 Machine ID..." style="flex: 1; min-width: 150px;">
        <input type="number" id="auditHoursFilter" value="24" min="1" max="168" placeholder="Giờ">
        <button onclick="loadAuditLogs()">🔄 Làm Mới</button>
      </div>
      <div class="events-table">
        <table>
          <thead>
            <tr>
              <th>Thời Gian</th>
              <th>Username</th>
              <th>Loại Sự Kiện</th>
              <th>Mức Độ</th>
              <th>IP Address</th>
              <th>Machine ID</th>
              <th>Key Kích Hoạt</th>
              <th>Chi Tiết</th>
            </tr>
          </thead>
          <tbody id="auditLogsTableBody">
            <tr><td colspan="8" class="loading">Đang tải dữ liệu...</td></tr>
          </tbody>
        </table>
      </div>
      <div id="auditLogsPagination" style="display: flex; justify-content: space-between; align-items: center; margin-top: 20px; padding: 15px; background: #1e293b; border-radius: 8px; border: 1px solid #334155;">
        <div style="color: #94a3b8; font-size: 14px;">
          <span id="auditLogsPaginationInfo">Hiển thị 0-0 / 0</span>
        </div>
        <div style="display: flex; gap: 10px;">
          <button onclick="changeAuditLogsPage(-1)" id="auditLogsPrevBtn" style="padding: 8px 16px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #e2e8f0; cursor: pointer;">◀ Trước</button>
          <span id="auditLogsPageNumbers" style="display: flex; gap: 5px; align-items: center;"></span>
          <button onclick="changeAuditLogsPage(1)" id="auditLogsNextBtn" style="padding: 8px 16px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #e2e8f0; cursor: pointer;">Sau ▶</button>
        </div>
        <select id="auditLogsPageSize" onchange="loadAuditLogs()" style="padding: 8px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #e2e8f0;">
          <option value="25" selected>25 / trang</option>
          <option value="50">50 / trang</option>
          <option value="100">100 / trang</option>
        </select>
      </div>
    </div>
    <div id="licensesTab" class="tab-content">
      <div class="controls">
        <input type="text" id="licenseSearchInput" placeholder="🔍 Tìm kiếm (key, username)..." style="flex: 1; min-width: 200px;">
        <button onclick="loadLicenses()">🔄 Làm Mới</button>
      </div>
      <div class="events-table">
        <table>
          <thead>
            <tr>
              <th>Key Kích Hoạt</th>
            <th>Trạng Thái Key</th>
              <th>Người Dùng</th>
              <th>Mật Khẩu</th>
              <th>Mã Máy</th>
              <th>Trạng Thái</th>
              <th>Ngày Tạo</th>
              <th>Thao Tác</th>
            </tr>
          </thead>
          <tbody id="licensesTableBody">
            <tr><td colspan="8" class="loading">Đang tải dữ liệu...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
    <div id="adminsTab" class="tab-content">
      <div class="chart-container">
        <h2>Tao Admin Moi</h2>
        <div class="field-row" style="gap: 8px; align-items: center; flex-wrap: wrap;">
          <input type="email" id="newAdminEmail" placeholder="email@gmail.com" style="flex: 1; min-width: 220px;">
          <input type="password" id="newAdminPassword" placeholder="Mat khau admin moi" style="flex: 1; min-width: 220px;">
          <button type="button" class="action-btn btn-approve" onclick="createAdminAccount()">Tao Admin</button>
        </div>
        <div id="createAdminStatus" class="error hidden" style="margin-top: 10px;"></div>
        <p style="font-size: 12px; color: #94a3b8; margin-top: 8px;">Tai khoan do owner tao se duoc kich hoat ngay, khong can cho duyet.</p>
      </div>
      <div class="controls">
        <button onclick="loadAdmins()">Lam Moi</button>
      </div>
      <div class="events-table">
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Trang Thai</th>
              <th>Ngay Tao</th>
              <th>Lan Dang Nhap Cuoi</th>
              <th>Thao Tac</th>
            </tr>
          </thead>
          <tbody id="adminsTableBody">
            <tr><td colspan="6" class="loading">Dang tai...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
    <div id="settingsTab" class="tab-content">
      <div class="chart-container">
        <h2>🔑 Admin Token (mở lại khi quên)</h2>
        <p style="color: #94a3b8; font-size: 13px; margin-bottom: 12px;">Token đang dùng để đăng nhập dashboard. Dùng khi cần copy lại hoặc kiểm tra.</p>
        <div class="field-row" style="gap: 8px; align-items: center; flex-wrap: wrap;">
          <input type="password" id="settingsTokenInput" readonly style="flex: 1; min-width: 200px;" value="">
          <button type="button" class="icon-btn" id="settingsTokenToggleBtn" onclick="toggleSettingsTokenVisibility()" title="Hiện/ẩn token">👁️</button>
          <button type="button" class="action-btn btn-approve" onclick="copySettingsToken()">📋 Copy</button>
        </div>
        <p style="font-size: 12px; color: #64748b; margin-top: 8px;">Token được lưu trong trình duyệt (localStorage). Khi đăng xuất hoặc xóa cookie/storage sẽ mất — set lại bằng <code>wrangler secret put ADMIN_TOKEN</code>.</p>
      </div>
      <div class="chart-container">
        <h2>📧 Cấu Hình Email Alerts</h2>
        <div style="margin-bottom: 20px;">
          <label style="display: flex; align-items: center; gap: 10px; margin-bottom: 15px;">
            <label class="toggle-switch"><input type="checkbox" id="emailAlertsEnabled" onchange="saveAlertSettings()"><span class="toggle-slider"></span></label>
            <span>Bật Email Alerts</span>
          </label>
          <div class="form-group">
            <label>Email Nhận Cảnh Báo</label>
            <input type="email" id="alertEmail" placeholder="your-email@example.com" onchange="saveAlertSettings()">
          </div>
          <div class="form-group">
            <label>Ngưỡng Cảnh Báo (số events)</label>
            <input type="number" id="alertThreshold" value="10" min="1" onchange="saveAlertSettings()">
          </div>
          <div class="form-group">
            <label>Tần Suất Cảnh Báo</label>
            <select id="alertFrequency" onchange="saveAlertSettings()">
              <option value="realtime">Real-time</option>
              <option value="hourly">Mỗi Giờ</option>
              <option value="daily" selected>Hàng Ngày</option>
            </select>
          </div>
        </div>
      </div>
      <div class="chart-container">
        <h2>🔔 Cấu Hình Webhook Alerts</h2>
        <div style="margin-bottom: 20px;">
          <label style="display: flex; align-items: center; gap: 10px; margin-bottom: 15px;">
            <label class="toggle-switch"><input type="checkbox" id="webhookAlertsEnabled" onchange="saveAlertSettings()"><span class="toggle-slider"></span></label>
            <span>Bật Webhook Alerts</span>
          </label>
          <div class="form-group">
            <label>Webhook URL (Discord/Slack)</label>
            <input type="url" id="webhookUrl" placeholder="https://discord.com/api/webhooks/..." onchange="saveAlertSettings()">
          </div>
        </div>
      </div>
      <div class="chart-container">
        <h2>🎯 Cấu Hình Alert Cho Từng Loại Event</h2>
        <div id="eventTypeAlerts" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 15px;">
          <!-- Will be populated by JavaScript -->
        </div>
      </div>
    </div>
    <div id="versionPolicyTab" class="tab-content">
      <div class="controls">
        <button onclick="loadVersionPolicy()">🔄 Làm Mới</button>
        <button onclick="saveVersionPolicy()" style="background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);">💾 Lưu Cấu Hình</button>
      </div>
      <div id="versionPolicyError" class="error hidden" style="margin-bottom: 20px;"></div>
      <div class="chart-container">
        <h2>📦 Cấu Hình Phiên Bản (Version Policy)</h2>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px;">
          <div class="form-group">
            <label>Phiên Bản Stable Mới Nhất</label>
            <input type="text" id="policyLatestVersion" placeholder="4.1.0" pattern="^\\d+\\.\\d+\\.\\d+$">
            <div style="font-size: 12px; color: #94a3b8; margin-top: 4px;">Format: x.y.z (ví dụ: 4.1.0)</div>
          </div>
          <div class="form-group">
            <label>Phiên Bản Tối Thiểu Hỗ Trợ</label>
            <input type="text" id="policyMinSupportedVersion" placeholder="4.1.0" pattern="^\\d+\\.\\d+\\.\\d+$">
          </div>
        </div>
        <div class="form-group">
          <label>Phiên Bản Đề Xuất</label>
          <input type="text" id="policyRecommendedVersion" placeholder="4.1.0" pattern="^\\d+\\.\\d+\\.\\d+$">
        </div>
        <div class="form-group">
          <label>URL Installer Đề Xuất (Optional)</label>
          <input type="url" id="policyRecommendedInstallerUrl" placeholder="https://license-updates.pages.dev/win/93-media-tool-mix-nhac-setup-4.1.0.exe" style="width: 100%;">
        </div>
        <div class="form-group">
          <label>Phiên Bản Bị Chặn (Blocked Versions)</label>
          <textarea id="policyBlockedVersions" placeholder="3.5.0, 3.5.1" style="width: 100%; min-height: 80px; padding: 10px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #e2e8f0; font-family: monospace; font-size: 13px;"></textarea>
          <div style="font-size: 12px; color: #94a3b8; margin-top: 4px;">Nhập các version bị chặn, cách nhau bởi dấu phẩy (ví dụ: 3.5.0, 3.5.1)</div>
        </div>
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 20px;">
          <label class="toggle-switch"><input type="checkbox" id="policyForceUpdate"><span class="toggle-slider"></span></label>
          <label for="policyForceUpdate" style="margin: 0; cursor: pointer;">🔒 Force Update (Bắt buộc cập nhật cho version cũ)</label>
        </div>
        <div class="form-group">
          <label>Thông Điệp (Optional)</label>
          <textarea id="policyMessage" placeholder="Thông điệp hiển thị cho user..." style="width: 100%; min-height: 60px; padding: 10px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #e2e8f0;"></textarea>
        </div>
      </div>
      <div class="chart-container" style="margin-top: 20px;">
        <h2>🧪 Cấu Hình Beta Channel</h2>
        <div class="form-group">
          <label>Phiên Bản Beta Mới Nhất</label>
          <input type="text" id="policyBetaLatestVersion" placeholder="3.7.0-beta.1" pattern="^\\d+\\.\\d+\\.\\d+(-beta\\.\\d+)?$">
          <div style="font-size: 12px; color: #94a3b8; margin-top: 4px;">Format: x.y.z-beta.n (ví dụ: 3.7.0-beta.1) hoặc để trống nếu không có beta</div>
        </div>
        <div class="form-group">
          <label>URL Beta Updates (Optional)</label>
          <input type="url" id="policyBetaUpdateUrl" placeholder="https://license-updates.pages.dev/beta/win/" style="width: 100%;">
          <div style="font-size: 12px; color: #94a3b8; margin-top: 4px;">Mặc định: https://license-updates.pages.dev/beta/win/</div>
        </div>
        <div class="form-group">
          <label>Phiên Bản Beta Bị Chặn (Beta Blocked Versions)</label>
          <textarea id="policyBetaBlockedVersions" placeholder="3.7.0-beta.1" style="width: 100%; min-height: 60px; padding: 10px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #e2e8f0; font-family: monospace; font-size: 13px;"></textarea>
          <div style="font-size: 12px; color: #94a3b8; margin-top: 4px;">Nhập các beta version bị chặn, cách nhau bởi dấu phẩy</div>
        </div>
      </div>
      <div class="chart-container" style="margin-top: 20px; background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border: 1px solid #334155;">
        <h2>📋 Xem Trước Policy Hiện Tại</h2>
        <div id="versionPolicyPreview" class="json-viewer" style="max-height: 300px; overflow-y: auto;">Đang tải...</div>
      </div>
    </div>
    <!-- Auto Block Tab (promoted from modal to tab) -->
    <div id="autoBlockTab" class="tab-content">
      <h2 class="page-title">🛡️ Quy Tắc Tự Động Chặn</h2>
      <div id="autoBlockTabContent"><div class="loading">Đang tải...</div></div>
    </div>

    <!-- MODALS (outside main-content flow) -->
    <div id="keyModal" class="modal">
      <div class="modal-content">
        <div class="modal-header">
          <h2>🔑 Key Kích Hoạt</h2>
          <button class="modal-close" onclick="closeKeyModal()">&times;</button>
        </div>
        <div class="form-group">
          <label>Key đã được tạo cho người dùng:</label>
          <div class="field-row">
            <code id="keyModalKey" class="field-text" style="flex: 1; font-size: 14px; padding: 12px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #0ea5e9; word-break: break-all;">-</code>
            <button type="button" class="icon-btn" onclick="copyKeyModal()" style="padding: 12px 16px; font-size: 14px;">📋 Copy</button>
          </div>
        </div>
        <div style="background: #1e293b; padding: 16px; border-radius: 8px; border: 1px solid #334155; margin-top: 20px;">
          <div style="color: #94a3b8; font-size: 13px; margin-bottom: 8px;">💡 Hướng dẫn:</div>
          <div style="color: #e2e8f0; font-size: 12px; line-height: 1.6;">
            Copy key này và gửi cho người dùng. Họ sẽ cần nhập key này vào app để kích hoạt tài khoản.
          </div>
        </div>
        <div class="form-actions">
          <button type="button" class="btn-save" onclick="closeKeyModal()">Đóng</button>
        </div>
      </div>
    </div>
    <div id="editModal" class="modal">
      <div class="modal-content">
        <div class="modal-header">
          <h2>✏️ Chỉnh Sửa Người Dùng</h2>
          <button class="modal-close" onclick="closeEditModal()">&times;</button>
        </div>
        <form id="editUserForm" onsubmit="saveUserEdit(event)">
          <input type="hidden" id="editUserId">
          <div class="form-group">
            <label>Tài Khoản</label>
            <input type="text" id="editTaiKhoan" required>
          </div>
          <div class="form-group">
            <label>Mật Khẩu</label>
            <input type="password" id="editMatKhau" placeholder="Để trống nếu không đổi">
          </div>
          <div class="form-group">
            <label>Mã Máy</label>
            <input type="text" id="editMaMay" required>
          </div>
          <div class="form-group">
            <label>Trạng Thái</label>
            <select id="editTrangThai" required style="width: 100%; padding: 8px; border-radius: 6px; border: 1px solid #334155; background: #1e293b; color: #f1f5f9;">
              <option value="CHO_DUYET">Chờ Duyệt</option>
              <option value="CHO_PHEP">Đã Cho Phép</option>
              <option value="CHAN">Đã Chặn</option>
            </select>
          </div>
          <div class="form-group">
            <label>Hạn Sử Dụng <span style="font-size: 11px; color: #64748b;">(Để trống = vĩnh viễn)</span></label>
            <div class="field-row" style="gap: 8px;">
              <input type="datetime-local" id="editLicenseExpiresAt" style="flex: 1; padding: 8px; border-radius: 6px; border: 1px solid #334155; background: #1e293b; color: #f1f5f9;">
              <button type="button" class="action-btn btn-unblock" onclick="document.getElementById('editLicenseExpiresAt').value = ''" style="padding: 8px 12px; font-size: 11px;">Xóa hạn</button>
            </div>
          </div>
          <div class="form-actions">
            <button type="button" class="btn-cancel" onclick="closeEditModal()">Hủy</button>
            <button type="submit" class="btn-save">💾 Lưu</button>
          </div>
        </form>
      </div>
    </div>
    <div id="userDetailModal" class="modal">
      <div class="modal-content">
        <div class="modal-header">
          <h2>👁️ Chi Tiết Người Dùng</h2>
          <button class="modal-close" onclick="closeUserDetailModal()">&times;</button>
        </div>
        <div class="form-group">
          <label>Tài Khoản</label>
          <div id="detailTaiKhoan" class="field-text">-</div>
        </div>
        <div class="form-group">
          <label>Mã Máy</label>
          <div class="field-row">
            <code id="detailMaMay" class="field-text" style="flex: 1;">-</code>
            <button type="button" class="icon-btn" onclick="copyDetailMachine()">Copy</button>
          </div>
        </div>
        <div class="form-group">
          <label>Key Kích Hoạt</label>
          <div class="field-row">
            <code id="detailKey" class="field-text" style="flex: 1;">-</code>
            <button type="button" class="icon-btn" onclick="copyDetailKey()">Copy</button>
          </div>
        </div>
        <div class="form-group">
          <label>Mật Khẩu</label>
          <div class="field-row">
            <input type="password" id="detailMatKhau" readonly style="flex: 1; padding: 10px 14px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #e2e8f0;">
            <button type="button" class="icon-btn" onclick="togglePasswordVisibility('detailMatKhau', this)">👁️</button>
            <button type="button" class="icon-btn" onclick="copyDetailPassword()">Copy</button>
            <button type="button" class="icon-btn" onclick="currentDetailUser && resetUserPassword(currentDetailUser.id, currentDetailUser.tai_khoan)">Reset</button>
          </div>
          <div id="detailMatKhauHint" style="font-size: 12px; color: #94a3b8; margin-top: 6px; display: none;"></div>
        </div>
        <div class="form-group">
          <label>Trạng Thái</label>
          <div id="detailTrangThai" class="field-text">-</div>
        </div>
        <div class="form-group">
          <label>Phiên Bản</label>
          <div id="detailVersion" class="field-text">-</div>
        </div>
        <div class="form-group">
          <label>Ngày Tạo</label>
          <div id="detailCreated" class="field-text">-</div>
        </div>
        <div class="form-group">
          <label>Hạn Sử Dụng</label>
          <div id="detailLicenseExpiresAt" class="field-text">-</div>
          <div style="margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center;">
            <input type="datetime-local" id="detailExpiryInput" style="flex: 1; min-width: 180px; padding: 7px 10px; border-radius: 6px; border: 1px solid #334155; background: #1e293b; color: #f1f5f9; font-size: 13px;">
            <button type="button" onclick="quickExtendLicense(30)" style="padding: 6px 10px; font-size: 11px; border-radius: 6px; border: 1px solid #334155; background: #1e3a5f; color: #93c5fd; cursor: pointer;">+30 ngày</button>
            <button type="button" onclick="quickExtendLicense(90)" style="padding: 6px 10px; font-size: 11px; border-radius: 6px; border: 1px solid #334155; background: #1e3a5f; color: #93c5fd; cursor: pointer;">+90 ngày</button>
            <button type="button" onclick="quickExtendLicense(365)" style="padding: 6px 10px; font-size: 11px; border-radius: 6px; border: 1px solid #334155; background: #1e3a5f; color: #93c5fd; cursor: pointer;">+1 năm</button>
            <button type="button" onclick="quickExtendLicense(0)" style="padding: 6px 10px; font-size: 11px; border-radius: 6px; border: 1px solid #475569; background: #1e293b; color: #94a3b8; cursor: pointer;">Vĩnh viễn</button>
          </div>
          <div style="margin-top: 6px; display: flex; gap: 6px;">
            <button type="button" onclick="saveDetailExpiry()" style="flex: 1; padding: 8px; font-size: 12px; border-radius: 6px; border: none; background: #22c55e; color: #fff; cursor: pointer; font-weight: 600;">💾 Lưu hạn sử dụng</button>
          </div>
        </div>
      </div>
    </div>
    <div id="eventDetailsModal" class="modal">
      <div class="modal-content">
        <div class="modal-header">
          <h2>📋 Chi Tiết Sự Kiện</h2>
          <button class="modal-close" onclick="closeEventDetailsModal()">&times;</button>
        </div>
        <div id="eventDetailsContent" class="json-viewer"></div>
      </div>
    </div>
    <div id="userMachinesModal" class="modal">
      <div class="modal-content">
        <div class="modal-header">
          <h2>🖥️ Máy Của Người Dùng</h2>
          <button class="modal-close" onclick="closeUserMachinesModal()">&times;</button>
        </div>
        <div id="userMachinesContent" class="machines-list"></div>
      </div>
    </div>
    <div id="autoBlockRulesModal" class="modal">
      <div class="modal-content" style="max-width: 700px;">
        <div class="modal-header">
          <h2>🛡️ Quy Tắc Tự Động Chặn</h2>
          <button class="modal-close" onclick="closeAutoBlockRulesModal()">&times;</button>
        </div>
        <div id="autoBlockRulesContent"></div>
      </div>
    </div>
      </div> <!-- /.container -->
    </div> <!-- /.main-content -->
  </div> <!-- /.app-layout #dashboard -->
  <script>
    const API_BASE = window.location.origin
    let ADMIN_TOKEN = localStorage.getItem('admin_session_token') || localStorage.getItem('admin_token') || ''
    let CURRENT_ADMIN = null
    let typeChart = null, severityChart = null, timelineChart = null, autoRefreshInterval = null
    let currentDetailUser = null
    // FIX: Store passwords in JS Map instead of DOM data-attributes to prevent DOM-snooping
    const _pwdStore = new Map()
    
    // Format số với dấu phẩy
    function formatNumber(num) {
      return num.toString().replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',')
    }

    // Escape HTML entities để chống XSS
    function escapeHtml(str) {
      if (!str) return ''
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
    }

    function shortId(value, max = 24) {
      const text = String(value || '')
      if (!text) return '-'
      return text.length > max ? text.slice(0, max) + '...' : text
    }

    // FIX XSS: Escape string for safe embedding inside JS single-quoted strings in onclick attrs.
    // escapeHtml is NOT safe for onclick because HTML parser decodes &#39; back to ' before JS runs.
    // This converts dangerous chars to JS hex escapes that survive the HTML→JS pipeline.
    // charCode: 39=single-quote 34=double-quote 60=less-than 62=greater-than 38=ampersand 92=backslash
    function escapeForJsString(str) {
      if (!str) return ''
      var result = ''
      for (var i = 0; i < str.length; i++) {
        var c = str.charCodeAt(i)
        if (c === 39 || c === 34 || c === 60 || c === 62 || c === 38 || c === 92) {
          result += String.fromCharCode(92) + 'x' + c.toString(16).padStart(2, '0')
        } else {
          result += str[i]
        }
      }
      return result
    }

    // Format thời gian tiếng Việt
    function formatDateTime(timestamp) {
      const date = new Date(timestamp)
      const now = new Date()
      const diff = now - date
      const minutes = Math.floor(diff / 60000)
      const hours = Math.floor(diff / 3600000)
      const days = Math.floor(diff / 86400000)
      
      if (minutes < 1) return 'Vừa xong'
      if (minutes < 60) return \`\${minutes} phút trước\`
      if (hours < 24) return \`\${hours} giờ trước\`
      if (days < 7) return \`\${days} ngày trước\`
      
      return date.toLocaleString('vi-VN', { 
        day: '2-digit', 
        month: '2-digit', 
        year: 'numeric',
        hour: '2-digit', 
        minute: '2-digit' 
      })
    }
    
    // Dịch loại sự kiện
    const eventTypeLabels = {
      'SIGNATURE_INVALID': 'Chữ Ký Không Hợp Lệ',
      'SIGNATURE_REPLAY': 'Chữ Ký Lặp Lại',
      'NONCE_REUSED': 'Nonce Đã Sử Dụng',
      'LICENSE_CHECK_FAILED': 'Kiểm Tra License Thất Bại',
      'TAMPERING_DETECTED': 'Phát Hiện Can Thiệp',
      'ANTI_DEBUG_TRIGGERED': 'Phát Hiện Debug',
      'MACHINE_ID_MISMATCH': 'Mã Máy Không Khớp',
      'ENCRYPTION_DECRYPTION_FAILED': 'Mã Hóa/Giải Mã Lỗi',
      'FILE_INTEGRITY_FAILED': 'Tính Toàn Vẹn File Lỗi',
      'RATE_LIMIT_EXCEEDED': 'Vượt Giới Hạn Tần Suất',
      'MULTIPLE_MACHINE_IDS': 'Nhiều Mã Máy',
      'TEST_DEPLOY': 'Test Deploy'
    }
    
    // Dịch mức độ
    const severityLabels = {
      'critical': 'Nghiêm Trọng',
      'high': 'Cao',
      'medium': 'Trung Bình',
      'low': 'Thấp'
    }
    
    // Dịch trạng thái user
    const statusLabels = {
      'CHO_DUYET': 'Chờ Duyệt',
      'CHO_PHEP': 'Đã Cho Phép',
      'CHAN': 'Đã Chặn'
    }
    
    // Switch tabs
    // Audit Logs pagination
    let currentAuditLogsPage = 1
    let currentAuditLogsPageSize = 25
    let currentAuditLogsTotal = 0
    
    function updateAuditLogsPagination() {
      const totalPages = Math.ceil(currentAuditLogsTotal / currentAuditLogsPageSize)
      const start = (currentAuditLogsPage - 1) * currentAuditLogsPageSize + 1
      const end = Math.min(currentAuditLogsPage * currentAuditLogsPageSize, currentAuditLogsTotal)
      document.getElementById('auditLogsPaginationInfo').textContent = \`Hiển thị \${start}-\${end} / \${currentAuditLogsTotal}\`
      
      document.getElementById('auditLogsPrevBtn').disabled = currentAuditLogsPage === 1
      document.getElementById('auditLogsNextBtn').disabled = currentAuditLogsPage >= totalPages
      
      const pageNumbers = document.getElementById('auditLogsPageNumbers')
      pageNumbers.innerHTML = ''
      
      const maxPages = 5
      let startPage = Math.max(1, currentAuditLogsPage - Math.floor(maxPages / 2))
      let endPage = Math.min(totalPages, startPage + maxPages - 1)
      if (endPage - startPage < maxPages - 1) {
        startPage = Math.max(1, endPage - maxPages + 1)
      }
      
      for (let i = startPage; i <= endPage; i++) {
        const btn = document.createElement('button')
        btn.textContent = i
        btn.style.padding = '8px 12px'
        btn.style.background = i === currentAuditLogsPage ? '#0ea5e9' : '#0f172a'
        btn.style.border = '1px solid #334155'
        btn.style.borderRadius = '6px'
        btn.style.color = '#e2e8f0'
        btn.style.cursor = 'pointer'
        btn.onclick = () => { currentAuditLogsPage = i; loadAuditLogs() }
        pageNumbers.appendChild(btn)
      }
    }
    
    function changeAuditLogsPage(delta) {
      const totalPages = Math.ceil(currentAuditLogsTotal / currentAuditLogsPageSize)
      const newPage = currentAuditLogsPage + delta
      if (newPage >= 1 && newPage <= totalPages) {
        currentAuditLogsPage = newPage
        loadAuditLogs()
      }
    }
    
    // Load audit logs
    async function loadAuditLogs() {
      try {
        const eventType = document.getElementById('auditEventTypeFilter').value
        const severity = document.getElementById('auditSeverityFilter').value
        const username = document.getElementById('auditUsernameFilter').value.trim()
        const machineId = document.getElementById('auditMachineIdFilter').value.trim()
        const hours = parseInt(document.getElementById('auditHoursFilter')?.value || '24') || 24
        currentAuditLogsPageSize = parseInt(document.getElementById('auditLogsPageSize').value) || 25
        const offset = (currentAuditLogsPage - 1) * currentAuditLogsPageSize
        
        const params = new URLSearchParams({
          hours: hours.toString(),
          limit: currentAuditLogsPageSize.toString(),
          offset: offset.toString()
        })
        if (eventType) params.append('eventType', eventType)
        if (severity) params.append('severity', severity)
        if (username) params.append('username', username)
        if (machineId) params.append('machineId', machineId)
        
        const result = await fetchWithAuth(\`\${API_BASE}/api/admin/audit-logs?\${params}\`)
        if (!result.ok) throw new Error(result.error)
        
        const tbody = document.getElementById('auditLogsTableBody')
        if (!result.logs || result.logs.length === 0) {
          tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Không có audit log nào</td></tr>'
          currentAuditLogsTotal = 0
          updateAuditLogsPagination()
          return
        }
        
        currentAuditLogsTotal = result.total || 0
        updateAuditLogsPagination()
        
        const eventTypeLabels = {
          'REGISTER': '📝 Đăng Ký',
          'APPROVE': '✅ Duyệt',
          'KEY_VALIDATE': '🔑 Xác Thực Key',
          'KEY_FAIL': '❌ Key Sai',
          'KEY_LOCK': '🔒 Key Bị Khóa',
          'KEY_UNLOCK': '🔓 Mở Khóa Key',
          'KEY_REVOKE': '🚫 Thu Hồi Key',
          'LOGIN': '🔐 Đăng Nhập',
          'LOGOUT': '🚪 Đăng Xuất',
          'TAMPER': '⚠️ Tamper Detection',
          'MACHINE_REBIND': '🔄 Đổi Máy'
        }
        
        const severityLabels = {
          'info': 'ℹ️ Info',
          'warning': '⚠️ Warning',
          'error': '❌ Error',
          'critical': '🚨 Critical'
        }
        
        tbody.innerHTML = result.logs.map(log => {
          const eventTypeText = eventTypeLabels[log.event_type] || escapeHtml(log.event_type)
          const severityText = severityLabels[log.severity] || escapeHtml(log.severity)
          const severityClass = \`badge-\${escapeHtml(log.severity)}\`
          const details = log.details ? JSON.parse(log.details) : null
          const detailsStr = details ? escapeHtml(JSON.stringify(details, null, 2).substring(0, 200)) : '-'

          // Extract key from details if available (for REGISTER and APPROVE events)
          let keyDisplay = '-'
          if (details && details.key_kich_hoat) {
            const keyHtml = escapeHtml(details.key_kich_hoat)
            const keyJs = escapeForJsString(details.key_kich_hoat)
            keyDisplay = \`<code style="font-size: 12px; color: #22c55e; cursor: pointer; padding: 4px 8px; background: rgba(34, 197, 94, 0.1); border-radius: 4px; font-weight: 600; font-family: monospace;" onclick="copyTextSafely('\${keyJs}', 'Key')" title="Click để copy">\${keyHtml}</code>\`
          }

          return \`
            <tr>
              <td>\${formatDateTime(log.timestamp)}</td>
              <td><strong>\${escapeHtml(log.username)}</strong></td>
              <td>\${eventTypeText}</td>
              <td><span class="badge \${severityClass}">\${severityText}</span></td>
              <td><code style="font-size: 11px;">\${escapeHtml(log.ip_address) || '-'}</code></td>
              <td><code style="font-size: 11px;">\${log.machine_id ? escapeHtml(log.machine_id.substring(0, 24)) + '...' : '-'}</code></td>
              <td>\${keyDisplay}</td>
              <td>
                <code style="font-size: 11px; white-space: pre-wrap; max-width: 300px; overflow: hidden; text-overflow: ellipsis; color: #94a3b8;" title="\${detailsStr}">\${detailsStr}</code>
              </td>
            </tr>
          \`
        }).join('')
      } catch (error) {
        showError(error.message)
      }
    }
    
    function switchTab(tabName) {
      const ownerOnlyTabs = ['events', 'top', 'auditLogs', 'autoBlock', 'activity', 'admins', 'versionPolicy', 'settings']
      if (!isOwner() && ownerOnlyTabs.includes(tabName)) tabName = 'users'
      // Update sidebar active state
      document.querySelectorAll('.sidebar-item').forEach(s => s.classList.remove('active'))
      var clicked = document.querySelector('.sidebar-item[data-tab="' + tabName + '"]')
      if (clicked) clicked.classList.add('active')

      // Also update old hidden tabs for backward compat
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'))
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'))

      if (tabName === 'events') {
        document.getElementById('eventsTab').classList.add('active')
        refreshData()
      } else if (tabName === 'users') {
        document.getElementById('usersTab').classList.add('active')
        loadUsers()
      } else if (tabName === 'top') {
        document.getElementById('topTab').classList.add('active')
        loadTopData()
      } else if (tabName === 'activity') {
        document.getElementById('activityTab').classList.add('active')
        loadActivityLog()
      } else if (tabName === 'admins') {
        document.getElementById('adminsTab').classList.add('active')
        loadAdmins()
      } else if (tabName === 'auditLogs') {
        document.getElementById('auditLogsTab').classList.add('active')
        currentAuditLogsPage = 1
        loadAuditLogs()
      } else if (tabName === 'licenses') {
        document.getElementById('licensesTab').classList.add('active')
        loadLicenses()
      } else if (tabName === 'settings') {
        document.getElementById('settingsTab').classList.add('active')
        loadSettingsTokenDisplay()
        loadAlertSettings()
      } else if (tabName === 'versionPolicy') {
        document.getElementById('versionPolicyTab').classList.add('active')
        loadVersionPolicy()
      } else if (tabName === 'autoBlock') {
        document.getElementById('autoBlockTab').classList.add('active')
        loadAutoBlockTab()
      }
    }

    // Load auto-block rules into tab (reuses existing showAutoBlockRules logic)
    async function loadAutoBlockTab() {
      try {
        var result = await fetchWithAuth(API_BASE + '/api/admin/auto-block-rules')
        if (result.ok) {
          var container = document.getElementById('autoBlockTabContent')
          container.innerHTML = formatAutoBlockRules(result.rules || result)
        }
      } catch(e) {
        document.getElementById('autoBlockTabContent').innerHTML = '<div class="error">Lỗi tải auto-block rules</div>'
      }
    }
    
    // Load top machines and usernames
    async function loadTopData() {
      const hours = parseInt(document.getElementById('topHoursFilter')?.value || '24') || 24

      // Load top machines — independent try/catch
      try {
        const machinesResult = await fetchWithAuth(\`\${API_BASE}/api/admin/top-machines?hours=\${hours}&limit=10\`)
        const machinesList = document.getElementById('topMachinesList')
        if (machinesResult.ok && machinesResult.machines && machinesResult.machines.length > 0) {
          machinesList.innerHTML = \`
            <table class="data-table">
              <thead><tr>
                <th>Mã máy</th>
                <th class="number">Sự kiện</th>
                <th class="center">Mức độ cao nhất</th>
              </tr></thead>
              <tbody>\${machinesResult.machines.map(function(m) { return \`
                <tr>
                  <td><code style="font-size: 11px;">\${escapeHtml(shortId(m.machine_id, 24))}</code></td>
                  <td class="number" style="font-weight: 600; color: #0ea5e9;">\${formatNumber(m.event_count)}</td>
                  <td class="center"><span class="badge badge-\${escapeHtml(m.max_severity)}">\${severityLabels[m.max_severity] || escapeHtml(m.max_severity)}</span></td>
                </tr>\` }).join('')}</tbody>
            </table>\`
        } else {
          machinesList.innerHTML = '<div class="empty-state">Không có dữ liệu trong khoảng thời gian đã chọn</div>'
        }
      } catch (e) { console.error('Top machines error:', e); document.getElementById('topMachinesList').innerHTML = '<div class="error">Không tải được dữ liệu máy</div>' }

      // Load top usernames — independent try/catch
      try {
        const usernamesResult = await fetchWithAuth(\`\${API_BASE}/api/admin/top-usernames?hours=\${hours}&limit=10\`)
        const usernamesList = document.getElementById('topUsernamesList')
        if (usernamesResult.ok && usernamesResult.usernames && usernamesResult.usernames.length > 0) {
          usernamesList.innerHTML = \`
            <table class="data-table">
              <thead><tr>
                <th>Người dùng</th>
                <th class="number">Sự kiện</th>
                <th class="center">Mức độ cao nhất</th>
              </tr></thead>
              <tbody>\${usernamesResult.usernames.map(function(u) { return \`
                <tr>
                  <td><strong>\${escapeHtml(u.username)}</strong></td>
                  <td class="number" style="font-weight: 600; color: #0ea5e9;">\${formatNumber(u.event_count)}</td>
                  <td class="center"><span class="badge badge-\${escapeHtml(u.max_severity)}">\${severityLabels[u.max_severity] || escapeHtml(u.max_severity)}</span></td>
                </tr>\` }).join('')}</tbody>
            </table>\`
        } else {
          usernamesList.innerHTML = '<div class="empty-state">Không có người dùng trong khoảng thời gian đã chọn</div>'
        }
      } catch (e) { console.error('Top usernames error:', e); document.getElementById('topUsernamesList').innerHTML = '<div class="error">Không tải được dữ liệu người dùng</div>' }

      // Load top machines by usage — independent try/catch
      try {
        const usageResult = await fetchWithAuth(\`\${API_BASE}/api/admin/top-machines-by-usage?limit=10\`)
        const usageList = document.getElementById('topMachinesByUsageList')
        if (usageResult.ok && usageResult.machines && usageResult.machines.length > 0) {
          usageList.innerHTML = \`
            <table class="data-table">
              <thead><tr>
                <th>Mã máy</th>
                <th>Người dùng</th>
                <th class="number">Số lần truy cập</th>
                <th class="center">Thời gian hoạt động</th>
                <th class="center">Lần cuối</th>
              </tr></thead>
              <tbody>\${usageResult.machines.map(function(m) {
                var activeDays = Math.floor(m.active_duration_ms / (1000 * 60 * 60 * 24))
                var activeHours = Math.floor((m.active_duration_ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
                var activeMinutes = Math.floor((m.active_duration_ms % (1000 * 60 * 60)) / (1000 * 60))
                var activeDuration = ''
                if (activeDays > 0) activeDuration += activeDays + ' ngày '
                if (activeHours > 0) activeDuration += activeHours + ' giờ '
                if (activeMinutes > 0 || activeDuration === '') activeDuration += activeMinutes + ' phút'
                return \`
                <tr>
                  <td><code style="font-size: 11px;">\${escapeHtml(shortId(m.machine_id, 28))}</code></td>
                  <td><strong>\${escapeHtml(m.username || '-')}</strong></td>
                  <td class="number" style="font-weight: 600; color: #0ea5e9;">\${formatNumber(m.request_count)}</td>
                  <td class="center" style="color: #94a3b8; font-size: 12px;">\${activeDuration.trim()}</td>
                  <td class="center" style="color: #94a3b8; font-size: 11px;">\${formatDateTime(m.last_seen)}</td>
                </tr>\` }).join('')}</tbody>
            </table>\`
        } else {
          usageList.innerHTML = '<div class="empty-state">Chưa có dữ liệu sử dụng app</div>'
        }
      } catch (e) { console.error('Top usage error:', e); document.getElementById('topMachinesByUsageList').innerHTML = '<div class="error">Không tải được dữ liệu sử dụng</div>' }

      // Load top users video exports — independent try/catch
      try {
        const videoExportsResult = await fetchWithAuth(\`\${API_BASE}/api/admin/top-users-video-exports?limit=10\`)
        const videoExportsList = document.getElementById('topUsersVideoExportsList')
        if (videoExportsList) {
          if (videoExportsResult.ok && videoExportsResult.users && videoExportsResult.users.length > 0) {
            videoExportsList.innerHTML = \`
              <table class="data-table">
                <thead><tr>
                  <th>Người dùng</th>
                  <th class="number">Tổng video</th>
                  <th class="number">Thành công</th>
                  <th class="number">Thất bại</th>
                  <th class="center">Lần cuối</th>
                </tr></thead>
                <tbody>\${videoExportsResult.users.map(function(u) { return \`
                  <tr>
                    <td><strong>\${escapeHtml(u.username)}</strong></td>
                    <td class="number" style="font-weight: 600; color: #0ea5e9;">\${formatNumber(u.total_exports)}</td>
                    <td class="number" style="font-weight: 600; color: #22c55e;">\${formatNumber(u.success_count)}</td>
                    <td class="number" style="font-weight: 600; color: #ef4444;">\${formatNumber(u.failed_count)}</td>
                    <td class="center" style="color: #94a3b8; font-size: 11px;">\${u.last_export_time ? formatDateTime(u.last_export_time) : '-'}</td>
                  </tr>\` }).join('')}</tbody>
              </table>\`
          } else {
            videoExportsList.innerHTML = '<div class="empty-state">Chưa có dữ liệu xuất video</div>'
          }
        }
      } catch (e) { console.error('Top video exports error:', e); var vel = document.getElementById('topUsersVideoExportsList'); if (vel) vel.innerHTML = '<div class="error">Không tải được dữ liệu video</div>' }
    }
    
    // Load users
    async function loadUsers() {
      try {
        const status = document.getElementById('userStatusFilter').value
        const params = new URLSearchParams({ limit: '100' })
        if (status) params.append('status', status)

        const response = await fetch(\`\${API_BASE}/api/admin/users?\${params}\`, {
          headers: { 
            'Authorization': \`Bearer \${ADMIN_TOKEN}\`
          }
        })
        
        if (response.status === 401) {
          localStorage.removeItem('admin_session_token'); localStorage.removeItem('admin_token')
          ADMIN_TOKEN = ''
          document.getElementById('authOverlay').classList.remove('hidden')
          document.getElementById('dashboard').classList.add('hidden')
          throw new Error('Token không hợp lệ. Vui lòng đăng nhập lại.')
        }
        
        const result = await response.json()

        if (!result.ok) {
          console.error('API error:', result.error)
          throw new Error(result.error || 'Lỗi không xác định')
        }
        
        const tbody = document.getElementById('usersTableBody')
        if (!tbody) {
          console.error('usersTableBody element not found')
          return
        }
        
        if (!result.users || result.users.length === 0) {
          tbody.innerHTML = '<tr><td colspan="11" class="empty-state">Không tìm thấy người dùng nào</td></tr>'
          return
        }

        const renderedHTML = result.users.map((user, index) => {
          try {
            const safeTaiKhoan = escapeHtml(user.tai_khoan)
            const jsTaiKhoan = escapeForJsString(user.tai_khoan)
            const safeMaMay = escapeHtml(user.ma_may)
            const safeVersion = escapeHtml(user.version)
            const statusClass = \`status-\${escapeHtml(user.trang_thai.toLowerCase())}\`
            const statusText = statusLabels[user.trang_thai] || escapeHtml(user.trang_thai)
            const lastActive = user.last_active ? formatDateTime(user.last_active) : 'Chưa có'
            const machineIdCell = user.ma_may
              ? \`<span class="clickable" title="Xem chi tiết" onclick="openUserDetail('\${user.id}')"><code>\${safeMaMay.substring(0, 24)}...</code></span>\`
              : '<span style="color: #64748b;">-</span>'
            const activationKey = user.key_kich_hoat
              ? \`<span class="clickable" title="Xem chi tiết key" onclick="openUserDetail('\${user.id}')"><code style="font-size: 11px;">\${escapeHtml(user.key_kich_hoat.substring(0, 20))}...</code></span>\`
              : '<span style="color: #64748b;">-</span>'
            const machineCount = user.machine_count || 0
            const multipleMachinesWarning = machineCount > 1 ? \`<span style="color: #f97316; font-size: 12px; cursor: pointer;" onclick="showUserMachines('\${jsTaiKhoan}')" title="⚠️ Click để xem chi tiết \${machineCount} máy">⚠️ \${machineCount}</span>\` : (machineCount > 0 ? \`<span style="cursor: pointer;" onclick="showUserMachines('\${jsTaiKhoan}')" title="Click để xem chi tiết">\${machineCount}</span>\` : '0')
            
            // Password cell with eye icon - FIX: store in JS Map, not DOM attribute
            const passwordId = \`pwd-user-\${user.id}\`
            const realPassword = user.mat_khau || ''
            _pwdStore.set(passwordId, realPassword)
            const maskedPassword = realPassword ? realPassword.replace(/./g, '*') : '-'
            const disabledAttr = !realPassword ? 'disabled' : ''
            const disabledStyle = !realPassword ? 'opacity: 0.5; cursor: not-allowed;' : ''

            const passwordCell = \`
              <div style="display: flex; align-items: center; gap: 4px; width: 100%;">
                <input
                  type="password"
                  id="\${passwordId}"
                  value="\${escapeHtml(maskedPassword)}"
                  readonly
                  style="flex: 1; padding: 6px 10px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #e2e8f0; font-size: 12px; font-family: monospace; min-width: 100px; max-width: 200px;"
                />
                <button 
                  type="button" 
                  class="icon-btn" 
                  onclick="toggleTablePasswordVisibility('\${passwordId}', this)"
                  style="padding: 6px 10px; background: #1e293b; border: 1px solid #334155; border-radius: 6px; cursor: pointer; font-size: 16px; min-width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; transition: all 0.2s; \${disabledStyle}"
                  onmouseover="if(!this.disabled) this.style.background='#2563eb'"
                  onmouseout="if(!this.disabled) this.style.background='#1e293b'"
                  title="Hiện/Ẩn mật khẩu"
                  \${disabledAttr}
                >👁️</button>
              </div>
            \`
            
          
          // V2: Get key_status
          const keyStatus = user.key_status || 'PENDING'
          const keyStatusLabels = {
            'PENDING': '⏳ Chờ',
            'ACTIVE': '✅ Hoạt động',
            'LOCKED': '🔒 Đã khóa',
            'REVOKED': '🚫 Đã thu hồi'
          }
          const keyStatusText = keyStatusLabels[keyStatus] || keyStatus

          const ddId = \`dd1-\${user.id}\`
          let menuItems = \`<button class="action-dropdown-item" onclick="openEditModal('\${user.id}')">✏️ Sửa</button>\`
          menuItems += \`<button class="action-dropdown-item" onclick="resetUserPassword('\${user.id}', '\${jsTaiKhoan}')">Reset mật khẩu</button>\`
          if (user.trang_thai === 'CHO_DUYET') {
            menuItems += \`<button class="action-dropdown-item" onclick="updateUserStatus('\${user.id}', 'CHO_PHEP')">✅ Duyệt</button>\`
            menuItems += \`<button class="action-dropdown-item" onclick="updateUserStatus('\${user.id}', 'CHAN')">🚫 Chặn</button>\`
          } else if (user.trang_thai === 'CHO_PHEP') {
            menuItems += \`<button class="action-dropdown-item" onclick="updateUserStatus('\${user.id}', 'CHAN')">🚫 Chặn</button>\`
            if (keyStatus === 'LOCKED') {
              menuItems += \`<button class="action-dropdown-item" onclick="unlockKey('\${jsTaiKhoan}')">🔓 Mở khóa key</button>\`
            }
            if (keyStatus === 'ACTIVE' || keyStatus === 'LOCKED') {
              menuItems += \`<button class="action-dropdown-item" onclick="revokeKey('\${jsTaiKhoan}')">🔑 Thu hồi key</button>\`
            }
            menuItems += \`<button class="action-dropdown-item" onclick="allowRebind('\${jsTaiKhoan}')">🔄 Đổi máy</button>\`
          } else if (user.trang_thai === 'CHAN') {
            menuItems += \`<button class="action-dropdown-item" onclick="updateUserStatus('\${user.id}', 'CHO_PHEP')">🔓 Bỏ chặn</button>\`
          }
          menuItems += \`<div class="action-dropdown-divider"></div>\`
          menuItems += \`<button class="action-dropdown-item danger" onclick="deleteUser('\${user.id}')">🗑️ Xóa</button>\`

          const actions = \`<div class="action-dropdown" id="\${ddId}">
            <button class="action-dropdown-btn" onclick="toggleDropdown(event, '\${ddId}')">⋮ Thao Tác</button>
            <div class="action-dropdown-menu">\${menuItems}</div>
          </div>\`
          
            
            const versionDisplay = user.version && user.version !== '-'
              ? \`<span style="display: inline-block; padding: 4px 10px; background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%); color: white; border-radius: 6px; font-size: 12px; font-weight: 600; font-family: monospace; box-shadow: 0 2px 4px rgba(14, 165, 233, 0.3);">\${safeVersion}</span>\`
              : \`<span style="color: #64748b; font-size: 12px;">-</span>\`
            
            return \`
              <tr>
                <td><input type="checkbox" class="user-checkbox" value="\${user.id}"></td>
                <td><strong>\${safeTaiKhoan}</strong></td>
                <td>\${passwordCell}</td>
                <td>\${machineIdCell}</td>
                <td><span class="status-badge \${statusClass}">\${statusText}</span></td>
                <td>\${multipleMachinesWarning}</td>
                <td>\${activationKey}</td>
                <td><span class="status-badge" style="font-size: 11px;">\${keyStatusText}</span></td>
                <td>\${lastActive}</td>
                <td style="text-align: center; vertical-align: middle;">\${versionDisplay}</td>
                <td style="text-align: center; vertical-align: middle;">\${actions}</td>
              </tr>
            \`
          } catch (err) {
            console.error('Error rendering user:', user.id, err)
            return \`<tr><td colspan="11" style="color: red;">Lỗi render user \${user.id}</td></tr>\`
          }
        }).join('')
        
        
        tbody.innerHTML = renderedHTML
      } catch (error) {
        console.error('Error in loadUsers:', error)
        const tbody = document.getElementById('usersTableBody')
        if (tbody) {
          tbody.innerHTML = \`<tr><td colspan="11" class="empty-state" style="color: red;">Lỗi: \${escapeHtml(error.message || 'Không thể tải dữ liệu')}</td></tr>\`
        }
        showError(error.message || 'Không thể tải danh sách người dùng')
      }
    }
    
    // Show key modal when approve user
    function showKeyModal(key) {
      document.getElementById('keyModalKey').textContent = key || '-'
      document.getElementById('keyModal').classList.add('active')
    }
    
    function closeKeyModal() {
      document.getElementById('keyModal').classList.remove('active')
    }
    
    function copyKeyModal() {
      const key = document.getElementById('keyModalKey').textContent
      copyTextSafely(key, 'Key kích hoạt')
    }
    
    // Update user status
    async function updateUserStatus(userId, status) {
      if (!confirm(\`Bạn chắc chắn muốn thay đổi trạng thái người dùng?\`)) return
      
      try {
        const response = await fetch(\`\${API_BASE}/api/admin/users/\${userId}/update\`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': \`Bearer \${ADMIN_TOKEN}\`
          },
          body: JSON.stringify({ status })
        })
        
        if (response.status === 401) {
          localStorage.removeItem('admin_session_token'); localStorage.removeItem('admin_token')
          ADMIN_TOKEN = ''
          document.getElementById('authOverlay').classList.remove('hidden')
          document.getElementById('dashboard').classList.add('hidden')
          throw new Error('Token không hợp lệ. Vui lòng đăng nhập lại.')
        }
        
        const result = await response.json()

        if (!result.ok) {
          const errorMsg = result.error || result.message || 'Cập nhật thất bại'
          console.error('Update status failed:', errorMsg, result)
          throw new Error(errorMsg)
        }
        
        // V2: Nếu approve thành công và có key, hiển thị modal với key để copy
        if (status === 'CHO_PHEP' && result.key_kich_hoat) {
          showKeyModal(result.key_kich_hoat)
        } else {
          alert('Cập nhật thành công!')
        }
        
        // Clear filter to show all users (including the one we just updated)
        document.getElementById('userStatusFilter').value = ''
        
        // Force reload users list
        await loadUsers()
      } catch (error) {
        console.error('Error updating user status:', error)
        showError(error.message)
      }
    }

    // Delete user
    async function deleteUser(userId) {
      if (!confirm('Bạn có chắc chắn muốn XÓA người dùng này? Hành động này không thể hoàn tác!')) return
      try {
        const response = await fetchWithAuth(\`\${API_BASE}/api/admin/users/\${userId}/delete\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        })
        if (!response.ok) {
          const errorMsg = response.error || response.message || 'Xóa thất bại'
          throw new Error(errorMsg)
        }
        alert('Đã xóa người dùng thành công!')
        await loadUsers()
      } catch (error) {
        console.error('Error deleting user:', error)
        showError(error.message)
      }
    }

    // Toggle dropdown menu
    function toggleDropdown(event, id) {
      event.stopPropagation()
      const el = document.getElementById(id)
      if (!el) return
      const wasOpen = el.classList.contains('open')
      document.querySelectorAll('.action-dropdown.open').forEach(d => d.classList.remove('open'))
      if (!wasOpen) el.classList.add('open')
    }

    // Close all dropdowns on outside click
    document.addEventListener('click', function() {
      document.querySelectorAll('.action-dropdown.open').forEach(d => d.classList.remove('open'))
    })

    // Open edit modal
    async function openEditModal(userId) {
      try {
        const result = await fetchWithAuth(\`\${API_BASE}/api/admin/users/\${userId}\`)
        if (!result.ok) throw new Error(result.error || 'Không thể tải thông tin user')
        
        const user = result.user
        document.getElementById('editUserId').value = user.id
        document.getElementById('editTaiKhoan').value = user.tai_khoan || ''
        document.getElementById('editMatKhau').value = ''
        document.getElementById('editMaMay').value = user.ma_may || ''
        
        // Set dropdown value - ensure it's one of the valid options
        const trangThaiSelect = document.getElementById('editTrangThai')
        const validStatuses = ['CHO_DUYET', 'CHO_PHEP', 'CHAN']
        const userStatus = user.trang_thai || 'CHO_DUYET'
        
        if (validStatuses.includes(userStatus)) {
          trangThaiSelect.value = userStatus
        } else {
          // Fallback to first option if invalid
          trangThaiSelect.value = 'CHO_DUYET'
          console.warn('Invalid status:', userStatus, 'using default CHO_DUYET')
        }
        
        // Ensure dropdown is enabled
        trangThaiSelect.disabled = false

        // Set license expiry
        var expiryInput = document.getElementById('editLicenseExpiresAt')
        if (user.license_expires_at) {
          var d = new Date(user.license_expires_at)
          expiryInput.value = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0') + 'T' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0')
        } else {
          expiryInput.value = ''
        }

        document.getElementById('editModal').classList.add('active')
      } catch (error) {
        showError(error.message)
      }
    }
    
    // Close edit modal
    function closeEditModal() {
      document.getElementById('editModal').classList.remove('active')
      document.getElementById('editUserForm').reset()
    }
    
    // Hiện/ẩn Admin Token (form đăng nhập dashboard)
    function toggleTokenVisibility() {
      const input = document.getElementById('tokenInput')
      const btn = document.getElementById('tokenToggleBtn')
      if (!input) return
      const isHidden = input.type === 'password'
      input.type = isHidden ? 'text' : 'password'
      if (btn) btn.textContent = isHidden ? 'Hide' : 'Show'
    }

    // Tab Cài đặt: điền token vào ô "Admin Token (mở lại khi quên)"
    function loadSettingsTokenDisplay() {
      const si = document.getElementById('settingsTokenInput')
      if (si) { si.value = ADMIN_TOKEN || localStorage.getItem('admin_token') || ''; si.type = 'password' }
      const stb = document.getElementById('settingsTokenToggleBtn')
      if (stb) stb.textContent = '👁️'
    }
    function toggleSettingsTokenVisibility() {
      const input = document.getElementById('settingsTokenInput')
      const btn = document.getElementById('settingsTokenToggleBtn')
      if (!input) return
      const isHidden = input.type === 'password'
      input.type = isHidden ? 'text' : 'password'
      if (btn) btn.textContent = isHidden ? '🙈' : '👁️'
    }
    function copySettingsToken() {
      const input = document.getElementById('settingsTokenInput')
      if (!input || !input.value) { alert('Không có token để copy'); return }
      navigator.clipboard.writeText(input.value).then(function() { alert('Đã copy token vào clipboard'); }).catch(function() { alert('Không copy được'); })
    }
    
    // Toggle password visibility helpers
    function togglePasswordVisibility(inputId, btn) {
      const input = document.getElementById(inputId)
      if (!input) return
      const isHidden = input.type === 'password'
      input.type = isHidden ? 'text' : 'password'
      if (btn) btn.textContent = isHidden ? '🙈' : '👁️'
    }
    
    // Toggle password visibility in table
    function toggleTablePasswordVisibility(inputId, btn) {
      const input = document.getElementById(inputId)
      if (!input || input.disabled) return
      const realPassword = _pwdStore.get(inputId) || ''
      if (!realPassword || realPassword === '-') return

      const isHidden = input.type === 'password'

      if (isHidden) {
        // Show real password
        input.type = 'text'
        input.value = realPassword
        if (btn) btn.textContent = '🙈'
      } else {
        // Hide password with asterisks
        input.type = 'password'
        input.value = realPassword.replace(/./g, '*')
        if (btn) btn.textContent = '👁️'
      }
    }

    // User detail modal
    async function openUserDetail(userId) {
      try {
        const result = await fetchWithAuth(\`\${API_BASE}/api/admin/users/\${userId}\`)
        if (!result.ok) throw new Error(result.error || 'Không thể tải chi tiết user')
        const user = result.user
        currentDetailUser = user
        document.getElementById('detailTaiKhoan').textContent = user.tai_khoan || '-'
        document.getElementById('detailMaMay').textContent = user.ma_may || '-'
        document.getElementById('detailKey').textContent = user.key_kich_hoat || '-'
        const pwd = document.getElementById('detailMatKhau')
        pwd.value = user.mat_khau || ''
        pwd.type = 'password'
        const hintEl = document.getElementById('detailMatKhauHint')
        if (hintEl) {
          const val = user.mat_khau || ''
          if (val.indexOf(':') >= 0 && val.length > 20) {
            hintEl.style.display = 'block'
            hintEl.textContent = 'Mật khẩu đang lưu dạng hash nên không thể xem lại. Bấm Reset để tạo mật khẩu tạm thời mới.'
          } else {
            hintEl.style.display = 'none'
            hintEl.textContent = ''
          }
        }
        document.getElementById('detailTrangThai').textContent = statusLabels[user.trang_thai] || user.trang_thai || '-'
        document.getElementById('detailVersion').textContent = user.version || '-'
        document.getElementById('detailCreated').textContent = user.thoi_gian_tao ? new Date(user.thoi_gian_tao).toLocaleString('vi-VN') : '-'
        const expiryEl = document.getElementById('detailLicenseExpiresAt')
        if (user.license_expires_at) {
          const expiryDate = new Date(user.license_expires_at)
          const now = Date.now()
          const remaining = user.license_expires_at - now
          let badge = ''
          if (remaining <= 0) {
            badge = '<span style="color:#ef4444;font-weight:600;margin-left:8px;">⛔ Đã hết hạn</span>'
          } else if (remaining < 7 * 24 * 60 * 60 * 1000) {
            const days = Math.ceil(remaining / (24 * 60 * 60 * 1000))
            badge = '<span style="color:#f59e0b;font-weight:600;margin-left:8px;">⚠️ Còn ' + days + ' ngày</span>'
          } else {
            const days = Math.ceil(remaining / (24 * 60 * 60 * 1000))
            badge = '<span style="color:#22c55e;font-weight:600;margin-left:8px;">✅ Còn ' + days + ' ngày</span>'
          }
          expiryEl.innerHTML = expiryDate.toLocaleString('vi-VN') + badge
        } else {
          expiryEl.innerHTML = '<span style="color:#64748b;">♾️ Vĩnh viễn</span>'
        }
        // Populate datetime input for setting expiry
        var detailExpiryInput = document.getElementById('detailExpiryInput')
        if (user.license_expires_at) {
          var d = new Date(user.license_expires_at)
          var tzOffset = d.getTimezoneOffset() * 60000
          detailExpiryInput.value = new Date(d.getTime() - tzOffset).toISOString().slice(0, 16)
        } else {
          detailExpiryInput.value = ''
        }
        document.getElementById('userDetailModal').classList.add('active')
      } catch (error) {
        showError(error.message)
      }
    }

    function closeUserDetailModal() {
      document.getElementById('userDetailModal').classList.remove('active')
      currentDetailUser = null
      const pwd = document.getElementById('detailMatKhau')
      if (pwd) pwd.type = 'password'
    }

    function quickExtendLicense(days) {
      var input = document.getElementById('detailExpiryInput')
      if (days === 0) {
        input.value = ''
        return
      }
      // Gia hạn từ hiện tại hoặc từ ngày hết hạn hiện tại (nếu chưa hết hạn)
      var baseTime = Date.now()
      if (currentDetailUser && currentDetailUser.license_expires_at && currentDetailUser.license_expires_at > baseTime) {
        baseTime = currentDetailUser.license_expires_at
      }
      var newDate = new Date(baseTime + days * 24 * 60 * 60 * 1000)
      var tzOffset = newDate.getTimezoneOffset() * 60000
      input.value = new Date(newDate.getTime() - tzOffset).toISOString().slice(0, 16)
    }

    async function saveDetailExpiry() {
      if (!currentDetailUser) return
      var input = document.getElementById('detailExpiryInput')
      var expiryVal = input.value
      var license_expires_at = expiryVal ? new Date(expiryVal).getTime() : null
      try {
        var res = await fetch(API_BASE + '/api/admin/users/' + currentDetailUser.id + '/edit', {
          method: 'POST',
          headers: { 'Authorization': \`Bearer \${ADMIN_TOKEN}\`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ license_expires_at: license_expires_at })
        })
        if (res.status === 401 || res.status === 403) {
          ADMIN_TOKEN = ''
          localStorage.removeItem('admin_session_token'); localStorage.removeItem('admin_token')
          document.getElementById('dashboard').classList.add('hidden')
          document.getElementById('authOverlay').classList.remove('hidden')
          throw new Error('Phiên đăng nhập hết hạn')
        }
        var data = await res.json()
        if (!data.ok) throw new Error(data.error || 'Lỗi cập nhật')
        alert('Đã cập nhật hạn sử dụng thành công!')
        // Refresh detail modal
        closeUserDetailModal()
        await loadUsers()
      } catch (error) {
        showError(error.message)
      }
    }

    async function copyTextSafely(text, label) {
      try {
        await navigator.clipboard.writeText(text || '')
        alert(\`\${label} đã được copy\`)
      } catch {
        alert('Không copy được')
      }
    }

    function copyDetailMachine() {
      if (!currentDetailUser) return
      copyTextSafely(currentDetailUser.ma_may || '', 'Mã máy')
    }

    function copyDetailKey() {
      if (!currentDetailUser) return
      copyTextSafely(currentDetailUser.key_kich_hoat || '', 'Key')
    }

    function copyDetailPassword() {
      if (!currentDetailUser) return
      copyTextSafely(currentDetailUser.mat_khau || '', 'Mật khẩu')
    }

    async function resetUserPassword(userId, taiKhoan) {
      if (!confirm(\`Reset mat khau cho tai khoan "\${taiKhoan}"? Token dang nhap cu se bi thu hoi.\`)) return

      try {
        const result = await fetchWithAuth(\`\${API_BASE}/api/admin/users/\${userId}/reset-password\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        })

        if (!result.ok) throw new Error(result.error || 'Reset mat khau that bai')

        const temporaryPassword = result.temporary_password || ''
        if (temporaryPassword) {
          try { await navigator.clipboard.writeText(temporaryPassword) } catch {}
          prompt('Mat khau tam thoi da tao. Copy va gui cho user:', temporaryPassword)
        } else {
          alert('Da reset mat khau, nhung server khong tra ve mat khau tam thoi.')
        }

        await loadUsers()
      } catch (error) {
        showError(error.message)
      }
    }

    // V2: Unlock key
    async function unlockKey(taiKhoan) {
      if (!confirm(\`Bạn chắc chắn muốn mở khóa key cho tài khoản "\${taiKhoan}"?\`)) return
      try {
        const response = await fetch(\`\${API_BASE}/api/auth/admin/unlock-key\`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'x-admin-token': ADMIN_TOKEN
          },
          body: JSON.stringify({ tai_khoan: taiKhoan })
        })
        if (response.status === 401) {
          localStorage.removeItem('admin_session_token'); localStorage.removeItem('admin_token')
          ADMIN_TOKEN = ''
          document.getElementById('authOverlay').classList.remove('hidden')
          document.getElementById('dashboard').classList.add('hidden')
          throw new Error('Token không hợp lệ. Vui lòng đăng nhập lại.')
        }
        const result = await response.json()
        if (!result.ok) throw new Error(result.error || 'Mở khóa key thất bại')
        alert('Mở khóa key thành công!')
        await loadUsers()
      } catch (error) {
        showError(error.message)
      }
    }

    // V2: Revoke key
    async function revokeKey(taiKhoan) {
      if (!confirm(\`Bạn chắc chắn muốn thu hồi key cho tài khoản "\${taiKhoan}"? Tất cả tokens sẽ bị vô hiệu hóa.\`)) return
      try {
        const response = await fetch(\`\${API_BASE}/api/auth/admin/revoke-key\`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'x-admin-token': ADMIN_TOKEN
          },
          body: JSON.stringify({ tai_khoan: taiKhoan })
        })
        if (response.status === 401) {
          localStorage.removeItem('admin_session_token'); localStorage.removeItem('admin_token')
          ADMIN_TOKEN = ''
          document.getElementById('authOverlay').classList.remove('hidden')
          document.getElementById('dashboard').classList.add('hidden')
          throw new Error('Token không hợp lệ. Vui lòng đăng nhập lại.')
        }
        const result = await response.json()
        if (!result.ok) throw new Error(result.error || 'Thu hồi key thất bại')
        alert('Thu hồi key thành công! Tất cả tokens đã bị vô hiệu hóa.')
        await loadUsers()
      } catch (error) {
        showError(error.message)
      }
    }

    // V2: Allow rebind
    async function allowRebind(taiKhoan) {
      const newMachineId = prompt(\`Nhập machineId mới cho tài khoản "\${taiKhoan}":\`)
      if (!newMachineId || !newMachineId.trim()) return
      
      if (!confirm(\`Bạn chắc chắn muốn cho phép đổi machineId cho tài khoản "\${taiKhoan}"?\n\nMachineId mới: \${newMachineId}\n\nTất cả tokens cũ sẽ bị vô hiệu hóa.\`)) return
      
      try {
        const response = await fetch(\`\${API_BASE}/api/auth/admin/allow-rebind\`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'x-admin-token': ADMIN_TOKEN
          },
          body: JSON.stringify({ 
            tai_khoan: taiKhoan,
            new_machine_id: newMachineId.trim()
          })
        })
        if (response.status === 401) {
          localStorage.removeItem('admin_session_token'); localStorage.removeItem('admin_token')
          ADMIN_TOKEN = ''
          document.getElementById('authOverlay').classList.remove('hidden')
          document.getElementById('dashboard').classList.add('hidden')
          throw new Error('Token không hợp lệ. Vui lòng đăng nhập lại.')
        }
        const result = await response.json()
        if (!result.ok) throw new Error(result.error || 'Cho phép đổi machineId thất bại')
        alert('Đã cho phép đổi machineId thành công! User cần đăng nhập lại với machineId mới.')
        await loadUsers()
      } catch (error) {
        showError(error.message)
      }
    }

    // Save user edit
    async function saveUserEdit(event) {
      event.preventDefault()
      
      const userId = document.getElementById('editUserId').value
      const taiKhoan = document.getElementById('editTaiKhoan').value.trim()
      const matKhau = document.getElementById('editMatKhau').value.trim()
      const maMay = document.getElementById('editMaMay').value.trim()
      const trangThaiSelect = document.getElementById('editTrangThai')
      const trangThai = trangThaiSelect.value
      
      // Validate required fields
      if (!taiKhoan || !maMay) {
        alert('Vui lòng điền đầy đủ thông tin!')
        return
      }
      
      // Validate status
      const validStatuses = ['CHO_DUYET', 'CHO_PHEP', 'CHAN']
      if (!trangThai || !validStatuses.includes(trangThai)) {
        alert('Trạng thái không hợp lệ!')
        return
      }
      
      try {
        var expiryVal = document.getElementById('editLicenseExpiresAt').value
        var licenseExpiresAt = expiryVal ? new Date(expiryVal).getTime() : null

        const body = {
          tai_khoan: taiKhoan,
          ma_may: maMay,
          trang_thai: trangThai,
          license_expires_at: licenseExpiresAt
        }
        
        // Only include password if provided
        if (matKhau) {
          body.mat_khau = matKhau
        }

        const response = await fetch(\`\${API_BASE}/api/admin/users/\${userId}/edit\`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': \`Bearer \${ADMIN_TOKEN}\`
          },
          body: JSON.stringify(body)
        })
        
        if (response.status === 401) {
          localStorage.removeItem('admin_session_token'); localStorage.removeItem('admin_token')
          ADMIN_TOKEN = ''
          document.getElementById('authOverlay').classList.remove('hidden')
          document.getElementById('dashboard').classList.add('hidden')
          throw new Error('Token không hợp lệ. Vui lòng đăng nhập lại.')
        }
        
        const result = await response.json()

        if (!result.ok) {
          const errorMsg = result.error || result.message || 'Cập nhật thất bại'
          console.error('Edit user failed:', errorMsg)
          throw new Error(errorMsg)
        }
        
        alert('Chỉnh sửa thành công!')
        closeEditModal()
        // Force reload users list
        await loadUsers()
      } catch (error) {
        console.error('Error saving user edit:', error)
        showError(error.message)
      }
    }
    
    // Setup login button and enter key
    const loginButton = document.getElementById('loginButton')
    const emailInput = document.getElementById('emailInput')
    const tokenInput = document.getElementById('tokenInput')
    
    if (loginButton) {
      loginButton.addEventListener('click', saveToken)
    }

    if (emailInput) {
      emailInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') saveToken()
      })
    }
    
    if (tokenInput) {
      tokenInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') saveToken()
      })
    }
    
    async function loadCurrentAdmin() {
      if (!ADMIN_TOKEN) return null
      try {
        const res = await fetchWithAuth(\`\${API_BASE}/api/admin/auth/me\`)
        CURRENT_ADMIN = res.admin || null
        return CURRENT_ADMIN
      } catch {
        CURRENT_ADMIN = null
        return null
      }
    }

    function isOwner() {
      return CURRENT_ADMIN && CURRENT_ADMIN.role === 'owner'
    }

    function applyRoleUI() {
      const owner = isOwner()
      document.querySelectorAll('[data-owner-only="true"]').forEach(el => {
        el.style.display = owner ? '' : 'none'
      })
      document.getElementById('authOverlay').classList.add('hidden')
      document.getElementById('dashboard').classList.remove('hidden')
      switchTab(owner ? 'events' : 'users')
    }

    if (ADMIN_TOKEN) {
      loadCurrentAdmin().then(admin => {
        if (admin) applyRoleUI()
      })
    }
    
    async function saveToken() {
      const email = document.getElementById('emailInput').value.trim().toLowerCase()
      const password = document.getElementById('tokenInput').value
      if (!email || !password) {
        document.getElementById('authError').textContent = 'Vui long nhap email va mat khau'
        document.getElementById('authError').classList.remove('hidden')
        return
      }

      try {
        const response = await fetch(\`\${API_BASE}/api/admin/auth/login\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        })
        const result = await response.json().catch(() => ({}))
        if (!response.ok || !result.ok || !result.token) {
          document.getElementById('authError').textContent = result.error || 'Dang nhap that bai'
          document.getElementById('authError').classList.remove('hidden')
          return
        }

        ADMIN_TOKEN = result.token
        CURRENT_ADMIN = result.admin || null
        localStorage.setItem('admin_session_token', result.token)
        localStorage.removeItem('admin_token')
        document.getElementById('authOverlay').classList.add('hidden')
        document.getElementById('dashboard').classList.remove('hidden')
        applyRoleUI()
      } catch (error) {
        console.error('Error logging in:', error)
        document.getElementById('authError').textContent = 'Loi khi dang nhap: ' + error.message
        document.getElementById('authError').classList.remove('hidden')
      }
    }
    
    async function fetchWithAuth(url, options = {}) {
      if (!ADMIN_TOKEN) throw new Error('Chưa có admin token')
      const response = await fetch(url, { 
        ...options,
        headers: { 
          'Authorization': \`Bearer \${ADMIN_TOKEN}\`,
          ...(options.headers || {})
        } 
      })
      let payload = null
      try { payload = await response.json() } catch {}
      if (response.status === 401) {
        localStorage.removeItem('admin_session_token'); localStorage.removeItem('admin_token')
        ADMIN_TOKEN = ''
        document.getElementById('authOverlay').classList.remove('hidden')
        document.getElementById('dashboard').classList.add('hidden')
        document.getElementById('tokenInput').value = ''
        throw new Error('Token không hợp lệ. Vui lòng đăng nhập lại.')
      }
      if (!response.ok) throw new Error(payload?.error || \`Loi HTTP \${response.status}: \${response.statusText}\`)
      return payload
    }
    
    function showError(message) {
      const container = document.getElementById('errorContainer')
      const div = document.createElement('div')
      div.className = 'error'
      div.textContent = 'Lỗi: ' + message
      container.innerHTML = ''
      container.appendChild(div)
    }
    
    function clearError() { document.getElementById('errorContainer').innerHTML = '' }
    
    function updateLastUpdate() {
      const now = new Date()
      document.getElementById('lastUpdate').textContent = now.toLocaleString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
    }
    
    async function loadStats() {
      try {
        const hours = parseInt(document.getElementById('hoursFilter').value) || 24
        const stats = await fetchWithAuth(\`\${API_BASE}/api/admin/stats?hours=\${hours}\`)
        if (!stats.ok) throw new Error(stats.error)
        
        const total = stats.stats.total || 0
        const critical = stats.stats.bySeverity.critical || 0
        const high = stats.stats.bySeverity.high || 0
        const medium = stats.stats.bySeverity.medium || 0
        const low = stats.stats.bySeverity.low || 0
        
        document.getElementById('totalEvents').textContent = formatNumber(total)
        document.getElementById('totalEventsLabel').textContent = \`trong \${hours} giờ qua\`
        document.getElementById('criticalCount').textContent = formatNumber(critical)
        document.getElementById('highCount').textContent = formatNumber(high)
        document.getElementById('mediumCount').textContent = formatNumber(medium)
        document.getElementById('lowCount').textContent = formatNumber(low)
        
        updateTypeChart(stats.stats.byType)
        updateSeverityChart(stats.stats.bySeverity)
        updateLastUpdate()
      } catch (error) { showError(error.message) }
    }
    
    function updateTypeChart(byType) {
      const canvas = document.getElementById('typeChart')
      const empty = document.getElementById('typeChartEmpty')
      if (typeChart) typeChart.destroy()
      const entries = Object.entries(byType || {}).filter(([, value]) => Number(value) > 0)
      if (!entries.length || typeof Chart === 'undefined') {
        canvas.style.display = 'none'
        if (empty) {
          empty.textContent = typeof Chart === 'undefined'
            ? 'Không tải được thư viện biểu đồ. Vui lòng tải lại trang.'
            : 'Không có dữ liệu trong khoảng thời gian đã chọn'
          empty.classList.remove('hidden')
        }
        return
      }
      canvas.style.display = ''
      if (empty) empty.classList.add('hidden')
      const ctx = canvas.getContext('2d')
      
      const labels = entries.map(([key]) => eventTypeLabels[key] || key)
      const data = entries.map(([, value]) => value)
      
      typeChart = new Chart(ctx, {
        type: 'bar',
        data: { 
          labels: labels, 
          datasets: [{ 
            label: 'Số Lượng', 
            data: data, 
            backgroundColor: 'rgba(14, 165, 233, 0.8)',
            borderColor: '#0ea5e9',
            borderWidth: 2
          }] 
        },
        options: { 
          responsive: true, 
          maintainAspectRatio: true,
          plugins: { 
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (context) => \`\${context.parsed.y} sự kiện\`
              }
            }
          }, 
          scales: { 
            y: { 
              beginAtZero: true, 
              ticks: { color: '#94a3b8', callback: (value) => formatNumber(value) }, 
              grid: { color: '#334155' } 
            }, 
            x: { 
              ticks: { color: '#94a3b8', maxRotation: 45, minRotation: 45 }, 
              grid: { color: '#334155', display: false } 
            } 
          } 
        }
      })
    }
    
    function updateSeverityChart(bySeverity) {
      const canvas = document.getElementById('severityChart')
      const empty = document.getElementById('severityChartEmpty')
      if (severityChart) severityChart.destroy()
      const entries = Object.entries(bySeverity || {}).filter(([, value]) => Number(value) > 0)
      if (!entries.length || typeof Chart === 'undefined') {
        canvas.style.display = 'none'
        if (empty) {
          empty.textContent = typeof Chart === 'undefined'
            ? 'Không tải được thư viện biểu đồ. Vui lòng tải lại trang.'
            : 'Không có dữ liệu trong khoảng thời gian đã chọn'
          empty.classList.remove('hidden')
        }
        return
      }
      canvas.style.display = ''
      if (empty) empty.classList.add('hidden')
      const ctx = canvas.getContext('2d')
      
      const colors = { 
        critical: '#ef4444', 
        high: '#f97316', 
        medium: '#eab308', 
        low: '#22c55e' 
      }
      
      const labels = entries.map(([key]) => severityLabels[key] || key)
      const data = entries.map(([, value]) => value)
      const bgColors = entries.map(([s]) => colors[s] || '#64748b')
      
      severityChart = new Chart(ctx, {
        type: 'doughnut',
        data: { 
          labels: labels, 
          datasets: [{ 
            data: data, 
            backgroundColor: bgColors,
            borderWidth: 2,
            borderColor: '#0f172a'
          }] 
        },
        options: { 
          responsive: true, 
          maintainAspectRatio: true,
          plugins: { 
            legend: { 
              position: 'right',
              labels: { 
                color: '#94a3b8',
                padding: 15,
                font: { size: 13 }
              } 
            },
            tooltip: {
              callbacks: {
                label: (context) => {
                  const total = context.dataset.data.reduce((a, b) => a + b, 0)
                  const percent = ((context.parsed / total) * 100).toFixed(1)
                  return \`\${context.label}: \${formatNumber(context.parsed)} (\${percent}%)\`
                }
              }
            }
          } 
        }
      })
    }
    
    async function loadTimeline() {
      try {
        const hours = parseInt(document.getElementById('hoursFilter')?.value || '24') || 24
        const groupBy = document.getElementById('timelineGroupBy')?.value || 'day'
        const severity = document.getElementById('severityFilter').value
        const eventType = document.getElementById('eventTypeFilter').value
        
        const params = new URLSearchParams({ hours: hours.toString(), groupBy })
        if (severity) params.append('severity', severity)
        if (eventType) params.append('eventType', eventType)
        
        const result = await fetchWithAuth(\`\${API_BASE}/api/admin/timeline?\${params}\`)
        if (!result.ok) throw new Error(result.error)
        
        // Update trend info
        const trend = result.trend
        const trendValue = document.getElementById('timelineTrendValue')
        const currentCount = document.getElementById('timelineCurrentCount')
        const previousCount = document.getElementById('timelinePreviousCount')
        
        currentCount.textContent = formatNumber(trend.current)
        previousCount.textContent = formatNumber(trend.previous)
        
        if (trend.change > 0) {
          trendValue.textContent = \`↑ +\${trend.changePercent}%\`
          trendValue.style.color = '#ef4444'
        } else if (trend.change < 0) {
          trendValue.textContent = \`↓ \${trend.changePercent}%\`
          trendValue.style.color = '#22c55e'
        } else {
          trendValue.textContent = '→ 0%'
          trendValue.style.color = '#94a3b8'
        }
        
        // Update chart
        updateTimelineChart(result.timeline, result.groupBy)
      } catch (error) {
        console.error('Error loading timeline:', error)
      }
    }
    
    function updateTimelineChart(timeline, groupBy) {
      const canvas = document.getElementById('timelineChart')
      const empty = document.getElementById('timelineChartEmpty')
      if (timelineChart) timelineChart.destroy()
      if (!timeline?.length || typeof Chart === 'undefined') {
        canvas.style.display = 'none'
        if (empty) {
          empty.textContent = typeof Chart === 'undefined'
            ? 'Không tải được thư viện biểu đồ. Vui lòng tải lại trang.'
            : 'Không có dữ liệu xu hướng trong khoảng thời gian đã chọn'
          empty.classList.remove('hidden')
        }
        return
      }
      canvas.style.display = ''
      if (empty) empty.classList.add('hidden')
      const ctx = canvas.getContext('2d')
      
      const labels = timeline.map(t => {
        if (groupBy === 'hour') {
          return new Date(t.time_bucket).toLocaleString('vi-VN', { month: '2-digit', day: '2-digit', hour: '2-digit' })
        } else if (groupBy === 'day') {
          return new Date(t.time_bucket).toLocaleDateString('vi-VN', { month: '2-digit', day: '2-digit' })
        } else {
          return t.time_bucket
        }
      })
      
      timelineChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [
            {
              label: 'Tổng',
              data: timeline.map(t => t.count),
              borderColor: '#0ea5e9',
              backgroundColor: 'rgba(14, 165, 233, 0.1)',
              borderWidth: 2,
              fill: true,
              tension: 0.4
            },
            {
              label: 'Nghiêm trọng',
              data: timeline.map(t => t.critical_count),
              borderColor: '#ef4444',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              borderWidth: 2,
              fill: false,
              tension: 0.4
            },
            {
              label: 'Cao',
              data: timeline.map(t => t.high_count),
              borderColor: '#f97316',
              backgroundColor: 'rgba(249, 115, 22, 0.1)',
              borderWidth: 2,
              fill: false,
              tension: 0.4
            },
            {
              label: 'Trung bình',
              data: timeline.map(t => t.medium_count),
              borderColor: '#eab308',
              backgroundColor: 'rgba(234, 179, 8, 0.1)',
              borderWidth: 2,
              fill: false,
              tension: 0.4
            },
            {
              label: 'Thấp',
              data: timeline.map(t => t.low_count),
              borderColor: '#22c55e',
              backgroundColor: 'rgba(34, 197, 94, 0.1)',
              borderWidth: 2,
              fill: false,
              tension: 0.4
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          plugins: {
            legend: {
              position: 'top',
              labels: {
                color: '#94a3b8',
                padding: 10,
                font: { size: 12 }
              }
            },
            tooltip: {
              mode: 'index',
              intersect: false,
              callbacks: {
                label: (context) => \`\${context.dataset.label}: \${formatNumber(context.parsed.y)}\`
              }
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: {
                color: '#94a3b8',
                callback: (value) => formatNumber(value)
              },
              grid: { color: '#334155' }
            },
            x: {
              ticks: { color: '#94a3b8' },
              grid: { color: '#334155', display: false }
            }
          },
          interaction: {
            mode: 'nearest',
            axis: 'x',
            intersect: false
          }
        }
      })
    }
    
    async function loadEvents() {
      try {
        const severity = document.getElementById('severityFilter').value
        const eventType = document.getElementById('eventTypeFilter').value
        const params = new URLSearchParams({ limit: '100' })
        if (severity) params.append('severity', severity)
        if (eventType) params.append('eventType', eventType)
        
        const result = await fetchWithAuth(\`\${API_BASE}/api/admin/events?\${params}\`)
        if (!result.ok) throw new Error(result.error)
        
        const tbody = document.getElementById('eventsTableBody')
        if (result.events.length === 0) { 
          tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Không tìm thấy sự kiện nào</td></tr>'
          return 
        }
        
        tbody.innerHTML = result.events.map(event => {
          const severityClass = \`badge-\${escapeHtml(event.severity)}\`
          const severityText = severityLabels[event.severity] || escapeHtml(event.severity.toUpperCase())
          const eventTypeText = eventTypeLabels[event.event_type] || escapeHtml(event.event_type)
          const hasDetails = event.details && event.details !== '{}' && event.details.trim() !== ''
          const detailsEscaped = hasDetails ? escapeForJsString(event.details) : ''

          return \`
            <tr>
              <td>\${formatDateTime(event.timestamp)}</td>
              <td>\${eventTypeText}</td>
              <td><span class="badge \${severityClass}">\${severityText}</span></td>
              <td>\${escapeHtml(event.message)}</td>
              <td><code>\${escapeHtml((event.machine_id || '').substring(0, 20))}...</code></td>
              <td>\${escapeHtml(event.username) || '-'}</td>
              <td>\${escapeHtml(event.app_version) || '-'}</td>
              <td>\${hasDetails ? \`<button class="action-btn btn-edit" onclick="showEventDetails('\${detailsEscaped}')" style="padding: 4px 8px; font-size: 11px;">📋 Xem</button>\` : '-'}</td>
            </tr>
          \`
        }).join('')
      } catch (error) { showError(error.message) }
    }
    
    async function refreshData() { 
      if (!ADMIN_TOKEN) return
      clearError()
      if (!isOwner()) {
        await loadUsers()
        return
      }
      try {
        await Promise.all([
          loadStats().catch(err => { console.error('Error loading stats:', err); return null }),
          loadEvents().catch(err => { console.error('Error loading events:', err); return null }),
          loadTimeline().catch(err => { console.error('Error loading timeline:', err); return null })
        ])
      } catch (error) {
        console.error('Error in refreshData:', error)
        showError('Lỗi khi tải dữ liệu: ' + error.message)
      }
    }
    
    function autoRefresh() {
      if (autoRefreshInterval) { 
        clearInterval(autoRefreshInterval)
        autoRefreshInterval = null
        document.getElementById('autoRefreshStatus').textContent = 'TẮT'
      } else { 
        autoRefreshInterval = setInterval(refreshData, 30000)
        document.getElementById('autoRefreshStatus').textContent = 'BẬT'
      }
    }
    
    // Show event details
    function showEventDetails(detailsJson) {
      try {
        // Unescape HTML entities
        const unescaped = detailsJson.replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        const details = JSON.parse(unescaped)
        const formatted = JSON.stringify(details, null, 2)
        document.getElementById('eventDetailsContent').textContent = formatted
        document.getElementById('eventDetailsModal').classList.add('active')
      } catch (error) {
        // If not valid JSON, show as-is
        const unescaped = detailsJson.replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        document.getElementById('eventDetailsContent').textContent = unescaped
        document.getElementById('eventDetailsModal').classList.add('active')
      }
    }
    
    function closeEventDetailsModal() {
      document.getElementById('eventDetailsModal').classList.remove('active')
    }
    
    // Show user machines
    async function showUserMachines(username) {
      try {
        const result = await fetchWithAuth(\`\${API_BASE}/api/admin/users/\${username}/machines\`)
        if (!result.ok) throw new Error(result.error || 'Không thể tải thông tin máy')
        
        const content = document.getElementById('userMachinesContent')
        if (result.machines.length === 0) {
          content.innerHTML = '<div class="empty-state">Không có máy nào</div>'
        } else {
          content.innerHTML = result.machines.map(m => {
            const firstSeen = formatDateTime(m.first_seen)
            const lastSeen = formatDateTime(m.last_seen)
            return \`
              <div class="machine-item">
                <code>\${escapeHtml(m.machine_id)}</code>
                <div class="info">Lần đầu: \${firstSeen}</div>
                <div class="info">Lần cuối: \${lastSeen}</div>
                <div class="info">Số lần truy cập: \${formatNumber(m.request_count)}</div>
              </div>
            \`
          }).join('')
        }
        
        document.getElementById('userMachinesModal').classList.add('active')
      } catch (error) {
        showError(error.message)
      }
    }
    
    function closeUserMachinesModal() {
      document.getElementById('userMachinesModal').classList.remove('active')
    }
    
    // Show auto-block rules
    // Format auto-block rules into HTML (shared by tab and modal)
    function formatAutoBlockRules(rules) {
      if (!rules || rules.length === 0) {
        return '<div class="empty-state">Không có quy tắc nào</div>'
      }
      const actionLabels = { block: '🚫 Chặn', revoke_license: '🔑 Thu Hồi License', warn: '⚠️ Cảnh Báo' }
      return \`
        <div style="margin-bottom: 20px; color: #94a3b8; font-size: 14px;">
          Hệ thống sẽ tự động thực hiện hành động khi đạt ngưỡng sự kiện trong khoảng thời gian quy định.
        </div>
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="border-bottom: 2px solid #334155;">
              <th style="padding: 12px; text-align: left; font-size: 12px; color: #94a3b8;">Loại Sự Kiện</th>
              <th style="padding: 12px; text-align: center; font-size: 12px; color: #94a3b8;">Mức Độ</th>
              <th style="padding: 12px; text-align: center; font-size: 12px; color: #94a3b8;">Ngưỡng</th>
              <th style="padding: 12px; text-align: center; font-size: 12px; color: #94a3b8;">Thời Gian</th>
              <th style="padding: 12px; text-align: center; font-size: 12px; color: #94a3b8;">Hành Động</th>
            </tr>
          </thead>
          <tbody>
            \${rules.map(rule => {
              const eventTypeText = eventTypeLabels[rule.eventType] || escapeHtml(rule.eventType)
              const severityText = severityLabels[rule.severity] || escapeHtml(rule.severity)
              const actionText = actionLabels[rule.action] || escapeHtml(rule.action)
              return \`
                <tr style="border-bottom: 1px solid #334155;">
                  <td style="padding: 12px;"><strong>\${eventTypeText}</strong></td>
                  <td style="padding: 12px; text-align: center;"><span class="badge badge-\${escapeHtml(rule.severity)}">\${severityText}</span></td>
                  <td style="padding: 12px; text-align: center; font-weight: 600; color: #0ea5e9;">\${rule.threshold}</td>
                  <td style="padding: 12px; text-align: center; color: #94a3b8;">\${rule.timeWindowSeconds}s</td>
                  <td style="padding: 12px; text-align: center;">\${actionText}</td>
                </tr>
              \`
            }).join('')}
          </tbody>
        </table>
      \`
    }

    async function showAutoBlockRules() {
      try {
        const result = await fetchWithAuth(\`\${API_BASE}/api/admin/auto-block-rules\`)
        if (!result.ok) throw new Error(result.error)

        const content = document.getElementById('autoBlockRulesContent')
        content.innerHTML = formatAutoBlockRules(result.rules)

        document.getElementById('autoBlockRulesModal').classList.add('active')
      } catch (error) {
        showError(error.message)
      }
    }
    
    function closeAutoBlockRulesModal() {
      document.getElementById('autoBlockRulesModal').classList.remove('active')
    }
    
    // Export functions
    async function exportEvents(format) {
      try {
        const severity = document.getElementById('severityFilter').value
        const eventType = document.getElementById('eventTypeFilter').value
        const hours = parseInt(document.getElementById('hoursFilter')?.value || '24') || 24
        
        const params = new URLSearchParams({ format, hours })
        if (severity) params.append('severity', severity)
        if (eventType) params.append('eventType', eventType)
        
        const url = \`\${API_BASE}/api/admin/export/events?\${params}\`
        const response = await fetch(url, {
          headers: { 'Authorization': \`Bearer \${ADMIN_TOKEN}\` }
        })
        
        if (response.status === 401) {
          localStorage.removeItem('admin_session_token'); localStorage.removeItem('admin_token')
          ADMIN_TOKEN = ''
          document.getElementById('authOverlay').classList.remove('hidden')
          document.getElementById('dashboard').classList.add('hidden')
          throw new Error('Token không hợp lệ. Vui lòng đăng nhập lại.')
        }
        
        const blob = await response.blob()
        const downloadUrl = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = downloadUrl
        a.download = \`events_\${Date.now()}.\${format}\`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        window.URL.revokeObjectURL(downloadUrl)
      } catch (error) {
        showError(error.message)
      }
    }
    
    async function exportUsers(format) {
      try {
        const status = document.getElementById('userStatusFilter').value
        const search = document.getElementById('userSearchInput').value.trim()
        
        const params = new URLSearchParams({ format })
        if (status) params.append('status', status)
        if (search) params.append('search', search)
        
        const url = \`\${API_BASE}/api/admin/export/users?\${params}\`
        const response = await fetch(url, {
          headers: { 'Authorization': \`Bearer \${ADMIN_TOKEN}\` }
        })
        
        if (response.status === 401) {
          localStorage.removeItem('admin_session_token'); localStorage.removeItem('admin_token')
          ADMIN_TOKEN = ''
          document.getElementById('authOverlay').classList.remove('hidden')
          document.getElementById('dashboard').classList.add('hidden')
          throw new Error('Token không hợp lệ. Vui lòng đăng nhập lại.')
        }
        
        const blob = await response.blob()
        const downloadUrl = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = downloadUrl
        a.download = \`users_\${Date.now()}.\${format}\`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        window.URL.revokeObjectURL(downloadUrl)
      } catch (error) {
        showError(error.message)
      }
    }
    
    // Bulk actions
    let selectedUserIds = new Set()
    let currentUsersPage = 1
    let currentUsersTotal = 0
    let currentUsersPageSize = 25
    
    function toggleSelectAll() {
      const checkbox = document.getElementById('selectAllUsers')
      const checkboxes = document.querySelectorAll('input[type="checkbox"][data-user-id]')
      
      checkboxes.forEach(cb => {
        cb.checked = checkbox.checked
        if (checkbox.checked) {
          selectedUserIds.add(cb.dataset.userId)
        } else {
          selectedUserIds.delete(cb.dataset.userId)
        }
      })
      
      updateBulkActionsBar()
    }
    
    function toggleUserSelection(userId) {
      if (selectedUserIds.has(userId)) {
        selectedUserIds.delete(userId)
      } else {
        selectedUserIds.add(userId)
      }
      updateBulkActionsBar()
      updateSelectAllCheckbox()
    }
    
    function updateSelectAllCheckbox() {
      const checkbox = document.getElementById('selectAllUsers')
      const checkboxes = document.querySelectorAll('input[type="checkbox"][data-user-id]')
      const checkedCount = Array.from(checkboxes).filter(cb => cb.checked).length
      checkbox.checked = checkedCount === checkboxes.length && checkboxes.length > 0
      checkbox.indeterminate = checkedCount > 0 && checkedCount < checkboxes.length
    }
    
    function clearSelection() {
      selectedUserIds.clear()
      document.querySelectorAll('input[type="checkbox"][data-user-id]').forEach(cb => cb.checked = false)
      document.getElementById('selectAllUsers').checked = false
      updateBulkActionsBar()
    }
    
    function updateBulkActionsBar() {
      const bar = document.getElementById('bulkActionsBar')
      const count = document.getElementById('selectedCount')
      count.textContent = \`\${selectedUserIds.size} đã chọn\`
      bar.style.display = selectedUserIds.size > 0 ? 'block' : 'none'
    }
    
    async function bulkUpdateUsers(status) {
      if (selectedUserIds.size === 0) {
        alert('Vui lòng chọn ít nhất một người dùng!')
        return
      }
      
      const statusText = status === 'CHO_PHEP' ? 'Duyệt' : status === 'CHAN' ? 'Chặn' : 'Về Chờ Duyệt'
      if (!confirm(\`Bạn chắc chắn muốn \${statusText} \${selectedUserIds.size} người dùng đã chọn?\`)) return
      
      try {
        const response = await fetch(\`\${API_BASE}/api/admin/users/bulk-update\`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': \`Bearer \${ADMIN_TOKEN}\`
          },
          body: JSON.stringify({ userIds: Array.from(selectedUserIds), status })
        })
        
        if (response.status === 401) {
          localStorage.removeItem('admin_session_token'); localStorage.removeItem('admin_token')
          ADMIN_TOKEN = ''
          document.getElementById('authOverlay').classList.remove('hidden')
          document.getElementById('dashboard').classList.add('hidden')
          throw new Error('Token không hợp lệ. Vui lòng đăng nhập lại.')
        }
        
        const result = await response.json()
        if (!result.ok) throw new Error(result.error || 'Cập nhật thất bại')
        
        alert(\`Đã cập nhật \${result.changes} người dùng thành công!\`)
        clearSelection()
        await loadUsers()
      } catch (error) {
        showError(error.message)
      }
    }
    
    // Pagination
    function changeUsersPage(delta) {
      const totalPages = Math.ceil(currentUsersTotal / currentUsersPageSize)
      const newPage = currentUsersPage + delta
      if (newPage >= 1 && newPage <= totalPages) {
        currentUsersPage = newPage
        loadUsers()
      }
    }
    
    function updateUsersPagination() {
      const totalPages = Math.ceil(currentUsersTotal / currentUsersPageSize)
      const start = (currentUsersPage - 1) * currentUsersPageSize + 1
      const end = Math.min(currentUsersPage * currentUsersPageSize, currentUsersTotal)
      
      document.getElementById('usersPaginationInfo').textContent = 
        \`Hiển thị \${start}-\${end} / \${currentUsersTotal}\`
      
      document.getElementById('usersPrevBtn').disabled = currentUsersPage === 1
      document.getElementById('usersNextBtn').disabled = currentUsersPage >= totalPages
      
      const pageNumbers = document.getElementById('usersPageNumbers')
      pageNumbers.innerHTML = ''
      
      const maxPages = 5
      let startPage = Math.max(1, currentUsersPage - Math.floor(maxPages / 2))
      let endPage = Math.min(totalPages, startPage + maxPages - 1)
      if (endPage - startPage < maxPages - 1) {
        startPage = Math.max(1, endPage - maxPages + 1)
      }
      
      for (let i = startPage; i <= endPage; i++) {
        const btn = document.createElement('button')
        btn.textContent = i
        btn.style.padding = '8px 12px'
        btn.style.background = i === currentUsersPage ? '#0ea5e9' : '#0f172a'
        btn.style.border = '1px solid #334155'
        btn.style.borderRadius = '6px'
        btn.style.color = '#e2e8f0'
        btn.style.cursor = 'pointer'
        btn.onclick = () => { currentUsersPage = i; loadUsers() }
        pageNumbers.appendChild(btn)
      }
    }
    
    // Update loadUsers to support search and pagination
    const originalLoadUsers = loadUsers
    loadUsers = async function() {
      try {
        const status = document.getElementById('userStatusFilter').value
        const search = document.getElementById('userSearchInput').value.trim()
        currentUsersPageSize = parseInt(document.getElementById('usersPageSize').value) || 25
        const offset = (currentUsersPage - 1) * currentUsersPageSize
        
        const params = new URLSearchParams({ 
          limit: currentUsersPageSize.toString(),
          offset: offset.toString()
        })
        if (status) params.append('status', status)
        if (search) params.append('search', search)

        const response = await fetch(\`\${API_BASE}/api/admin/users?\${params}\`, {
          headers: { 
            'Authorization': \`Bearer \${ADMIN_TOKEN}\`
          }
        })
        
        if (response.status === 401) {
          localStorage.removeItem('admin_session_token'); localStorage.removeItem('admin_token')
          ADMIN_TOKEN = ''
          document.getElementById('authOverlay').classList.remove('hidden')
          document.getElementById('dashboard').classList.add('hidden')
          throw new Error('Token không hợp lệ. Vui lòng đăng nhập lại.')
        }
        
        const result = await response.json()

        if (!result.ok) throw new Error(result.error)
        
        currentUsersTotal = result.total || 0
        updateUsersPagination()
        
        const tbody = document.getElementById('usersTableBody')
        if (!result.users || result.users.length === 0) {
          tbody.innerHTML = '<tr><td colspan="11" class="empty-state">Không tìm thấy người dùng nào</td></tr>'
          return
        }

        tbody.innerHTML = result.users.map(user => {
          const safeTaiKhoan = escapeHtml(user.tai_khoan)
          const jsTaiKhoan = escapeForJsString(user.tai_khoan)
          const safeMaMay = escapeHtml(user.ma_may)
          const safeVersion = escapeHtml(user.version)
          const statusClass = \`status-\${escapeHtml(user.trang_thai.toLowerCase())}\`
          const statusText = statusLabels[user.trang_thai] || escapeHtml(user.trang_thai)
          const createdDate = new Date(user.thoi_gian_tao).toLocaleString('vi-VN')
          const lastActive = user.last_active ? formatDateTime(user.last_active) : 'Chưa có'
          const machineIdCell = user.ma_may
            ? \`<span class="clickable" title="Xem chi tiết" onclick="openUserDetail('\${user.id}')"><code>\${safeMaMay.substring(0, 24)}...</code></span>\`
            : '<span style="color: #64748b;">-</span>'
          const activationKey = user.key_kich_hoat
            ? \`<span class="clickable" title="Xem chi tiết key" onclick="openUserDetail('\${user.id}')"><code style="font-size: 11px;">\${escapeHtml(user.key_kich_hoat.substring(0, 20))}...</code></span>\`
            : '<span style="color: #64748b;">-</span>'
          const machineCount = user.machine_count || 0
          const multipleMachinesWarning = machineCount > 1 ? \`<span style="color: #f97316; font-size: 12px; cursor: pointer;" onclick="showUserMachines('\${jsTaiKhoan}')" title="⚠️ Click để xem chi tiết \${machineCount} máy">⚠️ \${machineCount}</span>\` : (machineCount > 0 ? \`<span style="cursor: pointer;" onclick="showUserMachines('\${jsTaiKhoan}')" title="Click để xem chi tiết">\${machineCount}</span>\` : '0')
          const isSelected = selectedUserIds.has(user.id)
          const userRawPwd = user.mat_khau || ''

          // V2: Get key_status
          const keyStatus = user.key_status || 'PENDING'
          const keyStatusLabels = {
            'PENDING': '⏳ Chờ',
            'ACTIVE': '✅ Hoạt động',
            'LOCKED': '🔒 Đã khóa',
            'REVOKED': '🚫 Đã thu hồi'
          }
          const keyStatusText = keyStatusLabels[keyStatus] || escapeHtml(keyStatus)

          const ddId = \`dd2-\${user.id}\`
          let menuItems = \`<button class="action-dropdown-item" onclick="openEditModal('\${user.id}')">✏️ Sửa</button>\`
          menuItems += \`<button class="action-dropdown-item" onclick="resetUserPassword('\${user.id}', '\${jsTaiKhoan}')">Reset mật khẩu</button>\`
          if (user.trang_thai === 'CHO_DUYET') {
            menuItems += \`<button class="action-dropdown-item" onclick="updateUserStatus('\${user.id}', 'CHO_PHEP')">✅ Duyệt</button>\`
            menuItems += \`<button class="action-dropdown-item" onclick="updateUserStatus('\${user.id}', 'CHAN')">🚫 Chặn</button>\`
          } else if (user.trang_thai === 'CHO_PHEP') {
            menuItems += \`<button class="action-dropdown-item" onclick="updateUserStatus('\${user.id}', 'CHAN')">🚫 Chặn</button>\`
            if (keyStatus === 'LOCKED') {
              menuItems += \`<button class="action-dropdown-item" onclick="unlockKey('\${jsTaiKhoan}')">🔓 Mở khóa key</button>\`
            }
            if (keyStatus === 'ACTIVE' || keyStatus === 'LOCKED') {
              menuItems += \`<button class="action-dropdown-item" onclick="revokeKey('\${jsTaiKhoan}')">🔑 Thu hồi key</button>\`
            }
            menuItems += \`<button class="action-dropdown-item" onclick="allowRebind('\${jsTaiKhoan}')">🔄 Đổi máy</button>\`
          } else if (user.trang_thai === 'CHAN') {
            menuItems += \`<button class="action-dropdown-item" onclick="updateUserStatus('\${user.id}', 'CHO_PHEP')">🔓 Bỏ chặn</button>\`
          }
          menuItems += \`<div class="action-dropdown-divider"></div>\`
          menuItems += \`<button class="action-dropdown-item danger" onclick="deleteUser('\${user.id}')">🗑️ Xóa</button>\`

          const actions = \`<div class="action-dropdown" id="\${ddId}">
            <button class="action-dropdown-btn" onclick="toggleDropdown(event, '\${ddId}')">⋮ Thao Tác</button>
            <div class="action-dropdown-menu">\${menuItems}</div>
          </div>\`

          return \`
            <tr>
              <td><input type="checkbox" data-user-id="\${user.id}" \${isSelected ? 'checked' : ''} onchange="toggleUserSelection('\${user.id}')"></td>
              <td><strong>\${safeTaiKhoan}</strong></td>
              <td>\${userRawPwd ? \`<input type="password" value="\${escapeHtml(userRawPwd)}" readonly style="width: 80px; padding: 2px 6px; background: #0f172a; border: 1px solid #334155; border-radius: 4px; color: #e2e8f0; font-size: 11px;">\` : '<span style="color: #64748b;">-</span>'}</td>
              <td>\${machineIdCell}</td>
              <td><span class="status-badge \${statusClass}">\${statusText}</span></td>
              <td>\${multipleMachinesWarning}</td>
              <td>\${activationKey}</td>
              <td><span class="status-badge" style="font-size: 11px;">\${keyStatusText}</span></td>
              <td>\${lastActive}</td>
              <td><code style="font-size: 11px; color: #0ea5e9;">\${safeVersion || '-'}</code></td>
              <td>\${actions}</td>
            </tr>
          \`
        }).join('')
        
        updateSelectAllCheckbox()
      } catch (error) { 
        showError(error.message) 
      }
    }
    
    // Search debounce
    let searchTimeout = null
    document.addEventListener('DOMContentLoaded', () => {
      const searchInput = document.getElementById('userSearchInput')
      if (searchInput) {
        searchInput.addEventListener('input', () => {
          clearTimeout(searchTimeout)
          searchTimeout = setTimeout(() => {
            currentUsersPage = 1
            loadUsers()
          }, 500)
        })
      }
    })
    
    // Activity Log
    const actionTypeLabels = {
      'approve': '✅ Duyệt',
      'block': '🚫 Chặn',
      'unblock': '🔓 Bỏ Chặn',
      'edit': '✏️ Chỉnh Sửa',
      'bulk_approve': '✅ Duyệt Hàng Loạt',
      'bulk_block': '🚫 Chặn Hàng Loạt',
      'bulk_unblock': '🔓 Bỏ Chặn Hàng Loạt',
      'revoke_key': '🔑 Thu Hồi Key',
      'regenerate_key': '🔑 Tạo Lại Key'
    }
    
    async function loadActivityLog() {
      try {
        const actionType = document.getElementById('activityActionFilter').value
        const targetType = document.getElementById('activityTargetFilter').value
        const hours = parseInt(document.getElementById('activityHoursFilter')?.value || '24') || 24
        
        const params = new URLSearchParams({ hours: hours.toString(), limit: '100' })
        if (actionType) params.append('actionType', actionType)
        if (targetType) params.append('targetType', targetType)
        
        const result = await fetchWithAuth(\`\${API_BASE}/api/admin/activity-log?\${params}\`)
        if (!result.ok) throw new Error(result.error)
        
        const tbody = document.getElementById('activityTableBody')
        if (!result.activities || result.activities.length === 0) {
          tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Không có hoạt động nào</td></tr>'
          return
        }
        
        tbody.innerHTML = result.activities.map(activity => {
          const actionText = actionTypeLabels[activity.action_type] || escapeHtml(activity.action_type)
          const oldValueStr = activity.old_value ? escapeHtml(JSON.stringify(activity.old_value, null, 2).substring(0, 100)) : '-'
          const newValueStr = activity.new_value ? escapeHtml(JSON.stringify(activity.new_value, null, 2).substring(0, 100)) : '-'

          return \`
            <tr>
              <td>\${formatDateTime(activity.timestamp)}</td>
              <td><strong>\${actionText}</strong></td>
              <td>\${escapeHtml(activity.target_type)}</td>
              <td>\${escapeHtml(activity.target_name || activity.target_id) || '-'}</td>
              <td><code style="font-size: 11px;">\${oldValueStr}</code></td>
              <td><code style="font-size: 11px;">\${newValueStr}</code></td>
              <td>\${escapeHtml(activity.admin_ip) || '-'}</td>
            </tr>
          \`
        }).join('')
      } catch (error) {
        showError(error.message)
      }
    }

    async function loadAdmins() {
      try {
        const result = await fetchWithAuth(\`\${API_BASE}/api/admin/admins\`)
        if (!result.ok) throw new Error(result.error || 'Khong tai duoc danh sach admin')
        const tbody = document.getElementById('adminsTableBody')
        const admins = result.admins || []
        if (!admins.length) {
          tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Chua co admin nao</td></tr>'
          return
        }
        tbody.innerHTML = admins.map(admin => {
          const created = admin.created_at ? formatDateTime(admin.created_at) : '-'
          const lastLogin = admin.last_login_at ? formatDateTime(admin.last_login_at) : '-'
          const actions = admin.role === 'owner'
            ? '-'
            : \`
              \${admin.status === 'pending' ? \`<button class="action-btn btn-approve" onclick="adminAction('\${admin.id}', 'approve')">Duyet</button>\` : ''}
              \${admin.status === 'disabled' ? \`<button class="action-btn btn-unblock" onclick="adminAction('\${admin.id}', 'enable')">Mo Khoa</button>\` : \`<button class="action-btn btn-block" onclick="adminAction('\${admin.id}', 'disable')">Khoa</button>\`}
              <button class="action-btn btn-block" onclick="adminAction('\${admin.id}', 'delete')">Xoa</button>
            \`
          return \`
            <tr>
              <td><strong>\${escapeHtml(admin.email)}</strong></td>
              <td>\${escapeHtml(admin.role)}</td>
              <td><span class="status-badge">\${escapeHtml(admin.status)}</span></td>
              <td>\${created}</td>
              <td>\${lastLogin}</td>
              <td>\${actions}</td>
            </tr>
          \`
        }).join('')
      } catch (error) {
        showError(error.message)
      }
    }

    async function adminAction(id, action) {
      if (!confirm('Xac nhan thao tac admin nay?')) return
      try {
        const result = await fetchWithAuth(\`\${API_BASE}/api/admin/admins/\${id}/\${action}\`, { method: 'POST' })
        if (!result.ok) throw new Error(result.error || 'Thao tac that bai')
        await loadAdmins()
      } catch (error) {
        showError(error.message)
      }
    }

    async function createAdminAccount() {
      const emailInput = document.getElementById('newAdminEmail')
      const passwordInput = document.getElementById('newAdminPassword')
      const statusEl = document.getElementById('createAdminStatus')
      const email = emailInput.value.trim().toLowerCase()
      const password = passwordInput.value
      if (statusEl) {
        statusEl.classList.add('hidden')
        statusEl.style.color = ''
        statusEl.textContent = ''
      }
      if (!email || !password) {
        if (statusEl) {
          statusEl.textContent = 'Vui long nhap email va mat khau admin'
          statusEl.classList.remove('hidden')
        } else showError('Vui long nhap email va mat khau admin')
        return
      }
      if (password.length < 8) {
        if (statusEl) {
          statusEl.textContent = 'Mat khau admin toi thieu 8 ky tu'
          statusEl.classList.remove('hidden')
        } else showError('Mat khau admin toi thieu 8 ky tu')
        return
      }
      try {
        const result = await fetchWithAuth(\`\${API_BASE}/api/admin/admins\`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password })
        })
        if (!result.ok) throw new Error(result.error || 'Khong tao duoc admin')
        emailInput.value = ''
        passwordInput.value = ''
        if (statusEl) {
          statusEl.textContent = 'Da tao admin thanh cong'
          statusEl.style.color = '#22c55e'
          statusEl.classList.remove('hidden')
        }
        await loadAdmins()
      } catch (error) {
        if (statusEl) {
          statusEl.textContent = error.message || 'Khong tao duoc admin'
          statusEl.classList.remove('hidden')
        } else showError(error.message)
      }
    }
    
    // License Management
    async function loadLicenses() {
      try {
        const search = document.getElementById('licenseSearchInput')?.value.trim() || ''
        const params = new URLSearchParams()
        if (search) params.append('search', search)
        
        const result = await fetchWithAuth(\`\${API_BASE}/api/admin/licenses?\${params}\`)
        if (!result.ok) throw new Error(result.error)
        
        const tbody = document.getElementById('licensesTableBody')
        if (!result.licenses || result.licenses.length === 0) {
          tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Không có license nào</td></tr>'
          return
        }
        
        tbody.innerHTML = result.licenses.map(license => {
          const statusClass = \`status-\${license.trang_thai.toLowerCase()}\`
          const statusText = statusLabels[license.trang_thai] || license.trang_thai
          const createdDate = new Date(license.thoi_gian_tao).toLocaleString('vi-VN')
          const passwordId = \`pwd-\${license.id}\`
          const rawPwd = license.mat_khau || ''
          _pwdStore.set(passwordId, rawPwd)
          const maskedPassword = rawPwd ? rawPwd.replace(/./g, '*') : '-'

          return \`
            <tr>
              <td><code>\${escapeHtml(license.key_kich_hoat)}</code></td>
              <td><span class="badge \${license.key_status === 'ACTIVE' ? 'badge-info' : license.key_status === 'REVOKED' ? 'badge-critical' : 'badge-medium'}">\${escapeHtml(license.key_status || 'N/A')}</span></td>
              <td><strong>\${escapeHtml(license.tai_khoan)}</strong></td>
              <td>
                <div style="display: flex; align-items: center; gap: 6px;">
                  <input
                    type="password"
                    id="\${passwordId}"
                    value="\${escapeHtml(maskedPassword)}"
                    readonly
                    style="flex: 1; padding: 4px 8px; background: #0f172a; border: 1px solid #334155; border-radius: 4px; color: #e2e8f0; font-size: 12px; min-width: 80px;"
                  />
                  <button 
                    type="button" 
                    class="icon-btn" 
                    onclick="toggleTablePasswordVisibility('\${passwordId}', this)"
                    style="padding: 4px 8px; background: #1e293b; border: 1px solid #334155; border-radius: 4px; cursor: pointer; font-size: 14px; \${!rawPwd ? 'opacity: 0.5; cursor: not-allowed;' : ''}"
                    title="Hiện/Ẩn mật khẩu"
                    \${!rawPwd ? 'disabled' : ''}
                  >👁️</button>
                </div>
              </td>
              <td><code>\${escapeHtml(license.ma_may.substring(0, 24))}...</code></td>
              <td><span class="status-badge \${escapeHtml(statusClass)}">\${escapeHtml(statusText)}</span></td>
              <td>\${createdDate}</td>
              <td>
                <button class="action-btn btn-edit" onclick="revokeLicense('\${escapeForJsString(license.id)}', '\${escapeForJsString(license.key_kich_hoat)}')">🔑 Thu Hồi</button>
                <button class="action-btn btn-approve" onclick="regenerateLicense('\${escapeForJsString(license.id)}')">🔄 Tạo Lại</button>
              </td>
            </tr>
          \`
        }).join('')
      } catch (error) {
        showError(error.message)
      }
    }
    
    async function revokeLicense(userId, key) {
      if (!confirm(\`Bạn chắc chắn muốn thu hồi key này?\`)) return
      try {
        const response = await fetch(\`\${API_BASE}/api/admin/licenses/\${userId}/revoke\`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': \`Bearer \${ADMIN_TOKEN}\`
          }
        })
        if (response.status === 401) {
          localStorage.removeItem('admin_session_token'); localStorage.removeItem('admin_token')
          ADMIN_TOKEN = ''
          document.getElementById('authOverlay').classList.remove('hidden')
          document.getElementById('dashboard').classList.add('hidden')
          throw new Error('Token không hợp lệ. Vui lòng đăng nhập lại.')
        }
        const result = await response.json()
        if (!result.ok) throw new Error(result.error || 'Thu hồi key thất bại')
        alert('Thu hồi key thành công!')
        await loadLicenses()
      } catch (error) {
        showError(error.message)
      }
    }
    
    async function regenerateLicense(userId) {
      if (!confirm(\`Bạn chắc chắn muốn tạo lại key cho user này?\`)) return
      try {
        const response = await fetch(\`\${API_BASE}/api/admin/licenses/\${userId}/regenerate\`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': \`Bearer \${ADMIN_TOKEN}\`
          }
        })
        if (response.status === 401) {
          localStorage.removeItem('admin_session_token'); localStorage.removeItem('admin_token')
          ADMIN_TOKEN = ''
          document.getElementById('authOverlay').classList.remove('hidden')
          document.getElementById('dashboard').classList.add('hidden')
          throw new Error('Token không hợp lệ. Vui lòng đăng nhập lại.')
        }
        const result = await response.json()
        if (!result.ok) throw new Error(result.error || 'Tạo lại key thất bại')
        alert(\`Tạo lại key thành công! Key mới: \${result.key_kich_hoat}\`)
        await loadLicenses()
      } catch (error) {
        showError(error.message)
      }
    }
    
    // Alert Settings
    async function loadAlertSettings() {
      try {
        // Load settings from localStorage or API
        const emailEnabled = localStorage.getItem('emailAlertsEnabled') === 'true'
        const webhookEnabled = localStorage.getItem('webhookAlertsEnabled') === 'true'
        const alertEmail = localStorage.getItem('alertEmail') || ''
        const webhookUrl = localStorage.getItem('webhookUrl') || ''
        const alertThreshold = parseInt(localStorage.getItem('alertThreshold') || '10')
        const alertFrequency = localStorage.getItem('alertFrequency') || 'daily'
        
        document.getElementById('emailAlertsEnabled').checked = emailEnabled
        document.getElementById('webhookAlertsEnabled').checked = webhookEnabled
        document.getElementById('alertEmail').value = alertEmail
        document.getElementById('webhookUrl').value = webhookUrl
        document.getElementById('alertThreshold').value = alertThreshold
        document.getElementById('alertFrequency').value = alertFrequency
        
        // Load event type alerts
        const eventTypes = Object.keys(eventTypeLabels)
        const container = document.getElementById('eventTypeAlerts')
        container.innerHTML = eventTypes.map(eventType => {
          const enabled = localStorage.getItem(\`alert_\${eventType}\`) !== 'false'
          return \`
            <label style="display: flex; align-items: center; gap: 10px; padding: 10px; background: #0f172a; border-radius: 6px; border: 1px solid #334155;">
              <input type="checkbox" \${enabled ? 'checked' : ''} onchange="saveEventTypeAlert('\${eventType}', this.checked)">
              <span>\${eventTypeLabels[eventType] || eventType}</span>
            </label>
          \`
        }).join('')
      } catch (error) {
        showError(error.message)
      }
    }
    
    function saveAlertSettings() {
      const emailEnabled = document.getElementById('emailAlertsEnabled').checked
      const webhookEnabled = document.getElementById('webhookAlertsEnabled').checked
      const alertEmail = document.getElementById('alertEmail').value
      const webhookUrl = document.getElementById('webhookUrl').value
      const alertThreshold = parseInt(document.getElementById('alertThreshold').value)
      const alertFrequency = document.getElementById('alertFrequency').value
      
      localStorage.setItem('emailAlertsEnabled', emailEnabled.toString())
      localStorage.setItem('webhookAlertsEnabled', webhookEnabled.toString())
      localStorage.setItem('alertEmail', alertEmail)
      localStorage.setItem('webhookUrl', webhookUrl)
      localStorage.setItem('alertThreshold', alertThreshold.toString())
      localStorage.setItem('alertFrequency', alertFrequency)
    }
    
    function saveEventTypeAlert(eventType, enabled) {
      localStorage.setItem(\`alert_\${eventType}\`, enabled.toString())
    }
    
    // Version Policy Management
    async function loadVersionPolicy() {
      try {
        const response = await fetch(\`\${API_BASE}/api/version-policy\`)
        if (!response.ok) {
          const errorText = await response.text()
          console.error('Version policy API error:', response.status, errorText)
          throw new Error(\`Không thể tải version policy (HTTP \${response.status}): \${errorText}\`)
        }
        
        const policy = await response.json()
        
        // Fill form fields
        document.getElementById('policyLatestVersion').value = policy.latest_version || ''
        document.getElementById('policyMinSupportedVersion').value = policy.min_supported_version || ''
        document.getElementById('policyRecommendedVersion').value = policy.recommended_version || ''
        document.getElementById('policyRecommendedInstallerUrl').value = policy.recommended_installer_url || ''
        document.getElementById('policyBlockedVersions').value = (policy.blocked_versions || []).join(', ')
        document.getElementById('policyForceUpdate').checked = policy.force_update || false
        document.getElementById('policyMessage').value = policy.message || ''
        
        // Beta channel fields
        document.getElementById('policyBetaLatestVersion').value = policy.beta_latest_version || ''
        document.getElementById('policyBetaUpdateUrl').value = policy.beta_update_url || 'https://license-updates.pages.dev/beta/win/'
        document.getElementById('policyBetaBlockedVersions').value = (policy.beta_blocked_versions || []).join(', ')
        
        // Update preview
        document.getElementById('versionPolicyPreview').textContent = JSON.stringify(policy, null, 2)
        
        // Hide error
        const errorDiv = document.getElementById('versionPolicyError')
        if (errorDiv) {
          errorDiv.classList.add('hidden')
          errorDiv.textContent = ''
        }
      } catch (error) {
        console.error('Error loading version policy:', error)
        const errorDiv = document.getElementById('versionPolicyError')
        if (errorDiv) {
          errorDiv.classList.remove('hidden')
          errorDiv.textContent = \`Lỗi: \${error.message || 'Không thể tải version policy'}\`
        }
        document.getElementById('versionPolicyPreview').textContent = 'Lỗi khi tải policy'
      }
    }
    
    async function saveVersionPolicy() {
      try {
        // Collect form data
        const blockedVersionsStr = document.getElementById('policyBlockedVersions').value.trim()
        const blockedVersions = blockedVersionsStr 
          ? blockedVersionsStr.split(',').map(v => v.trim()).filter(v => v)
          : []
        
        const betaBlockedVersionsStr = document.getElementById('policyBetaBlockedVersions').value.trim()
        const betaBlockedVersions = betaBlockedVersionsStr
          ? betaBlockedVersionsStr.split(',').map(v => v.trim()).filter(v => v)
          : []
        
        const policy = {
          latest_version: document.getElementById('policyLatestVersion').value.trim(),
          min_supported_version: document.getElementById('policyMinSupportedVersion').value.trim(),
          recommended_version: document.getElementById('policyRecommendedVersion').value.trim(),
          recommended_installer_url: document.getElementById('policyRecommendedInstallerUrl').value.trim() || undefined,
          blocked_versions: blockedVersions,
          force_update: document.getElementById('policyForceUpdate').checked,
          message: document.getElementById('policyMessage').value.trim() || undefined,
          channel: 'stable',
          beta_latest_version: document.getElementById('policyBetaLatestVersion').value.trim() || undefined,
          beta_update_url: document.getElementById('policyBetaUpdateUrl').value.trim() || undefined,
          beta_blocked_versions: betaBlockedVersions.length > 0 ? betaBlockedVersions : undefined,
        }
        
        // Validate required fields
        if (!policy.latest_version || !policy.min_supported_version || !policy.recommended_version) {
          throw new Error('Vui lòng điền đầy đủ các trường bắt buộc: Latest Version, Min Supported Version, Recommended Version')
        }
        
        // Confirm before saving
        if (!confirm('Bạn chắc chắn muốn cập nhật version policy? Điều này có thể ảnh hưởng đến tất cả users.')) {
          return
        }
        
        const response = await fetch(\`\${API_BASE}/api/admin/version-policy/update\`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-token': ADMIN_TOKEN
          },
          body: JSON.stringify({ policy })
        })
        
        if (response.status === 401) {
          localStorage.removeItem('admin_session_token'); localStorage.removeItem('admin_token')
          ADMIN_TOKEN = ''
          document.getElementById('authOverlay').classList.remove('hidden')
          document.getElementById('dashboard').classList.add('hidden')
          throw new Error('Token không hợp lệ. Vui lòng đăng nhập lại.')
        }
        
        const result = await response.json()
        
        if (!result.ok) {
          const errorMsg = result.error || result.details || 'Cập nhật version policy thất bại'
          console.error('Save version policy error:', result)
          throw new Error(errorMsg)
        }
        
        alert('✅ Cập nhật version policy thành công!')
        
        // Reload to show updated policy
        await loadVersionPolicy()
      } catch (error) {
        console.error('Error saving version policy:', error)
        const errorDiv = document.getElementById('versionPolicyError')
        if (errorDiv) {
          errorDiv.classList.remove('hidden')
          errorDiv.textContent = \`Lỗi: \${error.message || 'Không thể lưu version policy'}\`
        }
      }
    }
    
  </script>
</body>
</html>`

  return new Response(dashboardHTML, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'Content-Security-Policy': cspPolicy,
      // Additional security headers
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    },
  })
}
