// src/dashboard/v6-dashboard-html.ts — Redesigned v6.0 "Hive Mind" Control Dashboard
// Responsive, glassmorphism, dark/light, Chart.js analytics, command palette (Cmd+K),
// toast notifications, Lucide icons, GSAP transitions. Served at / (default) and /hive.

export const V6_DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">
<meta name="color-scheme" content="dark light">
<title>Shadow Brain v6.0 — Hive Mind Control</title>
<link rel="preconnect" href="https://cdn.jsdelivr.net">
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<script src="https://unpkg.com/lucide@latest/dist/umd/lucide.min.js"></script>
<style>
  /* ──────────────────────────────────────────────────────────────────── */
  /*  Design System Tokens                                               */
  /* ──────────────────────────────────────────────────────────────────── */
  :root {
    /* Dark theme */
    --bg: #030509;
    --bg-elev-1: #090d17;
    --bg-elev-2: #10152a;
    --bg-elev-3: #18203b;
    --bg-glass: rgba(15, 20, 38, 0.55);
    --bg-glass-strong: rgba(22, 28, 52, 0.78);
    --border: rgba(255, 255, 255, 0.08);
    --border-strong: rgba(255, 255, 255, 0.14);
    --border-accent: rgba(24, 255, 255, 0.32);

    --text: #e8ecf4;
    --text-2: #a4afc4;
    --text-3: #64708a;
    --text-dim: #3e4762;

    --brand-cyan: #18ffff;
    --brand-purple: #a855f7;
    --brand-pink: #ec4899;
    --brand-gradient: linear-gradient(135deg, #18ffff 0%, #a855f7 50%, #ec4899 100%);
    --brand-gradient-soft: linear-gradient(135deg, rgba(24,255,255,0.15), rgba(168,85,247,0.15));

    --success: #10e68c;
    --warning: #ffb53f;
    --danger: #ff5864;
    --info: #4fb6ff;

    --radius-sm: 6px;
    --radius: 10px;
    --radius-lg: 14px;
    --radius-xl: 20px;

    --shadow-sm: 0 1px 2px rgba(0,0,0,0.2);
    --shadow: 0 4px 16px rgba(0,0,0,0.24), 0 0 0 1px var(--border);
    --shadow-lg: 0 12px 48px rgba(0,0,0,0.45), 0 0 0 1px var(--border-strong);
    --shadow-glow: 0 0 40px rgba(24,255,255,0.15);

    --duration-fast: 120ms;
    --duration: 220ms;
    --duration-slow: 400ms;
    --easing: cubic-bezier(0.4, 0, 0.2, 1);
    --easing-spring: cubic-bezier(0.34, 1.56, 0.64, 1);

    --sidebar-w: 252px;
    --header-h: 64px;
    --ticker-h: 32px;

    --font-sans: 'Inter', -apple-system, system-ui, 'Segoe UI', Roboto, sans-serif;
    --font-mono: 'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace;
  }

  /* Light theme — clean, high-contrast, professional */
  html[data-theme="light"] {
    --bg: #f7f8fb;
    --bg-elev-1: #ffffff;
    --bg-elev-2: #f2f4f8;
    --bg-elev-3: #e8ecf2;
    --bg-glass: rgba(255, 255, 255, 0.88);
    --bg-glass-strong: rgba(255, 255, 255, 0.96);
    --border: rgba(15, 23, 42, 0.10);
    --border-strong: rgba(15, 23, 42, 0.18);
    --border-accent: rgba(99, 102, 241, 0.38);
    --text: #0a0f1c;
    --text-2: #2b3648;
    --text-3: #55607a;
    --text-dim: #9ca3af;
    --brand-cyan: #0891b2;
    --brand-purple: #7c3aed;
    --brand-pink: #db2777;
    --brand-gradient: linear-gradient(135deg, #0891b2 0%, #7c3aed 55%, #db2777 100%);
    --brand-gradient-soft: linear-gradient(135deg, rgba(8,145,178,0.10), rgba(124,58,237,0.10));
    --success: #059669;
    --warning: #d97706;
    --danger: #dc2626;
    --info: #2563eb;
    --shadow-sm: 0 1px 2px rgba(15,23,42,0.06);
    --shadow: 0 4px 16px rgba(15,23,42,0.08), 0 0 0 1px var(--border);
    --shadow-lg: 0 12px 48px rgba(15,23,42,0.14), 0 0 0 1px var(--border-strong);
    --shadow-glow: 0 0 32px rgba(8,145,178,0.12);
  }
  html[data-theme="light"] body::before {
    background:
      radial-gradient(ellipse at 10% 0%, rgba(124,58,237,0.06) 0%, transparent 45%),
      radial-gradient(ellipse at 90% 100%, rgba(8,145,178,0.05) 0%, transparent 50%);
  }
  html[data-theme="light"] ::-webkit-scrollbar-thumb { background: rgba(15,23,42,0.15); }
  html[data-theme="light"] ::-webkit-scrollbar-thumb:hover { background: rgba(124,58,237,0.35); }

  /* ──────────────────────────────────────────────────────────────────── */
  /*  Reset + base                                                       */
  /* ──────────────────────────────────────────────────────────────────── */
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    height: 100%;
    font-family: var(--font-sans);
    font-size: 14px;
    background: var(--bg);
    color: var(--text);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    line-height: 1.5;
    overflow: hidden;
  }
  body { display: flex; flex-direction: column; }
  a { color: var(--brand-cyan); text-decoration: none; }
  a:hover { text-decoration: underline; }
  button { font-family: inherit; cursor: pointer; border: none; background: none; color: inherit; }
  input, select, textarea { font-family: inherit; font-size: inherit; color: inherit; }

  /* Ambient backdrop */
  body::before {
    content: "";
    position: fixed;
    inset: 0;
    pointer-events: none;
    background:
      radial-gradient(ellipse at 10% 0%, rgba(168,85,247,0.10) 0%, transparent 45%),
      radial-gradient(ellipse at 90% 100%, rgba(24,255,255,0.08) 0%, transparent 50%),
      radial-gradient(ellipse at 50% 50%, rgba(236,72,153,0.04) 0%, transparent 60%);
    z-index: 0;
  }

  /* ──────────────────────────────────────────────────────────────────── */
  /*  Scrollbars                                                         */
  /* ──────────────────────────────────────────────────────────────────── */
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background: rgba(168,85,247,0.4); }

  /* ──────────────────────────────────────────────────────────────────── */
  /*  Header                                                             */
  /* ──────────────────────────────────────────────────────────────────── */
  header {
    height: var(--header-h);
    background: var(--bg-glass-strong);
    backdrop-filter: blur(24px) saturate(180%);
    -webkit-backdrop-filter: blur(24px) saturate(180%);
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 0 20px;
    position: relative;
    z-index: 100;
    flex-shrink: 0;
  }
  .brain-hero {
    position: relative;
    width: 44px; height: 44px;
    flex-shrink: 0;
  }
  .brain-hero .aura {
    position: absolute; inset: -8px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(168,85,247,0.55) 0%, rgba(24,255,255,0.15) 40%, transparent 75%);
    animation: auraPulse 3.2s ease-in-out infinite;
    filter: blur(6px);
  }
  @keyframes auraPulse { 50% { transform: scale(1.22); opacity: 1; } }
  .brain-hero svg { position: relative; width: 100%; height: 100%; filter: drop-shadow(0 0 8px rgba(24,255,255,0.4)); }
  .brain-hero .hemi { fill: none; stroke: var(--brand-cyan); stroke-width: 1.4; stroke-linecap: round; opacity: 0.9; }
  .brain-hero .hemi-r { stroke: var(--brand-purple); }
  .brain-hero .synapse { animation: synapse 1.4s ease-in-out infinite; transform-origin: center; transform-box: fill-box; }
  @keyframes synapse { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }
  .brain-hero .charge { stroke-dasharray: 2 6; animation: rot 2s linear infinite; }
  @keyframes rot { to { stroke-dashoffset: -20; } }

  .brand {
    display: flex; flex-direction: column; line-height: 1.15;
  }
  .brand .name {
    font-size: 15px; font-weight: 800; letter-spacing: -0.2px;
    background: var(--brand-gradient);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }
  .brand .state {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--brand-cyan);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    display: flex; align-items: center; gap: 5px;
  }
  .brand .state::before {
    content: ""; width: 5px; height: 5px; border-radius: 50%;
    background: var(--success); box-shadow: 0 0 6px var(--success);
    animation: pulse 1.5s infinite;
  }
  @keyframes pulse { 50% { opacity: 0.5; } }

  .header-stats {
    display: flex; gap: 8px; margin-left: 16px;
    flex-wrap: nowrap; overflow-x: auto;
    scrollbar-width: none;
  }
  .header-stats::-webkit-scrollbar { display: none; }
  .stat-pill {
    display: flex; align-items: center; gap: 6px;
    background: var(--bg-glass);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 5px 12px;
    font-size: 11px;
    color: var(--text-2);
    white-space: nowrap;
    transition: all var(--duration) var(--easing);
  }
  .stat-pill:hover { border-color: var(--border-strong); color: var(--text); }
  .stat-pill .n { font-weight: 700; color: var(--text); font-variant-numeric: tabular-nums; }

  .header-right {
    margin-left: auto;
    display: flex; gap: 8px; align-items: center;
  }
  .icon-btn {
    width: 34px; height: 34px;
    display: flex; align-items: center; justify-content: center;
    background: var(--bg-glass);
    border: 1px solid var(--border);
    border-radius: 10px;
    color: var(--text-2);
    transition: all var(--duration) var(--easing);
  }
  .icon-btn:hover { background: var(--bg-elev-3); color: var(--text); border-color: var(--border-strong); }
  .icon-btn svg { width: 16px; height: 16px; }
  .kbd-hint {
    background: var(--bg-glass);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 5px 10px;
    font-family: var(--font-mono); font-size: 10px;
    color: var(--text-3);
    display: flex; align-items: center; gap: 6px;
    transition: all var(--duration);
  }
  .kbd-hint:hover { color: var(--text); border-color: var(--brand-cyan); }
  kbd {
    background: var(--bg-elev-3);
    border-radius: 4px;
    padding: 1px 5px;
    font-size: 9px;
    font-family: var(--font-mono);
  }

  /* ──────────────────────────────────────────────────────────────────── */
  /*  Layout: sidebar + main                                             */
  /* ──────────────────────────────────────────────────────────────────── */
  .layout {
    display: grid;
    grid-template-columns: var(--sidebar-w) 1fr;
    flex: 1;
    overflow: hidden;
    position: relative;
    z-index: 1;
  }

  aside.sidebar {
    background: var(--bg-glass);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border-right: 1px solid var(--border);
    overflow-y: auto;
    padding: 16px 10px;
  }
  .nav-group { margin-bottom: 14px; }
  .nav-group-label {
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-3); padding: 6px 12px; font-weight: 700;
  }
  .nav-item {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 12px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 12.5px;
    color: var(--text-2);
    transition: all var(--duration-fast) var(--easing);
    position: relative;
    width: 100%; text-align: left;
    font-weight: 500;
  }
  .nav-item:hover { background: var(--bg-elev-2); color: var(--text); }
  .nav-item.active {
    background: var(--brand-gradient-soft);
    color: var(--text);
  }
  .nav-item.active::before {
    content: "";
    position: absolute; left: 0; top: 4px; bottom: 4px;
    width: 3px; border-radius: 2px;
    background: var(--brand-gradient);
  }
  .nav-item svg { width: 14px; height: 14px; flex-shrink: 0; color: var(--text-3); transition: color var(--duration-fast); }
  .nav-item:hover svg, .nav-item.active svg { color: var(--brand-cyan); }
  .nav-item .badge-count {
    margin-left: auto;
    background: var(--bg-elev-3);
    border-radius: 9px;
    padding: 0px 7px;
    font-size: 10px;
    color: var(--text-3);
    font-variant-numeric: tabular-nums;
  }
  .nav-item.active .badge-count { background: var(--brand-cyan); color: #000; }

  main {
    overflow-y: auto;
    padding: 20px 26px 48px;
    position: relative;
  }

  /* ──────────────────────────────────────────────────────────────────── */
  /*  Sections                                                           */
  /* ──────────────────────────────────────────────────────────────────── */
  .section { display: none; }
  .section.active { display: block; animation: sectionIn var(--duration-slow) var(--easing); }
  @keyframes sectionIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }

  .section-header {
    display: flex; align-items: flex-end; justify-content: space-between;
    margin-bottom: 18px; flex-wrap: wrap; gap: 12px;
  }
  .section-title {
    font-size: 22px; font-weight: 800; letter-spacing: -0.5px;
    display: flex; align-items: center; gap: 10px;
  }
  .section-title svg { color: var(--brand-cyan); width: 22px; height: 22px; }
  .section-subtitle {
    color: var(--text-3); font-size: 12.5px; margin-top: 4px;
  }
  .section-actions { display: flex; gap: 8px; flex-wrap: wrap; }

  /* ──────────────────────────────────────────────────────────────────── */
  /*  Cards                                                              */
  /* ──────────────────────────────────────────────────────────────────── */
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 14px;
  }
  .grid.cols-2 { grid-template-columns: repeat(2, 1fr); }
  .grid.cols-3 { grid-template-columns: repeat(3, 1fr); }
  .grid.cols-4 { grid-template-columns: repeat(4, 1fr); }

  .card {
    background: var(--bg-glass);
    backdrop-filter: blur(20px) saturate(150%);
    -webkit-backdrop-filter: blur(20px) saturate(150%);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 18px;
    transition: all var(--duration) var(--easing);
    position: relative;
    overflow: hidden;
  }
  .card:hover { border-color: var(--border-strong); transform: translateY(-1px); box-shadow: var(--shadow); }
  .card.span-2 { grid-column: span 2; }
  .card.span-full { grid-column: 1 / -1; }
  .card.accent::before {
    content: "";
    position: absolute; inset: 0; pointer-events: none;
    background: linear-gradient(135deg, rgba(24,255,255,0.08), transparent 50%);
  }
  .card-header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 14px; gap: 8px;
  }
  .card-title {
    font-size: 13px; font-weight: 700; letter-spacing: 0.01em;
    display: flex; align-items: center; gap: 8px;
  }
  .card-title svg { width: 14px; height: 14px; color: var(--brand-cyan); }

  .stat-card { padding: 18px; }
  .stat-card .label { font-size: 11px; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 700; }
  .stat-card .value { font-size: 32px; font-weight: 900; letter-spacing: -1px; margin: 6px 0 4px; font-variant-numeric: tabular-nums; }
  .stat-card .value.accent { background: var(--brand-gradient); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
  .stat-card .trend { font-size: 11px; color: var(--text-2); display: flex; align-items: center; gap: 4px; }
  .stat-card .trend.up { color: var(--success); }
  .stat-card .trend.down { color: var(--danger); }

  /* ──────────────────────────────────────────────────────────────────── */
  /*  Rows, pills, badges                                                */
  /* ──────────────────────────────────────────────────────────────────── */
  .row {
    display: flex; justify-content: space-between; align-items: center;
    padding: 8px 0; border-bottom: 1px solid var(--border);
    gap: 8px;
  }
  .row:last-child { border: none; }
  .row .k { font-size: 12px; color: var(--text-2); }
  .row .v { font-size: 12.5px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .row .v.good { color: var(--success); }
  .row .v.warn { color: var(--warning); }
  .row .v.bad { color: var(--danger); }

  .pill {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 2px 8px; border-radius: 9px;
    background: var(--bg-elev-3); border: 1px solid var(--border);
    font-size: 10px; font-weight: 600; letter-spacing: 0.02em;
    color: var(--text-2);
  }
  .pill.green { background: rgba(16,230,140,.12); color: var(--success); border-color: rgba(16,230,140,.3); }
  .pill.red { background: rgba(255,88,100,.12); color: var(--danger); border-color: rgba(255,88,100,.3); }
  .pill.yellow { background: rgba(255,181,63,.12); color: var(--warning); border-color: rgba(255,181,63,.3); }
  .pill.purple { background: rgba(168,85,247,.15); color: var(--brand-purple); border-color: rgba(168,85,247,.3); }
  .pill.cyan { background: rgba(24,255,255,.12); color: var(--brand-cyan); border-color: rgba(24,255,255,.3); }
  .pill.pink { background: rgba(236,72,153,.12); color: var(--brand-pink); border-color: rgba(236,72,153,.3); }

  /* ──────────────────────────────────────────────────────────────────── */
  /*  Buttons                                                            */
  /* ──────────────────────────────────────────────────────────────────── */
  .btn {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 8px 14px;
    background: var(--bg-elev-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text);
    font-size: 12.5px;
    font-weight: 600;
    transition: all var(--duration) var(--easing);
    white-space: nowrap;
  }
  .btn:hover { background: var(--bg-elev-3); border-color: var(--border-strong); transform: translateY(-1px); }
  .btn:active { transform: translateY(0); }
  .btn svg { width: 13px; height: 13px; }
  .btn.sm { padding: 4px 10px; font-size: 11px; }
  .btn.lg { padding: 11px 18px; font-size: 13px; }
  .btn.primary {
    background: var(--brand-gradient);
    color: #fff;
    border-color: transparent;
  }
  .btn.primary:hover { filter: brightness(1.08); box-shadow: 0 6px 20px rgba(24,255,255,0.25); }
  .btn.ghost { background: transparent; }
  .btn.ghost:hover { background: var(--bg-elev-2); }
  .btn.danger { color: var(--danger); border-color: rgba(255,88,100,.35); }
  .btn.danger:hover { background: rgba(255,88,100,.1); }
  .btn.success { color: var(--success); border-color: rgba(16,230,140,.35); }
  .btn.success:hover { background: rgba(16,230,140,.1); }

  /* ──────────────────────────────────────────────────────────────────── */
  /*  Forms                                                              */
  /* ──────────────────────────────────────────────────────────────────── */
  .field { margin-bottom: 12px; }
  .field label {
    display: block; margin-bottom: 5px;
    font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--text-3);
  }
  .field input, .field textarea, .field select {
    width: 100%;
    background: var(--bg-elev-1);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 9px 12px;
    font-size: 12.5px;
    color: var(--text);
    transition: all var(--duration) var(--easing);
  }
  .field input:focus, .field textarea:focus, .field select:focus {
    outline: none;
    border-color: var(--brand-cyan);
    box-shadow: 0 0 0 3px rgba(24,255,255,0.12);
  }
  .field textarea { resize: vertical; min-height: 70px; font-family: var(--font-mono); font-size: 12px; }
  .field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

  /* Toggle switch */
  .switch { position: relative; display: inline-block; width: 38px; height: 22px; }
  .switch input { opacity: 0; width: 0; height: 0; }
  .switch .slider {
    position: absolute; inset: 0; cursor: pointer;
    background: var(--bg-elev-3);
    border: 1px solid var(--border);
    transition: var(--duration); border-radius: 12px;
  }
  .switch .slider::before {
    content: ""; position: absolute;
    height: 16px; width: 16px; left: 2px; top: 2px;
    background: var(--text-2); transition: var(--duration); border-radius: 50%;
  }
  .switch input:checked + .slider { background: var(--brand-gradient); border-color: transparent; }
  .switch input:checked + .slider::before { transform: translateX(16px); background: #fff; }

  /* ──────────────────────────────────────────────────────────────────── */
  /*  Tables                                                             */
  /* ──────────────────────────────────────────────────────────────────── */
  .table { width: 100%; border-collapse: collapse; }
  .table th, .table td { padding: 9px 12px; text-align: left; font-size: 12px; }
  .table th {
    background: var(--bg-elev-2);
    color: var(--text-3);
    font-weight: 700; letter-spacing: 0.06em;
    text-transform: uppercase; font-size: 10px;
    border-bottom: 1px solid var(--border);
  }
  .table tr { border-bottom: 1px solid var(--border); transition: background var(--duration-fast); }
  .table tr:hover { background: var(--bg-elev-2); }
  .table code { color: var(--brand-cyan); font-size: 11px; }

  .empty {
    padding: 32px 16px; text-align: center;
    color: var(--text-3); font-size: 12px;
  }
  .empty svg { width: 40px; height: 40px; color: var(--text-dim); margin: 0 auto 10px; display: block; }

  /* Progress meters */
  .meter { height: 6px; background: var(--bg-elev-3); border-radius: 4px; overflow: hidden; position: relative; }
  .meter .fill {
    height: 100%; border-radius: 4px;
    background: var(--brand-gradient);
    transition: width var(--duration-slow) var(--easing);
  }
  .meter .fill.good { background: var(--success); }
  .meter .fill.warn { background: var(--warning); }

  /* ──────────────────────────────────────────────────────────────────── */
  /*  Feature toggles grid                                               */
  /* ──────────────────────────────────────────────────────────────────── */
  .feature-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
  .feature-toggle {
    background: var(--bg-elev-1);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 12px 14px;
    display: flex; align-items: center; gap: 12px;
    transition: all var(--duration) var(--easing);
  }
  .feature-toggle:hover { border-color: var(--border-strong); }
  .feature-toggle .icon {
    width: 32px; height: 32px;
    background: var(--brand-gradient-soft);
    border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    color: var(--brand-cyan); flex-shrink: 0;
  }
  .feature-toggle .icon svg { width: 16px; height: 16px; }
  .feature-toggle .meta { flex: 1; min-width: 0; }
  .feature-toggle .meta .name { font-size: 12.5px; font-weight: 600; }
  .feature-toggle .meta .desc { font-size: 10.5px; color: var(--text-3); margin-top: 2px; }

  /* ──────────────────────────────────────────────────────────────────── */
  /*  Command palette                                                    */
  /* ──────────────────────────────────────────────────────────────────── */
  .cmd-overlay {
    position: fixed; inset: 0;
    background: rgba(3, 5, 9, 0.72);
    backdrop-filter: blur(8px);
    z-index: 2000;
    display: none; align-items: flex-start; justify-content: center;
    padding-top: 12vh;
    animation: fadeIn var(--duration) var(--easing);
  }
  .cmd-overlay.open { display: flex; }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

  .cmd-palette {
    width: min(640px, 92vw);
    background: var(--bg-glass-strong);
    backdrop-filter: blur(36px);
    border: 1px solid var(--border-strong);
    border-radius: 14px;
    overflow: hidden;
    box-shadow: var(--shadow-lg);
    animation: paletteIn var(--duration-slow) var(--easing-spring);
  }
  @keyframes paletteIn { from { opacity: 0; transform: translateY(-20px) scale(0.96); } to { opacity: 1; transform: none; } }

  .cmd-palette input {
    width: 100%;
    background: transparent; border: none; outline: none;
    padding: 16px 20px;
    font-size: 14px; color: var(--text);
    border-bottom: 1px solid var(--border);
  }
  .cmd-palette .results { max-height: 420px; overflow-y: auto; padding: 6px; }
  .cmd-result {
    display: flex; align-items: center; gap: 10px;
    padding: 9px 12px; border-radius: 7px;
    cursor: pointer; color: var(--text-2);
    transition: all var(--duration-fast);
  }
  .cmd-result:hover, .cmd-result.selected { background: var(--bg-elev-2); color: var(--text); }
  .cmd-result svg { width: 15px; height: 15px; color: var(--brand-cyan); flex-shrink: 0; }
  .cmd-result .meta { flex: 1; font-size: 12.5px; }
  .cmd-result .hint { font-size: 10px; color: var(--text-3); font-family: var(--font-mono); }

  /* ──────────────────────────────────────────────────────────────────── */
  /*  Toasts                                                             */
  /* ──────────────────────────────────────────────────────────────────── */
  .toast-container {
    position: fixed; bottom: 52px; right: 20px;
    display: flex; flex-direction: column; gap: 8px;
    z-index: 1500; pointer-events: none;
  }
  .toast {
    min-width: 260px; max-width: 360px;
    background: var(--bg-glass-strong);
    backdrop-filter: blur(24px);
    border: 1px solid var(--border-strong);
    border-left: 3px solid var(--brand-cyan);
    border-radius: 10px;
    padding: 10px 14px;
    pointer-events: auto;
    display: flex; align-items: flex-start; gap: 10px;
    animation: toastIn var(--duration-slow) var(--easing-spring);
    box-shadow: var(--shadow-lg);
  }
  .toast.success { border-left-color: var(--success); }
  .toast.warn { border-left-color: var(--warning); }
  .toast.error { border-left-color: var(--danger); }
  .toast.removing { animation: toastOut var(--duration-slow) var(--easing) forwards; }
  @keyframes toastIn { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: none; } }
  @keyframes toastOut { to { opacity: 0; transform: translateX(20px); } }
  .toast svg { width: 15px; height: 15px; color: var(--brand-cyan); flex-shrink: 0; margin-top: 1px; }
  .toast.success svg { color: var(--success); }
  .toast.warn svg { color: var(--warning); }
  .toast.error svg { color: var(--danger); }
  .toast .title { font-size: 12.5px; font-weight: 600; margin-bottom: 2px; }
  .toast .body { font-size: 11.5px; color: var(--text-2); line-height: 1.4; }

  /* ──────────────────────────────────────────────────────────────────── */
  /*  Ticker + log panel                                                 */
  /* ──────────────────────────────────────────────────────────────────── */
  .log-ticker {
    position: fixed; bottom: 0; left: 0; right: 0;
    height: var(--ticker-h);
    background: var(--bg-glass-strong);
    backdrop-filter: blur(24px);
    border-top: 1px solid var(--border);
    display: flex; align-items: center; gap: 12px;
    padding: 0 20px;
    font-family: var(--font-mono); font-size: 10.5px;
    color: var(--text-3);
    z-index: 600;
  }
  .log-ticker .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--success); animation: pulse 1.5s infinite; flex-shrink: 0; }
  .log-ticker .scroll { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .log-panel {
    position: fixed; bottom: var(--ticker-h); left: 0; right: 0;
    height: 300px;
    background: var(--bg-elev-1);
    border-top: 1px solid var(--border);
    padding: 16px 20px;
    overflow-y: auto;
    font-family: var(--font-mono); font-size: 11.5px;
    color: var(--text-2);
    z-index: 599;
    transform: translateY(100%);
    transition: transform var(--duration-slow) var(--easing);
    box-shadow: 0 -8px 32px rgba(0,0,0,0.3);
  }
  .log-panel.open { transform: translateY(0); }
  .log-panel .head {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 10px;
  }
  .log-panel .head .title { color: var(--brand-cyan); font-weight: 700; letter-spacing: 0.04em; }
  .log-row {
    padding: 4px 0;
    border-bottom: 1px solid var(--border);
    display: grid; grid-template-columns: 90px 130px 1fr; gap: 10px; align-items: baseline;
  }
  .log-row .t { color: var(--text-dim); font-size: 10px; }
  .log-row .src { color: var(--brand-purple); font-weight: 600; font-size: 10.5px; }
  .log-row .type { color: var(--brand-cyan); font-weight: 600; font-size: 10.5px; }

  /* ──────────────────────────────────────────────────────────────────── */
  /*  Responsive                                                         */
  /* ──────────────────────────────────────────────────────────────────── */
  .menu-toggle { display: none; }

  @media (max-width: 1024px) {
    .grid.cols-3, .grid.cols-4 { grid-template-columns: repeat(2, 1fr); }
    .card.span-2 { grid-column: 1 / -1; }
  }

  @media (max-width: 768px) {
    header { padding: 0 14px; gap: 10px; }
    .header-stats { display: none; }
    .brand .state { display: none; }
    .menu-toggle { display: flex; }
    aside.sidebar {
      position: fixed;
      top: var(--header-h); bottom: 0;
      width: 280px; z-index: 90;
      transform: translateX(-100%);
      transition: transform var(--duration-slow) var(--easing);
    }
    aside.sidebar.open { transform: translateX(0); box-shadow: var(--shadow-lg); }
    .layout { grid-template-columns: 1fr; }
    main { padding: 14px; padding-bottom: 60px; }
    .grid, .grid.cols-2, .grid.cols-3, .grid.cols-4 { grid-template-columns: 1fr; }
    .card.span-2 { grid-column: auto; }
    .section-title { font-size: 18px; }
    .field-row { grid-template-columns: 1fr; }
  }

  /* Chart canvas wrapper */
  .chart-wrap { position: relative; height: 220px; }
  .chart-wrap.lg { height: 320px; }

  /* Live Graph canvas */
  .graph-wrap {
    position: relative;
    background: radial-gradient(ellipse at center, rgba(168,85,247,0.04) 0%, transparent 70%);
    border-radius: 12px; overflow: hidden;
    border: 1px solid var(--border);
  }
  .graph-wrap canvas { display: block; width: 100%; height: 560px; }

  /* Helpers */
  .mono { font-family: var(--font-mono); font-size: 11.5px; }
  .tag-code { font-family: var(--font-mono); background: var(--bg-elev-2); padding: 1px 6px; border-radius: 4px; font-size: 11px; }
  .flex { display: flex; }
  .flex.center { align-items: center; }
  .flex.gap { gap: 8px; }
  .flex.between { justify-content: space-between; }
  .grow { flex: 1; }
  .hidden { display: none; }
  .mt { margin-top: 10px; } .mt-lg { margin-top: 20px; }
  .mb { margin-bottom: 10px; } .mb-lg { margin-bottom: 20px; }

  /* Accent bar */
  .accent-bar {
    height: 3px; border-radius: 2px;
    background: var(--brand-gradient);
    margin-bottom: 18px;
    box-shadow: 0 0 12px rgba(24,255,255,0.35);
  }

  /* Skeleton loader */
  .skel { background: linear-gradient(90deg, var(--bg-elev-2) 0%, var(--bg-elev-3) 50%, var(--bg-elev-2) 100%); background-size: 200% 100%; animation: skel 1.2s linear infinite; border-radius: 6px; }
  @keyframes skel { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
</style>
</head>
<body>

<!-- ══════════════════════════════════════════════════════════════════════
     Header
     ══════════════════════════════════════════════════════════════════════ -->
<header>
  <button class="icon-btn menu-toggle" onclick="toggleSidebar()" aria-label="Menu">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
  </button>

  <div class="brain-hero" title="Hive Mind — learning · reflecting · charging">
    <div class="aura"></div>
    <svg viewBox="0 0 100 100">
      <circle class="hemi charge" cx="50" cy="50" r="46"/>
      <circle class="hemi charge" cx="50" cy="50" r="40" style="animation-duration:3s;animation-direction:reverse"/>
      <path class="hemi" d="M 48 22 C 30 22, 18 32, 18 48 C 18 60, 26 72, 38 78 C 42 82, 46 80, 48 76 L 48 22"/>
      <path class="hemi hemi-r" d="M 52 22 C 70 22, 82 32, 82 48 C 82 60, 74 72, 62 78 C 58 82, 54 80, 52 76 L 52 22"/>
      <path class="hemi" d="M 30 40 Q 38 38, 44 44"/>
      <path class="hemi" d="M 28 55 Q 36 55, 44 58"/>
      <path class="hemi" d="M 32 68 Q 40 66, 46 72"/>
      <path class="hemi hemi-r" d="M 70 40 Q 62 38, 56 44"/>
      <path class="hemi hemi-r" d="M 72 55 Q 64 55, 56 58"/>
      <path class="hemi hemi-r" d="M 68 68 Q 60 66, 54 72"/>
      <circle class="synapse" cx="30" cy="42" r="1.8" fill="#18ffff"/>
      <circle class="synapse" cx="70" cy="42" r="1.8" fill="#a855f7" style="animation-delay:0.3s"/>
      <circle class="synapse" cx="35" cy="62" r="1.6" fill="#10e68c" style="animation-delay:0.6s"/>
      <circle class="synapse" cx="65" cy="62" r="1.6" fill="#ffb53f" style="animation-delay:0.9s"/>
      <circle class="synapse" cx="50" cy="35" r="1.4" fill="#ec4899" style="animation-delay:0.15s"/>
      <circle class="synapse" cx="50" cy="70" r="1.4" fill="#18ffff" style="animation-delay:0.75s"/>
    </svg>
  </div>

  <div class="brand">
    <div class="name">Shadow Brain <span style="color:var(--text-3);font-size:10px;font-weight:600">v6.0 Hive Mind</span></div>
    <div class="state" id="brain-state">learning · reflecting · charging</div>
  </div>

  <div class="header-stats" id="header-stats">
    <div class="stat-pill"><span class="n" id="stat-agents">—</span> agents</div>
    <div class="stat-pill"><span class="n" id="stat-memories">—</span> memories</div>
    <div class="stat-pill"><span class="n" id="stat-dreams">—</span> dreams</div>
    <div class="stat-pill"><span class="n" id="stat-savings">$—</span> saved</div>
  </div>

  <div class="header-right">
    <button class="kbd-hint" onclick="openCmdPalette()" title="Open command palette">
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      Search <kbd>⌘K</kbd>
    </button>
    <button class="icon-btn" onclick="toggleTheme()" title="Toggle theme">
      <svg id="theme-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
    </button>
    <button class="icon-btn" onclick="toggleLogPanel()" title="Activity log"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="21" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="21" y1="18" x2="3" y2="18"/></svg></button>
    <button class="btn danger sm" onclick="stopBrain()" title="Stop Shadow Brain (npm process)"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>Stop</button>
    <button class="btn primary sm" onclick="refresh()" title="Refresh all"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>Refresh</button>
  </div>
</header>

<!-- ══════════════════════════════════════════════════════════════════════
     Layout: sidebar + main
     ══════════════════════════════════════════════════════════════════════ -->
<div class="layout">
  <aside class="sidebar" id="sidebar">
    <div class="nav-group">
      <div class="nav-group-label">Overview</div>
      <button class="nav-item active" data-tab="overview" data-title="Overview" data-icon="activity">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        Dashboard
      </button>
      <button class="nav-item" data-tab="graph" data-title="Live Graph">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/></svg>
        Live Graph
      </button>
      <button class="nav-item" data-tab="agents" data-title="Agents">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        Agents<span class="badge-count" id="badge-agents">0</span>
      </button>
      <button class="nav-item" data-tab="chat" data-title="Chat with Brain"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>Chat with Brain</button>
      <button class="nav-item" data-tab="memory" data-title="Memory Browser">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
        Memory Browser
      </button>
      <button class="nav-item" data-tab="activity" data-title="Activity Log">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
        Activity Log
      </button>
    </div>

    <div class="nav-group">
      <div class="nav-group-label">Cognition</div>
      <button class="nav-item" data-tab="sabb" data-title="Sub-Agent Bridge"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>SABB<span class="badge-count" id="badge-sabb">0</span></button>
      <button class="nav-item" data-tab="causal" data-title="Causal Chains"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>Causal<span class="badge-count" id="badge-causal">0</span></button>
      <button class="nav-item" data-tab="dream" data-title="Dream Engine"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>Dream<span class="badge-count" id="badge-dream">0</span></button>
      <button class="nav-item" data-tab="debate" data-title="Swarm Debate"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>Swarm Debate</button>
      <button class="nav-item" data-tab="premortem" data-title="Pre-Mortem"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>Pre-Mortem</button>
      <button class="nav-item" data-tab="branch" data-title="Branch Brains"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>Branch Brains</button>
      <button class="nav-item" data-tab="forget" data-title="Forgetting Curve"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>Forgetting</button>
    </div>

    <div class="nav-group">
      <div class="nav-group-label">Safety & Trust</div>
      <button class="nav-item" data-tab="collision" data-title="Collision Detective"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>Collisions<span class="badge-count" id="badge-collision">0</span></button>
      <button class="nav-item" data-tab="reputation" data-title="Reputation Ledger"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>Reputation</button>
      <button class="nav-item" data-tab="calibration" data-title="Calibration"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>Calibration</button>
      <button class="nav-item" data-tab="formal" data-title="Formal Rules"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>Formal Rules</button>
      <button class="nav-item" data-tab="privacy" data-title="Privacy & Safety"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>Privacy & Safety</button>
      <button class="nav-item" data-tab="attention" data-title="Attention Heatmap"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><line x1="21.17" y1="8" x2="12" y2="8"/></svg>Attention</button>
    </div>

    <div class="nav-group">
      <div class="nav-group-label">Economy & Growth</div>
      <button class="nav-item" data-tab="tokens" data-title="Token Economy"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>Tokens</button>
      <button class="nav-item" data-tab="voice" data-title="Voice Mode"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>Voice</button>
      <button class="nav-item" data-tab="garden" data-title="Brain Garden"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s-8-4-8-12c0-4 3-7 8-7s8 3 8 7c0 8-8 12-8 12z"/><path d="M12 17v-5M12 7V5"/></svg>Garden</button>
      <button class="nav-item" data-tab="pr" data-title="PR Auto-Review"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" y1="9" x2="6" y2="21"/></svg>PR Review</button>
      <button class="nav-item" data-tab="team" data-title="Team Sync"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>Team Sync</button>
      <button class="nav-item" data-tab="exchange" data-title="Brain Exchange"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>Exchange</button>
    </div>

    <div class="nav-group">
      <div class="nav-group-label">System</div>
      <button class="nav-item" data-tab="features" data-title="Feature Toggles"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="5" width="22" height="14" rx="7"/><circle cx="16" cy="12" r="3"/></svg>Feature Toggles</button>
      <button class="nav-item" data-tab="models" data-title="Models & Intelligence"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>Models & Intel</button>
      <button class="nav-item" data-tab="config" data-title="Configuration"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>Configuration</button>
    </div>
  </aside>

  <main id="main">

    <!-- ════ OVERVIEW ════════════════════════════════════════════════ -->
    <section class="section active" id="tab-overview">
      <div class="accent-bar"></div>
      <div class="section-header">
        <div>
          <h1 class="section-title"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>Hive Mind Overview</h1>
          <div class="section-subtitle">Real-time cross-agent intelligence · 22 modules · local-first</div>
        </div>
        <div class="section-actions">
          <button class="btn" onclick="runDream()"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>Dream Now</button>
          <button class="btn" onclick="runForget()"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>Consolidate</button>
          <button class="btn danger" onclick="toggleAirGap()"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>Air-Gap</button>
        </div>
      </div>

      <div class="grid cols-4">
        <div class="card stat-card accent">
          <div class="label">Agents Connected</div>
          <div class="value accent" id="ov-agents">—</div>
          <div class="trend">of 10 supported</div>
        </div>
        <div class="card stat-card accent">
          <div class="label">Memories Stored</div>
          <div class="value" id="ov-memories">—</div>
          <div class="trend" id="ov-memories-sub">across all projects</div>
        </div>
        <div class="card stat-card accent">
          <div class="label">Sub-Agents (SABB)</div>
          <div class="value" id="ov-subagents">—</div>
          <div class="trend" id="ov-subagents-sub">graduated / quarantined</div>
        </div>
        <div class="card stat-card accent">
          <div class="label">Monthly Savings</div>
          <div class="value" style="color:var(--success)" id="ov-savings">$—</div>
          <div class="trend up" id="ov-savings-sub">projection</div>
        </div>
      </div>

      <div class="grid cols-3 mt-lg">
        <div class="card span-2">
          <div class="card-header"><div class="card-title"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>Token Spend (last 7 days)</div></div>
          <div class="chart-wrap"><canvas id="chart-tokens"></canvas></div>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>Recent Activity</div></div>
          <div id="ov-timeline" style="max-height:220px;overflow-y:auto;font-size:11.5px"></div>
        </div>
      </div>

      <div class="grid cols-2 mt-lg">
        <div class="card">
          <div class="card-header"><div class="card-title">Module Status</div></div>
          <div id="ov-modules"></div>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">System Health</div></div>
          <div id="ov-health"></div>
        </div>
      </div>
    </section>

    <!-- ════ LIVE GRAPH ══════════════════════════════════════════════ -->
    <section class="section" id="tab-graph">
      <div class="accent-bar"></div>
      <div class="section-header">
        <div>
          <h1 class="section-title">Live Agent Network</h1>
          <div class="section-subtitle">Real-time signal flow: brain ↔ agents ↔ sub-agents</div>
        </div>
      </div>
      <div class="card" style="padding:0">
        <div class="graph-wrap"><canvas id="graph-canvas" width="1600" height="600"></canvas></div>
        <div style="padding:10px 14px;display:flex;gap:16px;flex-wrap:wrap;font-size:11px;color:var(--text-2)">
          <span><span style="color:var(--success)">●</span> memory-write</span>
          <span><span style="color:var(--brand-cyan)">●</span> subagent-spawn</span>
          <span><span style="color:var(--brand-purple)">●</span> dream</span>
          <span><span style="color:var(--danger)">●</span> collision</span>
          <span><span style="color:var(--warning)">●</span> firewall-block</span>
          <span id="graph-meta" style="margin-left:auto;color:var(--text-3)"></span>
        </div>
      </div>
    </section>

    <!-- ════ AGENTS ══════════════════════════════════════════════════ -->
    <section class="section" id="tab-agents">
      <div class="accent-bar"></div>
      <div class="section-header">
        <div>
          <h1 class="section-title">Agent Connections</h1>
          <div class="section-subtitle">Connect or disconnect Shadow Brain hooks per agent · per-agent native mechanisms</div>
        </div>
        <div class="section-actions">
          <button class="btn success" onclick="attachAll()">Attach All</button>
          <button class="btn danger" onclick="detachAll()">Detach All</button>
        </div>
      </div>
      <div class="card" style="padding:0">
        <table class="table">
          <thead><tr><th>Agent</th><th>Detected</th><th>Hook Status</th><th>Install Path</th><th style="text-align:right">Action</th></tr></thead>
          <tbody id="agents-table"></tbody>
        </table>
      </div>
    </section>

    <!-- ════ CHAT WITH BRAIN ═════════════════════════════════════════ -->
    <section class="section" id="tab-chat">
      <div class="accent-bar"></div>
      <div class="section-header">
        <div>
          <h1 class="section-title"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>Chat with Your Brain</h1>
          <div class="section-subtitle">Ask anything — Shadow Brain retrieves relevant memories via semantic search and cites them. Uses your configured lead model.</div>
        </div>
        <div class="section-actions">
          <button class="btn" onclick="newChat()">New Chat</button>
          <button class="btn danger" onclick="clearAllChats()">Clear All</button>
        </div>
      </div>
      <div class="grid" style="grid-template-columns: 260px 1fr; gap: 14px">
        <div class="card" style="height: calc(100vh - 220px); overflow-y: auto; padding: 12px">
          <div class="card-title" style="margin-bottom: 10px">Conversations</div>
          <div id="chat-conversations"></div>
        </div>
        <div class="card" style="height: calc(100vh - 220px); display: flex; flex-direction: column; padding: 0">
          <div id="chat-messages" style="flex: 1; overflow-y: auto; padding: 16px"></div>
          <div style="border-top: 1px solid var(--border); padding: 12px; display: flex; gap: 8px">
            <input id="chat-input" placeholder="Ask your brain — e.g. 'What did Cursor decide about bcrypt?'" style="flex:1;background:var(--bg-elev-1);border:1px solid var(--border);border-radius:8px;padding:10px 14px;color:var(--text);font-size:13px" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendChat()}"/>
            <button class="btn primary" onclick="sendChat()" id="chat-send-btn">Send</button>
          </div>
          <div class="mono" style="padding: 4px 16px 10px; font-size: 10px; color: var(--text-3)" id="chat-status">idle</div>
        </div>
      </div>
    </section>

    <!-- ════ MEMORY BROWSER ══════════════════════════════════════════ -->
    <section class="section" id="tab-memory">
      <div class="accent-bar"></div>
      <div class="section-header">
        <div>
          <h1 class="section-title">Memory Browser</h1>
          <div class="section-subtitle">Full-text search across every memory in the global brain</div>
        </div>
      </div>
      <div class="card">
        <div class="grid cols-4">
          <div class="field"><label>Search query</label><input id="mem-query" placeholder="e.g. auth, react, bcrypt…"/></div>
          <div class="field"><label>Agent</label><select id="mem-agent"><option value="">all agents</option><option>claude-code</option><option>cursor</option><option>codex</option><option>cline</option><option>copilot</option><option>windsurf</option><option>kilo-code</option><option>roo-code</option><option>aider</option><option>opencode</option></select></div>
          <div class="field"><label>Category</label><input id="mem-category" placeholder="e.g. security"/></div>
          <div class="field"><label>Min importance</label><input id="mem-importance" type="number" min="0" max="1" step="0.1" value="0"/></div>
        </div>
        <button class="btn primary" onclick="searchMemory()">Search</button>
      </div>
      <div class="card mt">
        <table class="table"><thead><tr><th>ID</th><th>Agent</th><th>Category</th><th>Content</th><th>Importance</th><th>Created</th></tr></thead>
          <tbody id="mem-results"></tbody>
        </table>
      </div>
    </section>

    <!-- ════ ACTIVITY LOG ════════════════════════════════════════════ -->
    <section class="section" id="tab-activity">
      <div class="accent-bar"></div>
      <div class="section-header">
        <div>
          <h1 class="section-title">Activity Log</h1>
          <div class="section-subtitle">Unified stream: memory writes, SABB spawns, collisions, dreams, quarantine, firewall blocks</div>
        </div>
        <div class="section-actions">
          <select id="act-filter" style="background:var(--bg-elev-2);border:1px solid var(--border);border-radius:8px;padding:7px 10px;color:var(--text);font-size:12px">
            <option value="">all types</option>
            <option value="memory-write">memory-write</option>
            <option value="subagent-spawn">subagent-spawn</option>
            <option value="collision">collision</option>
            <option value="dream">dream</option>
            <option value="quarantine">quarantine</option>
          </select>
          <button class="btn" onclick="refreshActivity()">Refresh</button>
        </div>
      </div>
      <div class="card" style="padding:0">
        <table class="table"><thead><tr><th>Time</th><th>Source</th><th>Type</th><th>Detail</th></tr></thead><tbody id="activity-table"></tbody></table>
      </div>
    </section>

    <!-- ════ SABB ════════════════════════════════════════════════════ -->
    <section class="section" id="tab-sabb">
      <div class="accent-bar"></div>
      <div class="section-header">
        <div>
          <h1 class="section-title">Sub-Agent Brain Bridge</h1>
          <div class="section-subtitle">Context slivers + quarantine for Claude Task / Cursor Composer / CrewAI / LangGraph / AutoGen</div>
        </div>
      </div>
      <div class="grid cols-2">
        <div class="card">
          <div class="card-header"><div class="card-title">SABB Stats</div></div>
          <div id="sabb-stats"></div>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">Compute Context Sliver</div></div>
          <div class="field"><label>Parent agent</label><select id="sabb-parent"><option>claude-code</option><option>cursor</option><option>cline</option><option>codex</option></select></div>
          <div class="field"><label>Framework</label><select id="sabb-framework"><option>claude-code-task</option><option>cursor-composer</option><option>cline-substep</option><option>crewai</option><option>langgraph</option><option>autogen</option><option>generic</option></select></div>
          <div class="field"><label>Task description</label><input id="sabb-task" placeholder="e.g. refactor auth middleware"/></div>
          <div class="field-row">
            <div class="field"><label>Token budget</label><input id="sabb-budget" value="300"/></div>
            <div class="field"><label>&nbsp;</label><button class="btn primary" onclick="computeSliver()" style="width:100%">Generate</button></div>
          </div>
          <pre class="mono" id="sabb-sliver-output" style="margin-top:10px;max-height:220px;overflow:auto;background:var(--bg-elev-1);padding:10px;border-radius:6px"></pre>
        </div>
      </div>
      <div class="card mt-lg" style="padding:0">
        <div style="padding:14px 18px 6px"><div class="card-title">Quarantined Memories</div></div>
        <table class="table"><thead><tr><th>ID</th><th>Sub-Agent</th><th>Category</th><th>Conf.</th><th>Content</th><th style="text-align:right">Action</th></tr></thead><tbody id="sabb-quarantine"></tbody></table>
      </div>
    </section>

    <!-- ════ CAUSAL CHAINS ═══════════════════════════════════════════ -->
    <section class="section" id="tab-causal">
      <div class="accent-bar"></div>
      <div class="section-header">
        <div><h1 class="section-title">Causal Memory Chains</h1><div class="section-subtitle">Trace the full causal history of any decision</div></div>
      </div>
      <div class="grid cols-3">
        <div class="card">
          <div class="card-header"><div class="card-title">Stats</div></div>
          <div id="causal-stats"></div>
        </div>
        <div class="card span-2">
          <div class="card-header"><div class="card-title">Trace Ancestors / Descendants</div></div>
          <div class="field"><label>Memory ID</label><input id="causal-mem-id" placeholder="abc123…"/></div>
          <div class="field-row">
            <div class="field"><label>Max depth</label><input id="causal-depth" value="8"/></div>
            <div class="field"><label>&nbsp;</label><div style="display:flex;gap:6px"><button class="btn primary" onclick="traceCausal()" style="flex:1">Ancestors</button><button class="btn" onclick="influenceCausal()" style="flex:1">Descendants</button></div></div>
          </div>
          <pre class="mono" id="causal-output" style="margin-top:10px;max-height:280px;overflow:auto;background:var(--bg-elev-1);padding:10px;border-radius:6px"></pre>
        </div>
      </div>
      <div class="card mt-lg">
        <div class="card-header"><div class="card-title">Record a Causal Link</div></div>
        <div class="grid cols-3">
          <div class="field"><label>Effect ID</label><input id="causal-effect"/></div>
          <div class="field"><label>Cause ID</label><input id="causal-cause"/></div>
          <div class="field"><label>Rationale (optional)</label><input id="causal-rationale"/></div>
        </div>
        <button class="btn primary" onclick="linkCausal()">Record Link</button>
      </div>
    </section>

    <!-- ════ COLLISION ═══════════════════════════════════════════════ -->
    <section class="section" id="tab-collision">
      <div class="accent-bar"></div>
      <div class="section-header"><div><h1 class="section-title">Agent Collision Detective</h1><div class="section-subtitle">Real-time conflict detection across agent edit intents</div></div></div>
      <div class="grid cols-2">
        <div class="card"><div class="card-header"><div class="card-title">Stats</div></div><div id="collision-stats"></div></div>
        <div class="card"><div class="card-header"><div class="card-title">Active Alerts</div></div><div id="collision-alerts"></div></div>
      </div>
      <div class="card mt-lg" style="padding:0">
        <div style="padding:14px 18px 6px"><div class="card-title">Active Edit Intents</div></div>
        <table class="table"><thead><tr><th>Agent</th><th>File</th><th>Lines</th><th>Intent</th><th>Expires</th></tr></thead><tbody id="collision-intents"></tbody></table>
      </div>
    </section>

    <!-- ════ DREAM ═══════════════════════════════════════════════════ -->
    <section class="section" id="tab-dream">
      <div class="accent-bar"></div>
      <div class="section-header">
        <div><h1 class="section-title">Dream Engine</h1><div class="section-subtitle">Background idle reflection — local-first via Ollama</div></div>
        <div class="section-actions"><button class="btn primary" onclick="runDream()">Run Cycle</button><button class="btn" onclick="startDreamLoop()">Start Loop</button></div>
      </div>
      <div class="grid cols-3">
        <div class="card"><div class="card-header"><div class="card-title">Stats</div></div><div id="dream-stats"></div></div>
        <div class="card span-2"><div class="card-header"><div class="card-title">Dream Type Distribution</div></div><div class="chart-wrap"><canvas id="chart-dreams"></canvas></div></div>
      </div>
      <div class="card mt-lg" style="padding:0">
        <div style="padding:14px 18px 6px"><div class="card-title">Recent Dreams</div></div>
        <table class="table"><thead><tr><th>Type</th><th>Content</th><th>Conf.</th><th>Action</th><th></th></tr></thead><tbody id="dream-list"></tbody></table>
      </div>
    </section>

    <!-- ════ REPUTATION ══════════════════════════════════════════════ -->
    <section class="section" id="tab-reputation">
      <div class="accent-bar"></div>
      <div class="section-header"><div><h1 class="section-title">Agent Reputation Ledger</h1><div class="section-subtitle">Ed25519-signed decision receipts · portable trust score</div></div></div>
      <div class="grid cols-2">
        <div class="card"><div class="card-header"><div class="card-title">Ledger Stats</div></div><div id="reputation-stats"></div></div>
        <div class="card">
          <div class="card-header"><div class="card-title">Generate Badge</div></div>
          <div class="field-row">
            <div class="field"><label>Agent</label><select id="rep-agent"><option>claude-code</option><option>cursor</option><option>codex</option><option>cline</option></select></div>
            <div class="field"><label>Version</label><input id="rep-ver" placeholder="4.7"/></div>
          </div>
          <button class="btn primary" onclick="genBadge()">Generate</button>
          <pre class="mono" id="rep-badge-output" style="margin-top:10px;background:var(--bg-elev-1);padding:10px;border-radius:6px"></pre>
        </div>
      </div>
      <div class="card mt-lg" style="padding:0">
        <div style="padding:14px 18px 6px"><div class="card-title">Agent Leaderboard</div></div>
        <table class="table"><thead><tr><th>Agent</th><th>Accuracy</th><th>Decisions</th><th>Correct/Incorrect/Partial</th></tr></thead><tbody id="rep-leaderboard"></tbody></table>
      </div>
    </section>

    <!-- ════ DEBATE ══════════════════════════════════════════════════ -->
    <section class="section" id="tab-debate">
      <div class="accent-bar"></div>
      <div class="section-header"><div><h1 class="section-title">Swarm Debate Protocol</h1><div class="section-subtitle">Pro / con / arbiter multi-agent debate for critical decisions</div></div></div>
      <div class="card">
        <div class="field"><label>Question</label><input id="debate-question" placeholder="e.g. Redis or Postgres for session storage?"/></div>
        <div class="field"><label>Context</label><textarea id="debate-context" rows="2" placeholder="e.g. 10k users, read-heavy workload"></textarea></div>
        <div class="field-row"><div class="field"><label>Turns per side</label><input id="debate-turns" value="2"/></div><div class="field"><label>&nbsp;</label><button class="btn primary" onclick="runDebate()" style="width:100%">Run Debate</button></div></div>
        <pre class="mono" id="debate-output" style="margin-top:12px;max-height:420px;overflow:auto;background:var(--bg-elev-1);padding:12px;border-radius:6px"></pre>
      </div>
    </section>

    <!-- ════ PREMORTEM ═══════════════════════════════════════════════ -->
    <section class="section" id="tab-premortem">
      <div class="accent-bar"></div>
      <div class="section-header"><div><h1 class="section-title">Pre-Mortem Assistant</h1><div class="section-subtitle">Surface past failures from YOUR project before significant tasks</div></div></div>
      <div class="card">
        <div class="field"><label>Task description</label><input id="pm-task" placeholder="e.g. migrate auth to passkeys"/></div>
        <button class="btn primary" onclick="runPremortem()">Run Pre-Mortem</button>
        <div id="pm-output" style="margin-top:14px"></div>
      </div>
    </section>

    <!-- ════ ATTENTION ═══════════════════════════════════════════════ -->
    <section class="section" id="tab-attention">
      <div class="accent-bar"></div>
      <div class="section-header"><div><h1 class="section-title">Attention Heatmap</h1><div class="section-subtitle">See which memories shaped a decision — weighted attribution</div></div></div>
      <div class="card">
        <div class="field"><label>Decision text</label><input id="att-decision" placeholder="e.g. use parameterized SQL queries"/></div>
        <div class="field"><label>Candidate memory IDs (comma-separated)</label><input id="att-memories" placeholder="id1, id2, id3"/></div>
        <button class="btn primary" onclick="runAttention()">Compute Attention</button>
        <pre class="mono" id="att-output" style="margin-top:12px;max-height:320px;overflow:auto;background:var(--bg-elev-1);padding:12px;border-radius:6px"></pre>
      </div>
    </section>

    <!-- ════ TOKENS ══════════════════════════════════════════════════ -->
    <section class="section" id="tab-tokens">
      <div class="accent-bar"></div>
      <div class="section-header"><div><h1 class="section-title">Token Economy Engine</h1><div class="section-subtitle">Cross-agent spend tracking · savings suggestions · routing advice</div></div></div>
      <div class="grid cols-4">
        <div class="card stat-card"><div class="label">Total Spend</div><div class="value" id="tok-total">$—</div><div class="trend">all time</div></div>
        <div class="card stat-card"><div class="label">Monthly Projection</div><div class="value" id="tok-proj">$—</div><div class="trend">from last 7 days</div></div>
        <div class="card stat-card"><div class="label">Savings Available</div><div class="value" style="color:var(--success)" id="tok-save">$—</div><div class="trend up">via smart routing</div></div>
        <div class="card stat-card"><div class="label">Total Calls</div><div class="value" id="tok-calls">—</div><div class="trend" id="tok-calls-sub"></div></div>
      </div>
      <div class="grid cols-2 mt-lg">
        <div class="card"><div class="card-header"><div class="card-title">Spend by Model</div></div><div class="chart-wrap"><canvas id="chart-tokens-model"></canvas></div></div>
        <div class="card"><div class="card-header"><div class="card-title">Savings Suggestions</div></div><div id="tok-suggestions"></div></div>
      </div>
    </section>

    <!-- ════ FORGET ══════════════════════════════════════════════════ -->
    <section class="section" id="tab-forget">
      <div class="accent-bar"></div>
      <div class="section-header"><div><h1 class="section-title">Forgetting Curve + Sleep Consolidation</h1><div class="section-subtitle">Ebbinghaus-inspired natural decay · tier promotion</div></div><div class="section-actions"><button class="btn primary" onclick="runForget()">Run Consolidation Cycle</button></div></div>
      <div class="grid cols-2">
        <div class="card"><div class="card-header"><div class="card-title">Last Cycle</div></div><div id="forget-output"></div></div>
        <div class="card"><div class="card-header"><div class="card-title">Memory Strength Distribution</div></div><div class="chart-wrap"><canvas id="chart-forget"></canvas></div></div>
      </div>
    </section>

    <!-- ════ FORMAL ══════════════════════════════════════════════════ -->
    <section class="section" id="tab-formal">
      <div class="accent-bar"></div>
      <div class="section-header"><div><h1 class="section-title">Formal Verification Bridge</h1><div class="section-subtitle">Natural-language rules → ESLint / Semgrep / LSP diagnostics</div></div></div>
      <div class="grid cols-2">
        <div class="card">
          <div class="card-header"><div class="card-title">Generate Rule</div></div>
          <div class="field"><label>Natural-language rule</label><textarea id="formal-text" rows="3" placeholder="e.g. always use parameterized SQL queries"></textarea></div>
          <button class="btn primary" onclick="genFormal()">Generate</button>
          <pre class="mono" id="formal-output" style="margin-top:12px;max-height:220px;overflow:auto;background:var(--bg-elev-1);padding:10px;border-radius:6px"></pre>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">Exports</div></div>
          <div class="flex gap"><button class="btn" onclick="exportEslint()">ESLint</button><button class="btn" onclick="exportSemgrep()">Semgrep YAML</button></div>
          <pre class="mono" id="formal-export" style="margin-top:12px;max-height:280px;overflow:auto;background:var(--bg-elev-1);padding:10px;border-radius:6px"></pre>
        </div>
      </div>
    </section>

    <!-- ════ CALIBRATION ═════════════════════════════════════════════ -->
    <section class="section" id="tab-calibration">
      <div class="accent-bar"></div>
      <div class="section-header"><div><h1 class="section-title">Confidence Calibration Monitor</h1><div class="section-subtitle">Brier scores per agent per category</div></div></div>
      <div class="card" style="padding:0">
        <table class="table"><thead><tr><th>Agent</th><th>Category</th><th>Brier</th><th>Cal. Error</th><th>Overconf.</th><th>Trust Weight</th><th>Samples</th></tr></thead><tbody id="calibration-table"></tbody></table>
      </div>
    </section>

    <!-- ════ BRANCH ══════════════════════════════════════════════════ -->
    <section class="section" id="tab-branch">
      <div class="accent-bar"></div>
      <div class="section-header"><div><h1 class="section-title">Branch Brains</h1><div class="section-subtitle">Git-branch-aware memory context</div></div></div>
      <div class="card"><div id="branch-state"></div></div>
    </section>

    <!-- ════ PRIVACY ═════════════════════════════════════════════════ -->
    <section class="section" id="tab-privacy">
      <div class="accent-bar"></div>
      <div class="section-header"><div><h1 class="section-title">Privacy & Safety</h1><div class="section-subtitle">Air-Gap mode · encryption · hallucination quarantine</div></div></div>
      <div class="grid cols-2">
        <div class="card">
          <div class="card-header"><div class="card-title">Air-Gap Mode</div></div>
          <div id="airgap-state"></div>
          <div class="flex gap mt"><button class="btn success" onclick="enableAirGap()">Enable (strict)</button><button class="btn danger" onclick="disableAirGap()">Disable</button></div>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">Hallucination Quarantine</div></div>
          <div id="quarantine-state"></div>
        </div>
      </div>
      <div class="card mt-lg" style="padding:0">
        <div style="padding:14px 18px 6px"><div class="card-title">Pending Quarantine Queue</div></div>
        <table class="table"><thead><tr><th>ID</th><th>Source</th><th>Claim</th><th>Reason</th><th style="text-align:right">Action</th></tr></thead><tbody id="quarantine-list"></tbody></table>
      </div>
    </section>

    <!-- ════ VOICE ═══════════════════════════════════════════════════ -->
    <section class="section" id="tab-voice">
      <div class="accent-bar"></div>
      <div class="section-header"><div><h1 class="section-title">Voice Mode</h1><div class="section-subtitle">Process voice transcripts · local Whisper-compatible</div></div></div>
      <div class="card">
        <div class="field"><label>Transcript</label><input id="voice-input" placeholder="e.g. brain status"/></div>
        <button class="btn primary" onclick="sendVoice()">Process</button>
        <pre class="mono" id="voice-output" style="margin-top:12px;background:var(--bg-elev-1);padding:10px;border-radius:6px"></pre>
      </div>
    </section>

    <!-- ════ GARDEN ══════════════════════════════════════════════════ -->
    <section class="section" id="tab-garden">
      <div class="accent-bar"></div>
      <div class="section-header"><div><h1 class="section-title">Brain Garden</h1><div class="section-subtitle">Living constellation visualization of the brain</div></div></div>
      <div class="card">
        <canvas id="garden-canvas" width="1200" height="500" style="width:100%;background:radial-gradient(ellipse at center, rgba(24,255,255,0.04), transparent);border-radius:8px;display:block"></canvas>
        <div class="mono mt" id="garden-stats"></div>
      </div>
    </section>

    <!-- ════ PR REVIEW ═══════════════════════════════════════════════ -->
    <section class="section" id="tab-pr">
      <div class="accent-bar"></div>
      <div class="section-header"><div><h1 class="section-title">PR Auto-Review</h1><div class="section-subtitle">Generate GitHub PR comments from brain memories</div></div></div>
      <div class="card">
        <div class="grid cols-2">
          <div class="field"><label>Repo (owner/name)</label><input id="pr-repo" placeholder="theihtisham/agent-shadow-brain"/></div>
          <div class="field"><label>PR number</label><input id="pr-num" placeholder="42"/></div>
        </div>
        <div class="field"><label>Changed files (comma-separated)</label><input id="pr-files"/></div>
        <div class="field"><label>Diff summary</label><textarea id="pr-diff" rows="4"></textarea></div>
        <button class="btn primary" onclick="genPRReview()">Generate Review</button>
        <pre class="mono" id="pr-output" style="margin-top:14px;max-height:400px;overflow:auto;background:var(--bg-elev-1);padding:14px;border-radius:6px"></pre>
      </div>
    </section>

    <!-- ════ TEAM ════════════════════════════════════════════════════ -->
    <section class="section" id="tab-team">
      <div class="accent-bar"></div>
      <div class="section-header"><div><h1 class="section-title">Team Brain Sync</h1><div class="section-subtitle">Peer-to-peer brain sync (WebRTC, no server)</div></div></div>
      <div class="grid cols-2">
        <div class="card"><div class="card-header"><div class="card-title">My Peer Info</div></div><div id="team-self"></div></div>
        <div class="card"><div class="card-header"><div class="card-title">Connected Peers</div></div><div id="team-peers"></div></div>
      </div>
    </section>

    <!-- ════ EXCHANGE ════════════════════════════════════════════════ -->
    <section class="section" id="tab-exchange">
      <div class="accent-bar"></div>
      <div class="section-header"><div><h1 class="section-title">Brain Exchange</h1><div class="section-subtitle">Export / import curated shareable brain slices</div></div></div>
      <div class="grid cols-2">
        <div class="card">
          <div class="card-header"><div class="card-title">Export Package</div></div>
          <div class="field"><label>Name</label><input id="ex-name" placeholder="react-patterns-v1"/></div>
          <div class="field"><label>Description</label><input id="ex-desc"/></div>
          <div class="field-row">
            <div class="field"><label>Author</label><input id="ex-author" value="anonymous"/></div>
            <div class="field"><label>Tags (csv)</label><input id="ex-tags" placeholder="react, auth"/></div>
          </div>
          <button class="btn primary" onclick="exportPackage()">Export</button>
          <div class="mono mt" id="ex-out"></div>
        </div>
        <div class="card"><div class="card-header"><div class="card-title">Local Packages</div></div><div id="ex-list"></div></div>
      </div>
    </section>

    <!-- ════ FEATURE TOGGLES ═════════════════════════════════════════ -->
    <section class="section" id="tab-features">
      <div class="accent-bar"></div>
      <div class="section-header"><div><h1 class="section-title">Feature Toggles</h1><div class="section-subtitle">Enable / disable any v6 module · persisted globally</div></div></div>
      <div class="card"><div class="feature-grid" id="feature-grid"></div></div>
    </section>

    <!-- ════ MODELS & INTELLIGENCE ═══════════════════════════════════ -->
    <section class="section" id="tab-models">
      <div class="accent-bar"></div>
      <div class="section-header">
        <div>
          <h1 class="section-title">Models & Brain Intelligence</h1>
          <div class="section-subtitle">Route the Hive Mind through Ollama · Anthropic · OpenAI · OpenRouter · Moonshot/Kimi · Gemini · DeepSeek · Mistral — or reuse your existing agent tools' configuration</div>
        </div>
        <div class="section-actions"><button class="btn" onclick="refreshModels()">Refresh</button></div>
      </div>

      <div class="card mb-lg">
        <div class="card-header"><div class="card-title">Auto-Discovered Agent Configurations</div></div>
        <div class="mono mb" style="color:var(--text-2)">Shadow Brain detected these agent tools' configs on your machine — no need to re-enter API keys. Toggle "Use agent-tool models" below to let the brain borrow their intelligence.</div>
        <div id="discovered-agents"></div>
      </div>

      <div class="card mb-lg">
        <div class="card-header"><div class="card-title">Brain Intelligence Configuration</div></div>
        <div class="grid cols-2">
          <div class="field"><label>Lead Provider</label><select id="intel-provider"></select></div>
          <div class="field"><label>Lead Model</label><select id="intel-model"></select></div>
        </div>
        <div class="feature-toggle mb"><div class="icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div><div class="meta"><div class="name">Use already-configured agent-tool models</div><div class="desc">Reuse Claude Code / Cursor / Codex / Cline intelligence — no new API keys needed</div></div><label class="switch"><input type="checkbox" id="intel-agent-proxy"><span class="slider"></span></label></div>
        <div class="feature-toggle"><div class="icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></div><div class="meta"><div class="name">Prefer Local-First (Ollama)</div><div class="desc">Route everything through Ollama when possible · zero cost · offline-ready</div></div><label class="switch"><input type="checkbox" id="intel-local-first"><span class="slider"></span></label></div>
        <button class="btn primary mt" onclick="saveIntelligence()">Save Intelligence Config</button>
        <div class="mono mt" id="intel-result"></div>
      </div>

      <div class="card mb-lg">
        <div class="card-header"><div class="card-title">Provider Configuration</div></div>
        <div class="grid cols-2" id="providers-grid"></div>
      </div>

      <div class="card">
        <div class="card-header"><div class="card-title">Custom Agent Paths (Hermes / OpenClaw / Nemoclaw / any)</div></div>
        <div class="mono mb" style="color:var(--text-2)">Point Shadow Brain at any agent's config file — we'll read the provider, model, and API key if present.</div>
        <div id="custom-agents-list"></div>
        <div class="grid cols-3 mt">
          <div class="field"><label>Agent name</label><input id="ca-name" placeholder="hermes / openclaw / nemoclaw / ..."/></div>
          <div class="field"><label>Config file path</label><input id="ca-path" placeholder="C:\\Users\\you\\.hermes\\config.json"/></div>
          <div class="field"><label>&nbsp;</label><button class="btn primary" onclick="addCustomAgent()" style="width:100%">Add</button></div>
        </div>
      </div>
    </section>

    <!-- ════ CONFIG ══════════════════════════════════════════════════ -->
    <section class="section" id="tab-config">
      <div class="accent-bar"></div>
      <div class="section-header"><div><h1 class="section-title">Configuration</h1><div class="section-subtitle">LLM provider · API keys · MCP server · global settings</div></div></div>
      <div class="grid cols-2">
        <div class="card">
          <div class="card-header"><div class="card-title">LLM Provider</div></div>
          <div class="field"><label>Provider</label><select id="cfg-provider"><option value="ollama">Ollama (local)</option><option value="anthropic">Anthropic</option><option value="openai">OpenAI</option><option value="gemini">Gemini</option><option value="deepseek">DeepSeek</option></select></div>
          <div class="field"><label>API Key (blank = env var)</label><input type="password" id="cfg-apikey"/></div>
          <div class="field"><label>Model</label><input id="cfg-model" placeholder="claude-opus-4-7"/></div>
          <div class="flex gap"><button class="btn primary" onclick="saveConfig()">Save</button><button class="btn" onclick="testConnection()">Test</button></div>
          <div class="mono mt" id="cfg-result"></div>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">MCP Server</div></div>
          <div class="field"><label>Port</label><input id="mcp-port" value="7342"/></div>
          <div class="field"><label>Auth Token (optional)</label><input id="mcp-token" type="password"/></div>
          <div class="flex gap"><button class="btn primary" onclick="startMCP()">Start</button><button class="btn danger" onclick="stopMCP()">Stop</button></div>
          <div class="mono mt" id="mcp-result"></div>
        </div>
        <div class="card span-2">
          <div class="card-header"><div class="card-title">System Status</div></div>
          <div id="config-state"></div>
        </div>
      </div>
    </section>

  </main>
</div>

<!-- ══════════════════════════════════════════════════════════════════════
     Command Palette overlay (Cmd+K)
     ══════════════════════════════════════════════════════════════════════ -->
<div class="cmd-overlay" id="cmd-overlay" onclick="if(event.target===this)closeCmdPalette()">
  <div class="cmd-palette">
    <input id="cmd-input" placeholder="Search features, actions, memories…" autocomplete="off"/>
    <div class="results" id="cmd-results"></div>
  </div>
</div>

<!-- Toast container -->
<div class="toast-container" id="toast-container"></div>

<!-- Log ticker -->
<div class="log-ticker">
  <div class="dot"></div>
  <div class="scroll" id="log-scroll">Hive Mind initializing…</div>
  <button class="icon-btn" style="width:28px;height:24px;padding:0" onclick="toggleLogPanel()" title="Open log"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
</div>

<!-- Expandable log panel -->
<div class="log-panel" id="log-panel">
  <div class="head">
    <div class="title">LIVE ACTIVITY</div>
    <div class="flex gap">
      <button class="btn sm ghost" onclick="clearLogs()">Clear</button>
      <button class="btn sm ghost" onclick="toggleLogPanel()">Close</button>
    </div>
  </div>
  <div id="log-panel-list"></div>
</div>

<!-- ══════════════════════════════════════════════════════════════════════
     Scripts
     ══════════════════════════════════════════════════════════════════════ -->
<script>
const FEATURES = [
  ['sabb','Sub-Agent Bridge','Syncs memory to Claude Task, Cursor Composer, CrewAI, LangGraph'],
  ['causal','Causal Chains','Track cause→effect for every decision'],
  ['collision','Collision Detective','Real-time overlap detection'],
  ['dream','Dream Engine','Idle-time reflection via local LLM'],
  ['reputation','Reputation Ledger','Ed25519-signed agent receipts'],
  ['debate','Swarm Debate','Multi-agent debate w/ arbiter'],
  ['premortem','Pre-Mortem','Surface past failures before tasks'],
  ['branch','Branch Brains','Git-branch-aware memory'],
  ['attention','Attention Heatmap','Weighted memory attribution'],
  ['tokens','Token Economy','Spend tracking + savings'],
  ['forget','Forgetting Curve','Ebbinghaus memory decay'],
  ['formal','Formal Bridge','NL → ESLint/Semgrep'],
  ['calibration','Calibration Monitor','Brier score trust weighting'],
  ['airgap','Air-Gap Mode','Zero outbound network'],
  ['encrypt','E2E Encryption','ChaCha20-Poly1305 at rest'],
  ['quarantine','Hallucination Quarantine','Isolate suspect claims'],
  ['voice','Voice Mode','Transcript + intent'],
  ['garden','Brain Garden','Memory visualizer'],
  ['pr','PR Auto-Review','GitHub PR comments'],
  ['team','Team Brain Sync','WebRTC P2P'],
  ['exchange','Brain Exchange','Share brain slices'],
  ['local-llm','Local-First LLM','Ollama-first default'],
];

let ws = null;
let state = { hive: null, lastRefreshAt: 0 };
let charts = {};

// ──── Tab switching ────────────────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(el => el.addEventListener('click', () => switchTab(el.dataset.tab, el.dataset.title)));
function switchTab(id, title) {
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.tab === id));
  document.querySelectorAll('.section').forEach(el => el.classList.toggle('active', el.id === 'tab-' + id));
  if (window.innerWidth <= 768) document.getElementById('sidebar').classList.remove('open');
  onTabOpen(id);
}
function onTabOpen(tab) {
  const fn = { overview: refreshOverview, graph: startGraph, agents: refreshAgents, memory: () => searchMemory(), chat: refreshChat, activity: refreshActivity,
    sabb: refreshSABB, causal: refreshCausal, collision: refreshCollision, dream: refreshDream, reputation: refreshReputation,
    tokens: refreshTokens, forget: refreshForget, formal: null, calibration: refreshCalibration, branch: refreshBranch,
    privacy: refreshPrivacy, garden: refreshGarden, team: refreshTeam, exchange: refreshExchange, features: refreshFeatures,
    models: refreshModels, config: refreshConfig }[tab];
  if (fn) fn();
}

// ──── Sidebar mobile ───────────────────────────────────────────────────
function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); }

// ──── Theme toggle ─────────────────────────────────────────────────────
function toggleTheme() {
  const html = document.documentElement;
  const newT = html.dataset.theme === 'light' ? 'dark' : 'light';
  html.dataset.theme = newT;
  try { localStorage.setItem('hive.theme', newT); } catch {}
  if (charts.tokens) updateChartColors();
}
(function initTheme(){
  try {
    const t = localStorage.getItem('hive.theme');
    // Default to light for better readability
    document.documentElement.dataset.theme = t || 'light';
  } catch { document.documentElement.dataset.theme = 'light'; }
})();

// ──── API helpers ──────────────────────────────────────────────────────
async function api(path, body) {
  try {
    const opts = body !== undefined ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {};
    const res = await fetch(path, opts);
    if (!res.ok) { toast('API error', res.status + ' ' + path, 'error'); return null; }
    const ct = res.headers.get('content-type') || '';
    return ct.includes('application/json') ? await res.json() : await res.text();
  } catch (err) { toast('Network error', err.message, 'error'); return null; }
}

// ──── Toasts ───────────────────────────────────────────────────────────
function toast(title, body, variant='success') {
  const c = document.getElementById('toast-container');
  const icons = { success:'<path d="M20 6 9 17l-5-5"/>', warn:'<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>', error:'<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>', info:'<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>' };
  const el = document.createElement('div');
  el.className = 'toast ' + variant;
  el.innerHTML = \`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">\${icons[variant] || icons.info}</svg><div><div class="title">\${title}</div>\${body ? '<div class="body">' + body + '</div>' : ''}</div>\`;
  c.appendChild(el);
  setTimeout(() => { el.classList.add('removing'); setTimeout(() => el.remove(), 400); }, 3800);
}

// ──── Animated counters ────────────────────────────────────────────────
const _counterState = {};
function animateNum(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const start = parseFloat((el.textContent || '0').replace(/[^\d.-]/g, '')) || 0;
  if (start === target) { el.textContent = target.toLocaleString(); return; }
  if (_counterState[id]) cancelAnimationFrame(_counterState[id]);
  const startTime = performance.now();
  const duration = 650;
  const step = now => {
    const t = Math.min(1, (now - startTime) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    const val = start + (target - start) * eased;
    el.textContent = Math.round(val).toLocaleString();
    if (t < 1) _counterState[id] = requestAnimationFrame(step);
    else { el.textContent = target.toLocaleString(); delete _counterState[id]; }
  };
  _counterState[id] = requestAnimationFrame(step);
}
function animateMoney(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const start = parseFloat((el.textContent || '0').replace(/[^\d.-]/g, '')) || 0;
  if (Math.abs(start - target) < 0.001) { el.textContent = '$' + target.toFixed(2); return; }
  if (_counterState[id]) cancelAnimationFrame(_counterState[id]);
  const startTime = performance.now();
  const duration = 650;
  const step = now => {
    const t = Math.min(1, (now - startTime) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    const val = start + (target - start) * eased;
    el.textContent = '$' + val.toFixed(2);
    if (t < 1) _counterState[id] = requestAnimationFrame(step);
    else { el.textContent = '$' + target.toFixed(2); delete _counterState[id]; }
  };
  _counterState[id] = requestAnimationFrame(step);
}

// ──── Main refresh ─────────────────────────────────────────────────────
async function refresh() {
  const hive = await api('/api/v6/hive-status');
  if (!hive) return;
  state.hive = hive;
  state.lastRefreshAt = Date.now();

  animateNum('stat-agents', hive.totalAgentsConnected ?? 0);
  animateNum('stat-memories', hive.totalMemoriesStored ?? 0);
  animateNum('stat-dreams', hive.modules.dream?.totalDreams ?? 0);
  animateMoney('stat-savings', hive.modules.tokenEconomy?.savingsOpportunitiesUsd ?? 0);
  document.getElementById('badge-sabb').textContent = hive.modules.sabb?.totalSpawns ?? 0;
  document.getElementById('badge-causal').textContent = hive.modules.causal?.totalLinks ?? 0;
  document.getElementById('badge-collision').textContent = hive.modules.collision?.collisionsDetected ?? 0;
  document.getElementById('badge-dream').textContent = hive.modules.dream?.totalDreams ?? 0;
  const activeTab = document.querySelector('.nav-item.active')?.dataset.tab;
  if (activeTab) onTabOpen(activeTab);
}

// ──── Overview ─────────────────────────────────────────────────────────
async function refreshOverview() {
  const hive = state.hive || await api('/api/v6/hive-status');
  if (!hive) return;
  animateNum('ov-agents', hive.totalAgentsConnected ?? 0);
  animateNum('ov-memories', hive.totalMemoriesStored ?? 0);
  animateNum('ov-subagents', hive.modules.sabb?.totalSpawns ?? 0);
  document.getElementById('ov-subagents-sub').textContent = \`grad: \${hive.modules.sabb?.graduated ?? 0} · quar: \${hive.modules.sabb?.quarantined ?? 0}\`;
  animateMoney('ov-savings', hive.modules.tokenEconomy?.savingsOpportunitiesUsd ?? 0);
  document.getElementById('ov-savings-sub').textContent = 'projection: $' + (hive.modules.tokenEconomy?.monthlyProjectionUsd?.toFixed?.(2) ?? '0.00');

  const moduleRows = [
    ['SABB spawns', hive.modules.sabb?.totalSpawns ?? 0, 'good'],
    ['Causal links', hive.modules.causal?.totalLinks ?? 0, 'good'],
    ['Collisions detected', hive.modules.collision?.collisionsDetected ?? 0, 'warn'],
    ['Dreams recorded', hive.modules.dream?.totalDreams ?? 0, 'good'],
    ['Reputation receipts', hive.modules.reputation?.totalReceipts ?? 0, 'good'],
    ['Formal rules', hive.modules.formalBridge?.totalRules ?? 0, 'good'],
  ];
  document.getElementById('ov-modules').innerHTML = moduleRows.map(([k, v, cls]) =>
    \`<div class="row"><span class="k">\${k}</span><span class="v \${cls || ''}">\${v}</span></div>\`
  ).join('');

  const health = [
    ['Local-first', hive.localFirst ? 'ON' : 'OFF', hive.localFirst ? 'good' : 'warn'],
    ['Air-gap', hive.modules.airGap?.enabled ? 'ENABLED' : 'disabled', hive.modules.airGap?.enabled ? 'good' : ''],
    ['Version', hive.version, ''],
    ['Monthly cost', '$' + (hive.modules.tokenEconomy?.monthlyProjectionUsd?.toFixed?.(2) ?? '0.00'), 'warn'],
    ['Cost saved/mo', '$' + (hive.modules.tokenEconomy?.savingsOpportunitiesUsd?.toFixed?.(2) ?? '0.00'), 'good'],
  ];
  document.getElementById('ov-health').innerHTML = health.map(([k, v, cls]) => \`<div class="row"><span class="k">\${k}</span><span class="v \${cls}">\${v}</span></div>\`).join('');

  // Tokens chart
  const tok = hive.modules.tokenEconomy;
  if (tok && tok.byModel) drawTokensChart(tok.byModel);

  // Timeline
  const timeline = await api('/api/v6/activity-log?limit=15') ?? [];
  document.getElementById('ov-timeline').innerHTML = timeline.length
    ? timeline.slice(0, 10).map(e => \`<div style="padding:5px 0;border-bottom:1px solid var(--border);display:flex;gap:8px"><span style="color:var(--text-dim);flex-shrink:0">\${new Date(e.timestamp).toLocaleTimeString()}</span><span class="pill \${typeToPill(e.type)}">\${e.type}</span><span style="color:var(--text-2);font-size:11px">\${(e.detail||'').slice(0,90)}</span></div>\`).join('')
    : '<div class="empty">No activity yet</div>';
}
function typeToPill(type) {
  if (type === 'memory-write') return 'green';
  if (type === 'subagent-spawn') return 'cyan';
  if (type === 'collision') return 'red';
  if (type === 'quarantine') return 'yellow';
  if (['dream','revisit','counterfactual','consolidation','pattern-discovery','contradiction'].includes(type)) return 'purple';
  return '';
}

// ──── Charts ───────────────────────────────────────────────────────────
function chartTheme() {
  const dark = document.documentElement.dataset.theme !== 'light';
  return { grid: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', text: dark ? '#a4afc4' : '#3d4864' };
}
function drawTokensChart(byModel) {
  const ctx = document.getElementById('chart-tokens');
  if (!ctx) return;
  const labels = Object.keys(byModel);
  const data = labels.map(l => byModel[l].spendUsd);
  const t = chartTheme();
  if (charts.tokens) charts.tokens.destroy();
  charts.tokens = new Chart(ctx, { type: 'bar', data: { labels, datasets: [{ label: 'Spend (USD)', data, backgroundColor: ['#18ffff','#a855f7','#ec4899','#10e68c','#ffb53f','#4fb6ff'], borderRadius: 6 }] }, options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{x:{grid:{color:t.grid},ticks:{color:t.text}},y:{grid:{color:t.grid},ticks:{color:t.text,callback:v=>'$'+v.toFixed(2)}}} } });
}
function drawTokensModelChart(byModel) {
  const ctx = document.getElementById('chart-tokens-model');
  if (!ctx) return;
  const labels = Object.keys(byModel);
  const data = labels.map(l => byModel[l].spendUsd);
  const t = chartTheme();
  if (charts.tokensModel) charts.tokensModel.destroy();
  charts.tokensModel = new Chart(ctx, { type: 'doughnut', data: { labels, datasets: [{ data, backgroundColor: ['#18ffff','#a855f7','#ec4899','#10e68c','#ffb53f','#4fb6ff'], borderWidth:0 }] }, options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'right',labels:{color:t.text,boxWidth:12}}} } });
}
function drawDreamChart(byType) {
  const ctx = document.getElementById('chart-dreams');
  if (!ctx) return;
  const labels = Object.keys(byType);
  const data = labels.map(l => byType[l]);
  const t = chartTheme();
  if (charts.dreams) charts.dreams.destroy();
  charts.dreams = new Chart(ctx, { type:'polarArea', data:{labels,datasets:[{data,backgroundColor:['#18ffff88','#a855f788','#ec489988','#10e68c88','#ffb53f88']}]}, options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:t.text}}},scales:{r:{grid:{color:t.grid},ticks:{color:t.text,backdropColor:'transparent'}}}} });
}
function drawForgetChart(states) {
  const ctx = document.getElementById('chart-forget');
  if (!ctx) return;
  const buckets = { strong: 0, medium: 0, weak: 0, fading: 0 };
  for (const s of states || []) {
    if (s.currentStrength >= 0.8) buckets.strong++;
    else if (s.currentStrength >= 0.5) buckets.medium++;
    else if (s.currentStrength >= 0.2) buckets.weak++;
    else buckets.fading++;
  }
  const t = chartTheme();
  if (charts.forget) charts.forget.destroy();
  charts.forget = new Chart(ctx, { type:'bar', data:{labels:Object.keys(buckets),datasets:[{data:Object.values(buckets),backgroundColor:['#10e68c','#18ffff','#ffb53f','#ff5864'],borderRadius:4}]}, options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{color:t.grid},ticks:{color:t.text}},y:{grid:{color:t.grid},ticks:{color:t.text}}}} });
}
function updateChartColors() { for (const k of Object.keys(charts)) { charts[k].destroy(); delete charts[k]; } refresh(); }

// ──── SABB ─────────────────────────────────────────────────────────────
async function refreshSABB() {
  const hive = state.hive || await api('/api/v6/hive-status');
  const s = hive?.modules.sabb ?? {};
  document.getElementById('sabb-stats').innerHTML = \`
    <div class="row"><span class="k">Total spawns</span><span class="v">\${s.totalSpawns ?? 0}</span></div>
    <div class="row"><span class="k">Quarantined</span><span class="v">\${s.quarantined ?? 0}</span></div>
    <div class="row"><span class="k">Graduated</span><span class="v good">\${s.graduated ?? 0}</span></div>
    <div class="row"><span class="k">Rejected</span><span class="v bad">\${s.rejected ?? 0}</span></div>
    <div class="row"><span class="k">Avg sliver tokens</span><span class="v">\${Math.round(s.avgSliverTokens ?? 0)}</span></div>
    <div class="row"><span class="k">Avg graduation</span><span class="v">\${Math.round(s.avgGraduationMs ?? 0)}ms</span></div>\`;
  const q = await api('/api/v6/subagent-quarantine') ?? [];
  document.getElementById('sabb-quarantine').innerHTML = q.length ? q.map(e =>
    \`<tr><td><code>\${e.id.slice(0,10)}</code></td><td><span class="pill purple">\${e.parentAgent}</span></td><td>\${e.category}</td><td>\${(e.confidence||0).toFixed(2)}</td><td>\${(e.content||'').slice(0,100)}</td><td style="text-align:right"><button class="btn sm success" onclick="graduate('\${e.id}')">Graduate</button> <button class="btn sm danger" onclick="rejectMem('\${e.id}')">Reject</button></td></tr>\`
  ).join('') : '<tr><td colspan="6"><div class="empty">No quarantined memories</div></td></tr>';
}
async function computeSliver() {
  const res = await api('/api/v6/subagent-sliver', {
    parentAgent: document.getElementById('sabb-parent').value,
    framework: document.getElementById('sabb-framework').value,
    taskDescription: document.getElementById('sabb-task').value,
    tokenBudget: parseInt(document.getElementById('sabb-budget').value || '300'),
  });
  if (res) { document.getElementById('sabb-sliver-output').textContent = res.markdown; toast('Sliver computed', res.memories.length + ' memories · ' + res.tokenCount + ' tokens'); }
}
async function graduate(id) { const r = await api('/api/v6/subagent-graduate', { memoryId: id }); if (r?.ok) { toast('Graduated', id.slice(0,10)); refreshSABB(); } }
async function rejectMem(id) { const r = await api('/api/v6/subagent-reject', { memoryId: id, reason: 'manual-reject' }); if (r?.ok) { toast('Rejected', id.slice(0,10), 'warn'); refreshSABB(); } }

// ──── Causal ───────────────────────────────────────────────────────────
async function refreshCausal() {
  const hive = state.hive || await api('/api/v6/hive-status');
  const s = hive?.modules.causal ?? {};
  document.getElementById('causal-stats').innerHTML = \`<div class="row"><span class="k">Total links</span><span class="v">\${s.totalLinks ?? 0}</span></div><div class="row"><span class="k">Effects</span><span class="v">\${s.effects ?? 0}</span></div><div class="row"><span class="k">Causes</span><span class="v">\${s.causes ?? 0}</span></div>\`;
}
async function traceCausal() {
  const id = document.getElementById('causal-mem-id').value;
  if (!id) return toast('Missing', 'Enter a memory ID', 'warn');
  const res = await api('/api/v6/causal-trace', { memoryId: id, maxDepth: parseInt(document.getElementById('causal-depth').value || '8') });
  if (res) document.getElementById('causal-output').textContent = res.dot;
}
async function influenceCausal() {
  const id = document.getElementById('causal-mem-id').value;
  if (!id) return;
  const res = await api('/api/v6/causal-influence', { memoryId: id, maxDepth: 6 });
  if (res) document.getElementById('causal-output').textContent = res.dot;
}
async function linkCausal() {
  const r = await api('/api/v6/causal-link', {
    effectId: document.getElementById('causal-effect').value,
    causeId: document.getElementById('causal-cause').value,
    rationale: document.getElementById('causal-rationale').value,
  });
  if (r) { toast('Link recorded'); refreshCausal(); }
}

// ──── Collision ────────────────────────────────────────────────────────
async function refreshCollision() {
  const hive = state.hive || await api('/api/v6/hive-status');
  const s = hive?.modules.collision ?? {};
  document.getElementById('collision-stats').innerHTML = \`<div class="row"><span class="k">Active intents</span><span class="v">\${s.activeIntents ?? 0}</span></div><div class="row"><span class="k">Collisions detected</span><span class="v warn">\${s.collisionsDetected ?? 0}</span></div><div class="row"><span class="k">Resolved</span><span class="v good">\${s.collisionsResolved ?? 0}</span></div><div class="row"><span class="k">Avg overlap</span><span class="v">\${(s.avgOverlapLines ?? 0).toFixed(1)} lines</span></div>\`;
  const data = await api('/api/v6/collision-list') ?? { intents: [], alerts: [] };
  document.getElementById('collision-alerts').innerHTML = data.alerts.length
    ? data.alerts.map(a => \`<div style="padding:10px;background:var(--bg-elev-2);border-left:3px solid var(--danger);border-radius:6px;margin-bottom:6px"><div style="font-weight:600;font-size:12px">\${(a.filePath||'').split(/[\\\\/]/).pop()}</div><div class="mono" style="margin-top:4px;color:var(--text-2)">\${a.suggestedResolution}</div></div>\`).join('')
    : '<div class="empty">No active alerts</div>';
  document.getElementById('collision-intents').innerHTML = data.intents.length ? data.intents.map(i =>
    \`<tr><td><span class="pill cyan">\${i.agentTool}</span></td><td><code>\${(i.filePath||'').split(/[\\\\/]/).pop()}</code></td><td>\${i.startLine}-\${i.endLine}</td><td>\${(i.intent||'').slice(0,80)}</td><td class="mono">\${new Date(i.expiresAt).toLocaleTimeString()}</td></tr>\`
  ).join('') : '<tr><td colspan="5"><div class="empty">No active intents</div></td></tr>';
}

// ──── Dream ────────────────────────────────────────────────────────────
async function refreshDream() {
  const hive = state.hive || await api('/api/v6/hive-status');
  const s = hive?.modules.dream ?? {};
  document.getElementById('dream-stats').innerHTML = \`<div class="row"><span class="k">Total</span><span class="v">\${s.totalDreams ?? 0}</span></div><div class="row"><span class="k">Actionable</span><span class="v good">\${s.actionableCount ?? 0}</span></div><div class="row"><span class="k">Acknowledged</span><span class="v">\${s.acknowledgedCount ?? 0}</span></div><div class="row"><span class="k">Avg confidence</span><span class="v">\${((s.avgConfidence ?? 0) * 100).toFixed(0)}%</span></div>\`;
  if (s.byType) drawDreamChart(s.byType);
  const dreams = await api('/api/v6/dream-list') ?? [];
  document.getElementById('dream-list').innerHTML = dreams.length ? dreams.map(d =>
    \`<tr><td><span class="pill purple">\${d.type}</span></td><td>\${(d.content||'').slice(0,160)}</td><td>\${((d.confidence||0)*100).toFixed(0)}%</td><td>\${d.actOnNextSession ? '<span class="pill green">yes</span>' : '—'}</td><td><button class="btn sm" onclick="ackDream('\${d.id}')">Ack</button></td></tr>\`
  ).join('') : '<tr><td colspan="5"><div class="empty">No dreams yet. Run a cycle.</div></td></tr>';
}
async function runDream() { const d = await api('/api/v6/dream-run', {}); if (d) { toast('Dreams generated', (d.length || 0) + ' new'); refreshDream(); } }
async function startDreamLoop() { await api('/api/v6/dream-start', {}); toast('Dream loop', 'Background reflection active'); }
async function ackDream(id) { await api('/api/v6/dream-ack', { id }); refreshDream(); }

// ──── Reputation ───────────────────────────────────────────────────────
async function refreshReputation() {
  const hive = state.hive || await api('/api/v6/hive-status');
  const s = hive?.modules.reputation ?? {};
  document.getElementById('reputation-stats').innerHTML = \`<div class="row"><span class="k">Total agents</span><span class="v">\${s.totalAgents ?? 0}</span></div><div class="row"><span class="k">Total receipts</span><span class="v">\${s.totalReceipts ?? 0}</span></div><div class="row"><span class="k">Verified</span><span class="v good">\${s.verifiedReceipts ?? 0}</span></div><div class="row"><span class="k">Avg accuracy</span><span class="v">\${((s.averageAccuracy ?? 0) * 100).toFixed(1)}%</span></div>\`;
  const top = s.topAgents ?? [];
  document.getElementById('rep-leaderboard').innerHTML = top.length ? top.map(a =>
    \`<tr><td><span class="pill cyan">\${a.agentTool}</span></td><td>\${((a.accuracy ?? 0) * 100).toFixed(1)}%</td><td>\${a.decisions}</td><td class="mono">—</td></tr>\`
  ).join('') : '<tr><td colspan="4"><div class="empty">No signed decisions yet</div></td></tr>';
}
async function genBadge() {
  const res = await api('/api/v6/reputation-badge', { agentTool: document.getElementById('rep-agent').value, agentVersion: document.getElementById('rep-ver').value || undefined });
  document.getElementById('rep-badge-output').textContent = res?.badge || 'No reputation data yet. Sign a decision first via CLI: shadow-brain reputation sign --agent ... --ver ...';
}

// ──── Debate ───────────────────────────────────────────────────────────
async function runDebate() {
  const res = await api('/api/v6/debate-run', {
    question: document.getElementById('debate-question').value,
    context: document.getElementById('debate-context').value,
    turns: parseInt(document.getElementById('debate-turns').value || '2'),
  });
  if (res) {
    document.getElementById('debate-output').textContent = res.turns.map(t => '[' + t.position + '] ' + t.statement).join('\\n\\n') + '\\n\\nVERDICT: ' + res.verdict;
    toast('Debate complete', res.durationMs + 'ms');
  }
}

// ──── Pre-mortem ───────────────────────────────────────────────────────
async function runPremortem() {
  const res = await api('/api/v6/premortem-run', { taskDescription: document.getElementById('pm-task').value, projectDir: '' });
  if (!res) return;
  document.getElementById('pm-output').innerHTML = \`
    <div style="margin-bottom:10px">Risk: <strong style="font-size:16px;color:\${res.riskScore > 0.6 ? 'var(--danger)' : res.riskScore > 0.3 ? 'var(--warning)' : 'var(--success)'}">\${Math.round(res.riskScore * 100)}%</strong></div>
    <div class="mono mb-lg">\${res.summary}</div>
    \${res.failures.map(f => \`<div style="padding:12px;background:var(--bg-elev-2);border-left:3px solid var(--danger);margin-bottom:8px;border-radius:6px"><div style="display:flex;gap:6px;align-items:center;margin-bottom:4px"><span class="pill red">\${f.severity}</span><span class="pill">p=\${f.probability.toFixed(2)}</span><span class="pill">\${f.source}</span></div><div>\${f.description}</div><div class="mono" style="color:var(--text-2);margin-top:6px">→ \${f.mitigation}</div></div>\`).join('')}\`;
}

// ──── Attention ────────────────────────────────────────────────────────
async function runAttention() {
  const ids = document.getElementById('att-memories').value.split(',').map(s => s.trim()).filter(Boolean);
  const res = await api('/api/v6/attention-heatmap', { decisionText: document.getElementById('att-decision').value, candidateMemoryIds: ids });
  if (res) document.getElementById('att-output').textContent = res.weights.map(w => (w.weight * 100).toFixed(1).padStart(5) + '% ' + '█'.repeat(Math.min(30, Math.round(w.weight * 50))) + ' [' + w.category + '] ' + (w.memoryContent || '').slice(0, 80)).join('\\n');
}

// ──── Tokens ───────────────────────────────────────────────────────────
async function refreshTokens() {
  const res = await api('/api/v6/tokens-report');
  if (!res) return;
  document.getElementById('tok-total').textContent = '$' + (res.totalSpendUsd || 0).toFixed(4);
  document.getElementById('tok-proj').textContent = '$' + (res.monthlyProjectionUsd || 0).toFixed(2);
  document.getElementById('tok-save').textContent = '$' + (res.savingsOpportunitiesUsd || 0).toFixed(2);
  const calls = Object.values(res.byAgent || {}).reduce((a, b) => a + b.calls, 0);
  document.getElementById('tok-calls').textContent = calls;
  document.getElementById('tok-calls-sub').textContent = \`\${(res.totalInputTokens || 0).toLocaleString()} in · \${(res.totalOutputTokens || 0).toLocaleString()} out\`;
  if (res.byModel) drawTokensModelChart(res.byModel);
  document.getElementById('tok-suggestions').innerHTML = (res.suggestions || []).map(s => \`<div style="padding:8px 0;border-bottom:1px solid var(--border);display:flex;gap:8px"><span style="color:var(--success);flex-shrink:0">💡</span><span style="font-size:12px">\${s}</span></div>\`).join('') || '<div class="empty">Running lean — no suggestions</div>';
}

// ──── Forget ───────────────────────────────────────────────────────────
async function refreshForget() {
  drawForgetChart([]);
}
async function runForget() {
  const r = await api('/api/v6/forget-consolidate', {});
  if (!r) return;
  document.getElementById('forget-output').innerHTML = \`
    <div class="row"><span class="k">Cycle</span><span class="v">\${r.cycle}</span></div>
    <div class="row"><span class="k">Promoted</span><span class="v good">\${r.promoted}</span></div>
    <div class="row"><span class="k">Demoted</span><span class="v">\${r.demoted}</span></div>
    <div class="row"><span class="k">Forgotten</span><span class="v bad">\${r.forgotten}</span></div>
    <div class="row"><span class="k">Strengthened</span><span class="v good">\${r.strengthened}</span></div>
    <div class="row"><span class="k">Duration</span><span class="v">\${r.durationMs}ms</span></div>\`;
  toast('Consolidation cycle', 'cycle #' + r.cycle);
}

// ──── Formal ───────────────────────────────────────────────────────────
async function genFormal() {
  const res = await api('/api/v6/formal-generate', { text: document.getElementById('formal-text').value });
  if (res) { document.getElementById('formal-output').textContent = JSON.stringify(res, null, 2); toast('Rule generated'); }
}
async function exportEslint() {
  const res = await fetch('/api/v6/formal-export-eslint').then(r => r.text());
  document.getElementById('formal-export').textContent = res;
}
async function exportSemgrep() {
  const res = await fetch('/api/v6/formal-export-semgrep').then(r => r.text());
  document.getElementById('formal-export').textContent = res;
}

// ──── Calibration ──────────────────────────────────────────────────────
async function refreshCalibration() {
  const scores = await api('/api/v6/calibration-scores') ?? [];
  document.getElementById('calibration-table').innerHTML = scores.length ? scores.map(s =>
    \`<tr><td><span class="pill cyan">\${s.agentTool}</span></td><td>\${s.category}</td><td>\${s.brierScore}</td><td>\${s.calibrationError}</td><td>\${(s.overconfidenceRatio * 100).toFixed(0)}%</td><td class="v \${s.trustWeight > 0.8 ? 'good' : s.trustWeight > 0.5 ? '' : 'warn'}">\${s.trustWeight}</td><td>\${s.sampleSize}</td></tr>\`
  ).join('') : '<tr><td colspan="7"><div class="empty">No calibration data yet</div></td></tr>';
}

// ──── Branch ───────────────────────────────────────────────────────────
async function refreshBranch() {
  const r = await api('/api/v6/branch-state');
  if (!r) return;
  document.getElementById('branch-state').innerHTML = \`
    <div class="row"><span class="k">Current branch</span><span class="v"><code>\${r.currentBranch}</code></span></div>
    <div class="row"><span class="k">Branch memories</span><span class="v">\${r.branchMemoryCount}</span></div>
    <div class="row"><span class="k">Global memories</span><span class="v">\${r.globalMemoryCount}</span></div>
    <div class="row"><span class="k">Active IDs</span><span class="v">\${r.activeMemoryIds.length}</span></div>
    <div class="row"><span class="k">Categories</span><span class="v mono">\${r.branchSpecificCategories.join(', ') || '—'}</span></div>\`;
}

// ──── Privacy ──────────────────────────────────────────────────────────
async function refreshPrivacy() {
  const hive = state.hive || await api('/api/v6/hive-status');
  const a = hive?.modules.airGap ?? {};
  document.getElementById('airgap-state').innerHTML = \`
    <div class="row"><span class="k">Enabled</span><span class="v \${a.enabled ? 'good' : ''}">\${a.enabled ? 'YES' : 'no'}</span></div>
    <div class="row"><span class="k">Policy</span><span class="v">\${a.policy || '—'}</span></div>
    <div class="row"><span class="k">Blocked outbound</span><span class="v bad">\${a.blockedOutboundCount ?? 0}</span></div>
    <div class="row"><span class="k">Allowed local</span><span class="v good">\${a.allowedLocalCount ?? 0}</span></div>\`;
  const qlist = await api('/api/v6/quarantine-list?pendingOnly=true') ?? [];
  document.getElementById('quarantine-state').innerHTML = \`<div class="row"><span class="k">Pending</span><span class="v">\${qlist.length}</span></div><div class="row"><span class="k">Auto-delete after</span><span class="v">7 days</span></div>\`;
  document.getElementById('quarantine-list').innerHTML = qlist.length ? qlist.map(e =>
    \`<tr><td><code>\${e.id.slice(0,10)}</code></td><td><span class="pill">\${e.source}</span></td><td>\${(e.claim||'').slice(0,100)}</td><td class="mono">\${e.reasonFlagged}</td><td style="text-align:right"><button class="btn sm success">Promote</button> <button class="btn sm danger">Reject</button></td></tr>\`
  ).join('') : '<tr><td colspan="5"><div class="empty">No quarantined claims</div></td></tr>';
}
async function enableAirGap() { await api('/api/v6/airgap-enable', { policy: 'strict' }); toast('Air-gap enabled','strict mode'); refresh(); refreshPrivacy(); }
async function disableAirGap() { await api('/api/v6/airgap-disable', {}); toast('Air-gap disabled','', 'warn'); refresh(); refreshPrivacy(); }
async function toggleAirGap() { const hive = state.hive || await api('/api/v6/hive-status'); if (hive?.modules.airGap?.enabled) disableAirGap(); else enableAirGap(); }

// ──── Voice ────────────────────────────────────────────────────────────
async function sendVoice() {
  const r = await api('/api/v6/voice-process', { transcript: document.getElementById('voice-input').value });
  if (r) document.getElementById('voice-output').textContent = \`Intent: \${r.intent}\\n\\n\${r.response}\`;
}

// ──── Garden ───────────────────────────────────────────────────────────
async function refreshGarden() {
  const snap = await api('/api/v6/garden-snapshot?limit=200') ?? [];
  const stats = await api('/api/v6/garden-stats') ?? { nodes: 0, avgBloom: 0, linkedFraction: 0 };
  document.getElementById('garden-stats').textContent = \`Nodes: \${stats.nodes} · avg bloom: \${stats.avgBloom} · linked: \${Math.round((stats.linkedFraction||0) * 100)}%\`;
  drawGarden(snap);
}
function drawGarden(nodes) {
  const c = document.getElementById('garden-canvas');
  if (!c) return;
  const ctx = c.getContext('2d'); const W = c.width, H = c.height;
  ctx.clearRect(0, 0, W, H);
  if (!nodes.length) { ctx.fillStyle = '#556080'; ctx.font = '14px "JetBrains Mono", monospace'; ctx.textAlign = 'center'; ctx.fillText('No garden yet. Let the brain grow.', W/2, H/2); return; }
  const pos = nodes.map((n, i) => {
    const a = i / nodes.length * Math.PI * 2;
    const r = 110 + (1 - n.bloom) * 170 + Math.sin(i * 1.3) * 30;
    return { x: W/2 + Math.cos(a) * r, y: H/2 + Math.sin(a) * r * 0.75, node: n };
  });
  ctx.strokeStyle = 'rgba(24,255,255,0.1)'; ctx.lineWidth = 1;
  for (const p of pos) for (const c of p.node.connections) { const t = pos.find(x => x.node.id === c); if (t) { ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(t.x, t.y); ctx.stroke(); } }
  for (const p of pos) {
    const col = p.node.kind === 'decision' ? '#a855f7' : p.node.kind === 'pattern' ? '#18ffff' : '#10e68c';
    const rad = 4 + p.node.bloom * 9;
    const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad * 2.5);
    grd.addColorStop(0, col + 'cc'); grd.addColorStop(1, col + '00');
    ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(p.x, p.y, rad * 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = col; ctx.globalAlpha = Math.max(0.4, p.node.bloom);
    ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
}

// ──── PR Review ────────────────────────────────────────────────────────
async function genPRReview() {
  const r = await api('/api/v6/pr-review-generate', {
    repo: document.getElementById('pr-repo').value,
    prNumber: parseInt(document.getElementById('pr-num').value || '0'),
    changedFiles: document.getElementById('pr-files').value.split(',').map(s => s.trim()).filter(Boolean),
    diffSummary: document.getElementById('pr-diff').value,
  });
  if (r) { document.getElementById('pr-output').textContent = r.body; toast('Review generated'); }
}

// ──── Team ─────────────────────────────────────────────────────────────
async function refreshTeam() {
  const self = await api('/api/v6/team-self') ?? {};
  const peers = await api('/api/v6/team-peers') ?? [];
  document.getElementById('team-self').innerHTML = \`<div class="row"><span class="k">Peer ID</span><span class="v mono">\${self.peerId || '—'}</span></div><div class="row"><span class="k">Display name</span><span class="v">\${self.displayName || '—'}</span></div>\`;
  document.getElementById('team-peers').innerHTML = peers.length ? peers.map(p => \`<div class="row"><span class="k">\${p.displayName}</span><span class="v mono">\${p.peerId}</span></div>\`).join('') : '<div class="empty">No peers connected. Connect via WebRTC.</div>';
}

// ──── Exchange ─────────────────────────────────────────────────────────
async function refreshExchange() {
  const packages = await api('/api/v6/exchange-list') ?? [];
  document.getElementById('ex-list').innerHTML = packages.length ? packages.map(p => \`<div class="row"><span class="k"><code>\${p.name}</code><br/><span style="font-size:10px;color:var(--text-3)">by \${p.author}</span></span><span class="v">\${p.memoryCount} memories</span></div>\`).join('') : '<div class="empty">No local packages yet</div>';
}
async function exportPackage() {
  const res = await api('/api/v6/exchange-export', {
    name: document.getElementById('ex-name').value || 'untitled',
    description: document.getElementById('ex-desc').value,
    author: document.getElementById('ex-author').value,
    tags: document.getElementById('ex-tags').value.split(',').map(s => s.trim()).filter(Boolean),
  });
  if (res) { document.getElementById('ex-out').textContent = 'Saved → ' + res.filePath; toast('Package exported'); refreshExchange(); }
}

// ──── Features ─────────────────────────────────────────────────────────
async function refreshFeatures() {
  const cfg = (await api('/api/v6/features-config')) ?? {};
  document.getElementById('feature-grid').innerHTML = FEATURES.map(([id, name, desc]) => {
    const on = cfg[id] !== false; // default enabled
    return \`<div class="feature-toggle" id="ft-\${id}">
      <div class="icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></div>
      <div class="meta"><div class="name">\${name}</div><div class="desc">\${desc}</div></div>
      <label class="switch"><input type="checkbox" \${on ? 'checked' : ''} data-feature="\${id}"><span class="slider"></span></label>
    </div>\`;
  }).join('');
  // Bind listeners cleanly so the toggle always fires
  document.querySelectorAll('#feature-grid input[data-feature]').forEach(el => {
    el.addEventListener('change', async e => {
      const id = e.target.getAttribute('data-feature');
      const on = e.target.checked;
      const res = await api('/api/v6/features-config', { [id]: on });
      toast(on ? 'Enabled' : 'Disabled', id, on ? 'success' : 'warn');
      if (!res) { e.target.checked = !on; /* revert on error */ }
    });
  });
}
async function toggleFeature(id, on) {
  const res = await api('/api/v6/features-config', { [id]: on });
  if (res) toast(on ? 'Enabled' : 'Disabled', id, on ? 'success' : 'warn');
}

// ──── Models & Intelligence ────────────────────────────────────────────
let _providers = [];
let _allModels = {};
async function refreshModels() {
  const data = await api('/api/v6/providers');
  if (!data) return;
  _providers = data.providers ?? [];

  // Discovered agents section
  document.getElementById('discovered-agents').innerHTML = data.discovered.length
    ? data.discovered.map(d => \`<div class="row"><span class="k"><span class="pill purple">\${d.agent}</span> → <span class="pill cyan">\${d.provider}</span> <span class="tag-code">\${d.model || '(none)'}</span></span><span class="v mono" style="color:var(--text-3)" title="\${d.sourcePath}">\${d.apiKey ? '🔑 API key available' : 'no API key found'}</span></div>\`).join('')
    : '<div class="empty">No agent configs found yet. Install Claude Code / Cursor / Cline / Codex / Aider / Kilo / Roo / OpenCode, or add a custom path below.</div>';

  // Provider cards
  document.getElementById('providers-grid').innerHTML = _providers.map(p => {
    const okClass = p.apiKey ? 'good' : p.id === 'ollama' ? '' : 'warn';
    return \`<div class="card" style="padding:14px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px"><div style="font-weight:700;font-size:13px">\${p.displayName}</div><span class="pill \${p.enabled ? 'green' : ''}">\${p.enabled ? 'enabled' : 'off'}</span></div>
      <div class="field" style="margin-bottom:6px"><label>API Key \${p.source === 'agent-discovered' ? '(from ' + (p.discoveredFrom || 'agent') + ')' : p.source === 'env' ? '(env)' : ''}</label><input type="password" id="pkey-\${p.id}" placeholder="\${p.apiKey ? '••••••••••' : 'sk-...'}" value="\${p.apiKey || ''}"/></div>
      <div class="field" style="margin-bottom:6px"><label>Default Model</label><input id="pmodel-\${p.id}" value="\${p.defaultModel || ''}"/></div>
      <div class="flex gap">
        <button class="btn sm primary" onclick="saveProvider('\${p.id}')">Save</button>
        <button class="btn sm" onclick="testProvider('\${p.id}')">Test</button>
        <button class="btn sm" onclick="fetchProviderModels('\${p.id}')">Fetch Models</button>
      </div>
      <div class="mono mt" id="pmodels-\${p.id}" style="max-height:120px;overflow-y:auto;font-size:10.5px;color:var(--text-3)"></div>
    </div>\`;
  }).join('');

  // Intelligence config
  const intel = await api('/api/v6/intelligence');
  if (intel) {
    const provSel = document.getElementById('intel-provider');
    provSel.innerHTML = _providers.map(p => \`<option value="\${p.id}" \${intel.leadProvider === p.id ? 'selected' : ''}>\${p.displayName}</option>\`).join('');
    // Populate model field
    const modelInput = document.getElementById('intel-model');
    modelInput.innerHTML = \`<option value="\${intel.leadModel}">\${intel.leadModel}</option>\`;
    document.getElementById('intel-agent-proxy').checked = intel.useAgentToolModels;
    document.getElementById('intel-local-first').checked = intel.preferLocalFirst;
  }

  // Custom agents
  const ca = await api('/api/v6/custom-agents');
  const agents = ca?.agents ?? [];
  document.getElementById('custom-agents-list').innerHTML = agents.length
    ? agents.map((a, i) => \`<div class="row"><span class="k"><span class="pill purple">\${a.name}</span> <span class="tag-code">\${a.path}</span></span><span class="v"><button class="btn sm danger" onclick="removeCustomAgent(\${i})">Remove</button></span></div>\`).join('')
    : '<div class="empty">No custom agent paths yet</div>';
}
async function saveProvider(id) {
  const apiKey = document.getElementById('pkey-' + id).value;
  const defaultModel = document.getElementById('pmodel-' + id).value;
  const r = await api('/api/v6/provider-save', { provider: id, apiKey: apiKey || undefined, defaultModel, enabled: true });
  if (r) { toast('Saved', id); refreshModels(); }
}
async function testProvider(id) {
  const r = await api('/api/v6/provider-test', { provider: id });
  toast(r?.ok ? 'Connected' : 'Failed', r?.ok ? (r.modelCount + ' models available') : (r?.error || 'Unknown error'), r?.ok ? 'success' : 'error');
}
async function fetchProviderModels(id) {
  const models = await api('/api/v6/provider-models', { provider: id });
  if (!models) return;
  _allModels[id] = models;
  document.getElementById('pmodels-' + id).innerHTML = models.length
    ? models.slice(0, 50).map(m => \`<div style="padding:3px 0"><span class="tag-code">\${m.id}</span>\${m.tags.length ? ' <span style="color:var(--text-dim)">' + m.tags.join(' · ') + '</span>' : ''}</div>\`).join('')
    : '<div>No models (check API key + network)</div>';
  toast('Fetched', models.length + ' models from ' + id);
}
async function saveIntelligence() {
  const provId = document.getElementById('intel-provider').value;
  const model = document.getElementById('intel-model').value;
  const useAgent = document.getElementById('intel-agent-proxy').checked;
  const local = document.getElementById('intel-local-first').checked;
  const r = await api('/api/v6/intelligence', {
    leadProvider: provId, leadModel: model,
    useAgentToolModels: useAgent, preferLocalFirst: local,
  });
  document.getElementById('intel-result').textContent = r ? '✓ Intelligence config saved · lead: ' + provId + ' / ' + model : '✗ Save failed';
  if (r) toast('Intelligence updated');
}
async function addCustomAgent() {
  const name = document.getElementById('ca-name').value.trim();
  const p = document.getElementById('ca-path').value.trim();
  if (!name || !p) return toast('Missing', 'Name + path required', 'warn');
  const cur = await api('/api/v6/custom-agents');
  const agents = [...(cur?.agents || []), { name, path: p }];
  await api('/api/v6/custom-agents', { agents });
  document.getElementById('ca-name').value = ''; document.getElementById('ca-path').value = '';
  toast('Added', name); refreshModels();
}
async function removeCustomAgent(i) {
  const cur = await api('/api/v6/custom-agents');
  const agents = (cur?.agents || []).filter((_, idx) => idx !== i);
  await api('/api/v6/custom-agents', { agents });
  toast('Removed', '', 'warn'); refreshModels();
}

// ──── Chat with Brain ──────────────────────────────────────────────────
let currentConversationId = null;
async function refreshChat() {
  const list = await api('/api/v6/chat-conversations');
  const el = document.getElementById('chat-conversations');
  el.innerHTML = (list || []).map(c => \`<div class="row" onclick="loadConv('\${c.id}')" style="cursor:pointer"><span class="k" style="min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">\${c.preview || '(new)'}</span><span class="v mono" style="font-size:10px">\${c.turnCount}</span></div>\`).join('') || '<div class="empty">No chats yet</div>';
  if (!currentConversationId) renderChatMessages([]);
}
async function loadConv(id) { currentConversationId = id; const turns = await api('/api/v6/chat-conversation', { conversationId: id }) ?? []; renderChatMessages(turns); }
function newChat() { currentConversationId = null; renderChatMessages([]); document.getElementById('chat-input').focus(); }
async function clearAllChats() { if (!confirm('Clear ALL chat history?')) return; await api('/api/v6/chat-clear-all', {}); currentConversationId = null; refreshChat(); renderChatMessages([]); toast('Chat history cleared','','warn'); }
function renderChatMessages(turns) {
  const el = document.getElementById('chat-messages');
  if (!turns.length) { el.innerHTML = '<div class="empty"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>Ask your brain anything.<br/>It will search memories + cite them.</div>'; return; }
  el.innerHTML = turns.map(t => {
    const isUser = t.role === 'user';
    const cites = (t.citations || []).length ? \`<div style="margin-top:8px;padding:8px;background:var(--bg-elev-1);border-radius:6px"><div style="font-size:10px;color:var(--text-3);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.04em">Citations (\${t.citations.length})</div>\${t.citations.map((c, i) => \`<div style="padding:4px 0;border-bottom:1px solid var(--border);font-size:11px"><span class="pill cyan">[\${i+1}]</span> <span class="pill">\${c.agent}/\${c.category}</span> \${c.content.slice(0, 180)} <span style="color:var(--text-dim)">(\${(c.score*100).toFixed(0)}%)</span></div>\`).join('')}</div>\` : '';
    const meta = !isUser && t.provider ? \`<div class="mono" style="font-size:10px;color:var(--text-3);margin-top:6px">\${t.provider}/\${t.model || ''} · \${t.tokensUsed || 0} tok\${t.cached ? ' · cached' : ''}</div>\` : '';
    return \`<div style="display:flex;gap:10px;margin-bottom:14px;\${isUser ? '' : 'background:var(--bg-elev-1);padding:12px;border-radius:10px'}"><div style="width:28px;height:28px;border-radius:50%;background:\${isUser ? 'var(--brand-gradient)' : 'var(--bg-elev-3)'};display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:11px;font-weight:700">\${isUser ? 'You' : '🧠'}</div><div style="flex:1;min-width:0"><div style="white-space:pre-wrap;font-size:13px;line-height:1.5">\${(t.content || '').replace(/\\</g, '&lt;')}</div>\${cites}\${meta}</div></div>\`;
  }).join('');
  el.scrollTop = el.scrollHeight;
}
async function sendChat() {
  const input = document.getElementById('chat-input');
  const question = input.value.trim();
  if (!question) return;
  input.value = '';
  const btn = document.getElementById('chat-send-btn');
  btn.disabled = true;
  document.getElementById('chat-status').textContent = 'Searching memories + calling LLM...';
  const turns = currentConversationId ? (await api('/api/v6/chat-conversation', { conversationId: currentConversationId }) ?? []) : [];
  turns.push({ role: 'user', content: question, createdAt: new Date() });
  renderChatMessages(turns);
  try {
    const res = await api('/api/v6/chat', { question, conversationId: currentConversationId, maxCitations: 6 });
    if (res) {
      currentConversationId = res.conversationId;
      const updated = await api('/api/v6/chat-conversation', { conversationId: currentConversationId }) ?? [];
      renderChatMessages(updated);
      refreshChat();
      document.getElementById('chat-status').textContent = 'Answered in ' + (res.ms || '?') + 'ms · ' + (res.citations?.length || 0) + ' citations';
    }
  } finally {
    btn.disabled = false;
  }
}

// ──── Stop button ──────────────────────────────────────────────────────
async function stopBrain() {
  if (!confirm('Stop Shadow Brain?\\n\\nThe npm process will exit. You will need to restart it from your terminal.')) return;
  try {
    await fetch('/api/v6/shutdown', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  } catch { /* server is shutting down */ }
  toast('Shutting down', 'Shadow Brain is stopping...', 'warn');
  setTimeout(() => { document.body.style.filter = 'grayscale(1) brightness(0.4)'; document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:#888;font-family:ui-monospace,monospace;font-size:16px;flex-direction:column;gap:16px"><div>⏻ Shadow Brain stopped</div><div style="font-size:12px">Restart with: <code style="background:#222;padding:4px 8px;border-radius:4px">npm run dev</code> or <code style="background:#222;padding:4px 8px;border-radius:4px">shadow-brain dash .</code></div></div>'; }, 1500);
}

// When the intel provider changes, re-fetch its models to populate the model dropdown
document.addEventListener('change', async e => {
  if (e.target && e.target.id === 'intel-provider') {
    const id = e.target.value;
    const models = _allModels[id] || await api('/api/v6/provider-models', { provider: id });
    _allModels[id] = models || [];
    const sel = document.getElementById('intel-model');
    if (sel) sel.innerHTML = (models || []).map(m => \`<option value="\${m.id}">\${m.displayName}</option>\`).join('') || '<option>no models available</option>';
  }
});

// ──── Config ───────────────────────────────────────────────────────────
async function refreshConfig() {
  const hive = state.hive || await api('/api/v6/hive-status');
  if (!hive) return;
  document.getElementById('config-state').innerHTML = \`
    <div class="row"><span class="k">Version</span><span class="v">\${hive.version}</span></div>
    <div class="row"><span class="k">Local-first</span><span class="v \${hive.localFirst ? 'good' : 'warn'}">\${hive.localFirst ? 'YES' : 'no'}</span></div>
    <div class="row"><span class="k">Agents connected</span><span class="v">\${hive.totalAgentsConnected}</span></div>
    <div class="row"><span class="k">Memories stored</span><span class="v">\${hive.totalMemoriesStored}</span></div>
    <div class="row"><span class="k">Modules active</span><span class="v good">\${Object.keys(hive.modules || {}).length}</span></div>\`;
}
async function saveConfig() { const r = await api('/api/v6/config-save', { provider: document.getElementById('cfg-provider').value, apiKey: document.getElementById('cfg-apikey').value || undefined, model: document.getElementById('cfg-model').value || undefined }); document.getElementById('cfg-result').textContent = r?.ok ? '✓ Saved' : '✗ Failed'; if (r?.ok) toast('Config saved'); }
async function testConnection() { const r = await api('/api/v6/config-test', { provider: document.getElementById('cfg-provider').value }); document.getElementById('cfg-result').textContent = r?.ok ? '✓ Connected' : '✗ ' + (r?.error || 'Failed'); toast(r?.ok ? 'Connection OK' : 'Connection failed', r?.error || '', r?.ok ? 'success' : 'error'); }
async function startMCP() { const r = await api('/api/v6/mcp-start', { port: parseInt(document.getElementById('mcp-port').value || '7342'), authToken: document.getElementById('mcp-token').value || undefined }); document.getElementById('mcp-result').textContent = r?.ok ? '✓ Started at :' + (r.port ?? 7342) : '✗ ' + (r?.error || 'Failed'); toast(r?.ok ? 'MCP started' : 'MCP failed', r?.error, r?.ok ? 'success' : 'error'); }
async function stopMCP() { const r = await api('/api/v6/mcp-stop', {}); document.getElementById('mcp-result').textContent = r?.ok ? '✓ Stopped' : '✗ ' + (r?.error || 'Failed'); toast('MCP stopped', '', 'warn'); }

// ──── Agents ───────────────────────────────────────────────────────────
async function refreshAgents() {
  const list = await api('/api/v6/agents-list', {}) ?? [];
  document.getElementById('badge-agents').textContent = list.filter(a => a.hookInstalled).length;
  document.getElementById('agents-table').innerHTML = list.map(a => \`
    <tr>
      <td><strong>\${a.displayName}</strong><br/><code style="color:var(--text-3);font-size:10px">\${a.name}</code></td>
      <td>\${a.detected ? '<span class="pill green">detected</span>' : '<span class="pill">not found</span>'}</td>
      <td>\${a.hookInstalled ? '<span class="pill cyan">active</span>' : '<span class="pill">not wired</span>'}</td>
      <td class="mono">\${a.hookPath ? a.hookPath.slice(0, 70) : '—'}</td>
      <td style="text-align:right">\${a.hookInstalled ? \`<button class="btn sm danger" onclick="detachOne('\${a.name}')">Disconnect</button>\` : \`<button class="btn sm success" onclick="attachOne('\${a.name}')">Connect</button>\`}</td>
    </tr>\`).join('') || '<tr><td colspan="5"><div class="empty">No agents detected</div></td></tr>';
}
async function attachOne(agent) { await api('/api/v6/agents-attach', { agent }); toast('Attached', agent); refreshAgents(); }
async function detachOne(agent) { await api('/api/v6/agents-detach', { agent }); toast('Detached', agent, 'warn'); refreshAgents(); }
async function attachAll() { const r = await api('/api/v6/agents-attach-all', {}); if (r) { toast('Attach All', (r.attached?.length ?? 0) + ' agents wired'); refreshAgents(); } }
async function detachAll() { if (!confirm('Detach Shadow Brain hooks from ALL agents?')) return; const r = await api('/api/v6/agents-detach-all', {}); if (r) { toast('Detach All', (r.attached?.length ?? 0) + ' agents', 'warn'); refreshAgents(); } }

// ──── Memory browser ───────────────────────────────────────────────────
async function searchMemory() {
  const r = await api('/api/v6/memory-browser', {
    query: document.getElementById('mem-query').value,
    agent: document.getElementById('mem-agent').value,
    category: document.getElementById('mem-category').value,
    minImportance: parseFloat(document.getElementById('mem-importance').value || '0'),
  });
  if (!r) return;
  document.getElementById('mem-results').innerHTML = r.length ? r.map(m =>
    \`<tr><td><code>\${m.id.slice(0, 10)}</code></td><td><span class="pill cyan">\${m.agentTool}</span></td><td>\${m.category}</td><td>\${(m.content || '').slice(0, 140)}</td><td>\${(m.importance || 0).toFixed(2)}</td><td class="mono">\${new Date(m.createdAt).toLocaleDateString()}</td></tr>\`
  ).join('') : '<tr><td colspan="6"><div class="empty">No memories match your filters</div></td></tr>';
}

// ──── Activity ─────────────────────────────────────────────────────────
async function refreshActivity() {
  const filter = document.getElementById('act-filter').value;
  const log = await api('/api/v6/activity-log?limit=200') ?? [];
  const filtered = filter ? log.filter(e => e.type === filter) : log;
  document.getElementById('activity-table').innerHTML = filtered.length ? filtered.map(e => \`<tr><td class="mono">\${new Date(e.timestamp).toLocaleString()}</td><td><span class="pill purple">\${e.source}</span></td><td><span class="pill \${typeToPill(e.type)}">\${e.type}</span></td><td class="mono">\${(e.detail || '').slice(0, 200)}</td></tr>\`).join('') : '<tr><td colspan="4"><div class="empty">No activity</div></td></tr>';
}
document.getElementById('act-filter').addEventListener('change', refreshActivity);

// ──── Live Graph ───────────────────────────────────────────────────────
let graphFrame = 0, graphNodes = [], graphEdges = [], graphSignals = [], graphTimer = null, graphPullTimer = null;
const signalColors = { 'memory-write':'#10e68c','subagent-spawn':'#18ffff','dream':'#a855f7','revisit':'#a855f7','counterfactual':'#a855f7','consolidation':'#a855f7','contradiction':'#ff5864','pattern-discovery':'#10e68c','collision':'#ff5864','quarantine':'#ec4899','firewall-block':'#ffb53f' };
async function startGraph() { await pullTopology(); if (graphTimer) cancelAnimationFrame(graphTimer); graphLoop(); if (graphPullTimer) clearInterval(graphPullTimer); graphPullTimer = setInterval(pullTopology, 3000); }
async function pullTopology() {
  const topo = await api('/api/v6/topology', {});
  if (!topo) return;
  const canvas = document.getElementById('graph-canvas');
  if (!canvas) return;
  const W = canvas.width, H = canvas.height, cx = W/2, cy = H/2;
  const prev = new Map(graphNodes.map(n => [n.id, { x: n.x, y: n.y }]));
  graphNodes = [{ id:'brain', label:'HIVE MIND', x: cx, y: cy, r: 50, type:'brain', color:'#a855f7' }];
  (topo.agents || []).forEach((a, i, arr) => {
    const ang = (i / arr.length) * Math.PI * 2 - Math.PI / 2, r = 240;
    const p = prev.get(a.id);
    graphNodes.push({ id: a.id, label: a.displayName, x: p?.x ?? cx + Math.cos(ang) * r, y: p?.y ?? cy + Math.sin(ang) * r, targetX: cx + Math.cos(ang) * r, targetY: cy + Math.sin(ang) * r, r: a.connected ? 24 : 16, type:'agent', connected: a.connected, color: a.connected ? '#18ffff' : '#556080' });
  });
  (topo.subAgents || []).forEach((s, i, arr) => {
    const parent = graphNodes.find(n => n.id === s.parent), ang = (i / Math.max(arr.length,1)) * Math.PI * 2, r = 130;
    const p = prev.get(s.id);
    graphNodes.push({ id: s.id, label: (s.task || '').slice(0, 18), x: p?.x ?? (parent?.x ?? cx) + Math.cos(ang) * 40, y: p?.y ?? (parent?.y ?? cy) + Math.sin(ang) * 40, targetX: cx + Math.cos(ang) * r, targetY: cy + Math.sin(ang) * r, r: 12, type:'subagent', parent: s.parent, color: '#a855f7' });
  });
  graphEdges = [];
  for (const n of graphNodes) {
    if (n.type === 'agent') graphEdges.push({ from:'brain', to: n.id, active: n.connected });
    if (n.type === 'subagent') graphEdges.push({ from: n.parent ?? 'brain', to: n.id, active: true });
  }
  const now = Date.now();
  for (const e of (topo.events || [])) {
    const src = e.source ?? 'brain';
    const srcN = graphNodes.find(n => n.id === src) ?? graphNodes[0];
    const dstN = e.type === 'subagent-spawn' ? graphNodes.find(n => n.id === e.target) : graphNodes.find(n => n.id === 'brain');
    if (!srcN || !dstN) continue;
    graphSignals.push({ fromId: srcN.id, toId: dstN.id, type: e.type, color: signalColors[e.type] || '#18ffff', progress: 0, spawnedAt: now });
  }
  if (graphSignals.length > 100) graphSignals = graphSignals.slice(-100);
  document.getElementById('graph-meta').textContent = \`\${(topo.agents || []).length} agents · \${(topo.subAgents || []).length} sub-agents · \${graphSignals.length} signals\`;
}
function graphLoop() {
  const c = document.getElementById('graph-canvas');
  if (!c) return;
  const ctx = c.getContext('2d'), W = c.width, H = c.height;
  ctx.clearRect(0, 0, W, H);
  const grd = ctx.createRadialGradient(W/2, H/2, 40, W/2, H/2, 500);
  grd.addColorStop(0, 'rgba(168,85,247,0.08)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grd; ctx.fillRect(0, 0, W, H);
  for (const n of graphNodes) if (n.targetX != null) { n.x += (n.targetX - n.x) * 0.08; n.y += (n.targetY - n.y) * 0.08; }
  ctx.lineWidth = 1;
  for (const e of graphEdges) {
    const a = graphNodes.find(n => n.id === e.from), b = graphNodes.find(n => n.id === e.to);
    if (!a || !b) continue;
    ctx.strokeStyle = e.active ? 'rgba(24,255,255,0.3)' : 'rgba(86,96,128,0.15)';
    ctx.setLineDash(e.active ? [] : [4, 4]);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  ctx.setLineDash([]);
  const now = Date.now();
  graphSignals = graphSignals.filter(s => now - s.spawnedAt < 3500);
  for (const s of graphSignals) {
    const from = graphNodes.find(n => n.id === s.fromId), to = graphNodes.find(n => n.id === s.toId);
    if (!from || !to) continue;
    s.progress = Math.min(1, (now - s.spawnedAt) / 2400);
    const t = s.progress, x = from.x + (to.x - from.x) * t, y = from.y + (to.y - from.y) * t;
    const tail = ctx.createRadialGradient(x, y, 0, x, y, 18);
    tail.addColorStop(0, s.color); tail.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = tail; ctx.beginPath(); ctx.arc(x, y, 16, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = s.color;
    ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill();
  }
  for (const n of graphNodes) {
    const pulse = n.type === 'brain' ? Math.sin(graphFrame / 15) * 4 : 0, r = n.r + pulse;
    const halo = ctx.createRadialGradient(n.x, n.y, r * 0.5, n.x, n.y, r * 2.5);
    halo.addColorStop(0, n.color + '66'); halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(n.x, n.y, r * 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = n.type === 'brain' ? '#12152a' : '#0b0f1c';
    ctx.strokeStyle = n.color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = n.color;
    ctx.font = n.type === 'brain' ? 'bold 13px Inter, sans-serif' : '11px Inter, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(n.label, n.x, n.y + (n.type === 'brain' ? 0 : r + 14));
  }
  graphFrame++;
  graphTimer = requestAnimationFrame(graphLoop);
}

// ──── Command Palette ──────────────────────────────────────────────────
const commands = [
  ...FEATURES.map(([id, name]) => ({ type: 'nav', label: name, target: id, hint: 'Go to' })),
  { type: 'nav', label: 'Overview', target: 'overview' },
  { type: 'nav', label: 'Live Graph', target: 'graph' },
  { type: 'nav', label: 'Agents', target: 'agents' },
  { type: 'nav', label: 'Memory Browser', target: 'memory' },
  { type: 'nav', label: 'Activity Log', target: 'activity' },
  { type: 'action', label: 'Run Dream Cycle', fn: 'runDream' },
  { type: 'action', label: 'Run Consolidation', fn: 'runForget' },
  { type: 'action', label: 'Toggle Air-Gap', fn: 'toggleAirGap' },
  { type: 'action', label: 'Toggle Theme', fn: 'toggleTheme' },
  { type: 'action', label: 'Attach All Agents', fn: 'attachAll' },
  { type: 'action', label: 'Refresh All', fn: 'refresh' },
];
let cmdSelected = 0;
function openCmdPalette() {
  document.getElementById('cmd-overlay').classList.add('open');
  const input = document.getElementById('cmd-input');
  input.value = ''; cmdSelected = 0;
  renderCmdResults(commands);
  setTimeout(() => input.focus(), 50);
}
function closeCmdPalette() { document.getElementById('cmd-overlay').classList.remove('open'); }
function renderCmdResults(items) {
  document.getElementById('cmd-results').innerHTML = items.map((c, i) => \`<div class="cmd-result \${i === cmdSelected ? 'selected' : ''}" onclick="runCmd(\${i})" data-idx="\${i}"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">\${c.type === 'nav' ? '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>' : '<circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/>'}</svg><div class="meta">\${c.label}</div><span class="hint">\${c.hint || c.type}</span></div>\`).join('');
}
function runCmd(i) {
  const filtered = filterCmds(document.getElementById('cmd-input').value);
  const c = filtered[i];
  if (!c) return;
  closeCmdPalette();
  if (c.type === 'nav') switchTab(c.target, '');
  else if (c.type === 'action' && typeof window[c.fn] === 'function') window[c.fn]();
}
function filterCmds(q) {
  if (!q) return commands;
  const l = q.toLowerCase();
  return commands.filter(c => c.label.toLowerCase().includes(l));
}
document.getElementById('cmd-input').addEventListener('input', e => { cmdSelected = 0; renderCmdResults(filterCmds(e.target.value)); });
document.getElementById('cmd-input').addEventListener('keydown', e => {
  const filtered = filterCmds(e.target.value);
  if (e.key === 'ArrowDown') { e.preventDefault(); cmdSelected = Math.min(cmdSelected + 1, filtered.length - 1); renderCmdResults(filtered); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); cmdSelected = Math.max(cmdSelected - 1, 0); renderCmdResults(filtered); }
  else if (e.key === 'Enter') { e.preventDefault(); runCmd(cmdSelected); }
  else if (e.key === 'Escape') closeCmdPalette();
});
document.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); openCmdPalette(); } });

// ──── Live log / ticker ────────────────────────────────────────────────
const logEntries = [];
function appendLog(source, type, detail) {
  logEntries.unshift({ t: new Date(), source, type, detail: String(detail || '').slice(0, 320) });
  if (logEntries.length > 200) logEntries.length = 200;
  renderTicker(); renderLogPanel(); morphBrainState(type);
}
function renderTicker() {
  const el = document.getElementById('log-scroll');
  if (!el) return;
  const recent = logEntries.slice(0, 6).map(e => \`\${e.t.toLocaleTimeString()} · \${e.source}/\${e.type} · \${e.detail.slice(0, 60)}\`).join('  ||  ');
  el.textContent = recent || 'Awaiting activity…';
}
function renderLogPanel() {
  const panel = document.getElementById('log-panel-list');
  if (!panel) return;
  panel.innerHTML = logEntries.slice(0, 80).map(e => \`<div class="log-row"><span class="t">\${e.t.toLocaleTimeString()}</span><span class="src">\${e.source}</span><span class="type">\${e.type}</span><span>\${e.detail}</span></div>\`).join('');
}
function toggleLogPanel() { document.getElementById('log-panel').classList.toggle('open'); if (document.getElementById('log-panel').classList.contains('open')) renderLogPanel(); }
function clearLogs() { logEntries.length = 0; renderTicker(); renderLogPanel(); }
const BRAIN_STATES = { 'memory-write':'learning · writing memory','subagent-spawn':'sub-agent dispatched','dream':'dreaming · reflecting','revisit':'revisiting recent','counterfactual':'running counterfactual','consolidation':'consolidating','contradiction':'resolving conflict','quarantine':'isolating suspect','collision':'arbitrating collision','firewall-block':'blocking risky action' };
let stateTimer = null;
function morphBrainState(type) {
  const el = document.getElementById('brain-state');
  el.textContent = BRAIN_STATES[type] || 'learning · reflecting · charging';
  if (stateTimer) clearTimeout(stateTimer);
  stateTimer = setTimeout(() => { el.textContent = 'learning · reflecting · charging'; }, 6000);
}
async function pullRecentActivity() {
  const log = await api('/api/v6/activity-log?limit=40');
  if (!log) return;
  const seen = new Set(logEntries.map(e => e.t.toISOString() + '|' + e.type + '|' + e.detail.slice(0, 40)));
  for (const e of log.reverse()) {
    const key = (e.timestamp || '') + '|' + e.type + '|' + (e.detail || '').slice(0, 40);
    if (!seen.has(key)) appendLog(e.source || 'brain', e.type || 'event', e.detail || '');
  }
}

// ──── WebSocket ────────────────────────────────────────────────────────
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(\`\${proto}://\${location.host}\`);
  ws.onopen = () => { appendLog('ws','connected','dashboard WebSocket online'); toast('Connected', 'live updates enabled', 'success'); };
  ws.onmessage = e => { try { const m = JSON.parse(e.data);
    if (m.type === 'insights' || m.type === 'modules') refresh();
    if (m.type === 'insights' && m.insights) for (const ins of m.insights.slice(0,5)) appendLog(ins.sourceAgent || 'brain','insight',ins.title || ins.content);
    if (m.type === 'injection') appendLog(m.adapter || 'agent','injection', m.insightTitle || 'context injected');
    if (m.type === 'info') appendLog('brain','info', m.message);
    if (m.type === 'error') { appendLog('brain','error', m.error); toast('Brain error', m.error, 'error'); }
    if (m.type === 'agents-detected') appendLog('brain','agents', (m.agents || []).join(', '));
  } catch {} };
  ws.onclose = () => { appendLog('ws','disconnected','reconnecting'); setTimeout(connectWS, 2000); };
}

// ──── Bootstrapping ────────────────────────────────────────────────────
connectWS();
refresh();
pullRecentActivity();
setInterval(refresh, 5000);           // faster heartbeat — real-time feel
setInterval(pullRecentActivity, 3000); // faster log stream
if (window.lucide) try { window.lucide.createIcons(); } catch {}

// Welcome toast
setTimeout(() => toast('Hive Mind v6.0', 'Press ⌘K or Ctrl+K to open the command palette', 'info'), 800);
</script>
</body>
</html>`;
