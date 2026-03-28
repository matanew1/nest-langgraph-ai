# index.html Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign `public/index.html` from a glassmorphism Mac-window UI to a clean full-page app with slide-out sidebar, new color/typography system, and preserved dark mode support.

**Architecture:** CSS-only redesign of a single-file app. The HTML body structure is rebuilt (mac-window → full-page nav + chat column). All JavaScript (~lines 850–1903) is preserved unchanged. The file has three logical sections: CSS (lines 17–706), HTML (708–849), JS (850–1903).

**Tech Stack:** Vanilla HTML/CSS/JS · Inter + JetBrains Mono (Google Fonts) · No build tools

---

## File Map

| File | Action | What changes |
|---|---|---|
| `public/index.html` | Modify | CSS variables, structural CSS, HTML body (lines 1–849). JS untouched. |

---

## Task 1: Update CSS Custom Properties

**Files:**
- Modify: `public/index.html:17-94`

Replace the `:root` and `[data-theme="dark"]` blocks entirely.

- [ ] **Step 1: Replace `:root` token block (lines 17–60)**

Replace from `:root {` through the closing `}` of the light-mode block with:

```css
:root {
  --bg: #f5f6fa;
  --surface: #ffffff;
  --surface-muted: #eef0f5;
  --border: #e4e6ed;
  --border-strong: #d0d3de;
  --text: #1a1a2e;
  --text-secondary: #6b7280;
  --text-tertiary: #9ca3af;
  --accent: #6366f1;
  --accent-hover: #4f46e5;
  --accent-subtle: rgba(99,102,241,0.08);
  --gradient: linear-gradient(135deg, #6366f1, #a855f7);
  --user-bubble: linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a855f7 100%);
  --success: #10b981;
  --success-subtle: rgba(16,185,129,0.10);
  --warning: #f59e0b;
  --warning-subtle: rgba(245,158,11,0.10);
  --error: #ef4444;
  --error-subtle: rgba(239,68,68,0.10);
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.06);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.08);
  --shadow-lg: 0 8px 32px rgba(0,0,0,0.10);
  --shadow-xl: 0 16px 48px rgba(0,0,0,0.12);
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-xl: 18px;
  --radius-full: 9999px;
  --ease: cubic-bezier(0.25, 0.46, 0.45, 0.94);
  --spring: cubic-bezier(0.34, 1.56, 0.64, 1);
}
```

- [ ] **Step 2: Replace `[data-theme="dark"]` block (lines 62–94)**

```css
[data-theme="dark"] {
  --bg: #0d0d18;
  --surface: #13131f;
  --surface-muted: #1c1c2e;
  --border: rgba(255,255,255,0.08);
  --border-strong: rgba(255,255,255,0.14);
  --text: #eeeef8;
  --text-secondary: #c8c8e0;
  --text-tertiary: #4a4a68;
  --accent: #818cf8;
  --accent-hover: #a5b4fc;
  --accent-subtle: rgba(129,140,248,0.12);
  --user-bubble: linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a855f7 100%);
  --success: #34d399;
  --success-subtle: rgba(52,211,153,0.15);
  --warning: #fbbf24;
  --warning-subtle: rgba(251,191,36,0.15);
  --error: #f87171;
  --error-subtle: rgba(248,113,113,0.15);
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.25);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.30);
  --shadow-lg: 0 8px 32px rgba(0,0,0,0.35);
  --shadow-xl: 0 16px 48px rgba(0,0,0,0.45);
}
```

- [ ] **Step 3: Remove the `body::after` noise texture block (lines 109–118)**

Delete these lines entirely:
```css
/* Noise texture overlay for premium feel */
body::after { ... }
```

- [ ] **Step 4: Update `html, body` rule**

Replace:
```css
html, body {
  height: 100%;
  overflow: hidden;
  background: var(--bg);
  background-image: var(--bg-gradient);
  background-attachment: fixed;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```
With:
```css
html, body {
  height: 100%;
  overflow: hidden;
  background: var(--bg);
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

- [ ] **Step 5: Update Google Fonts import (line 13) — remove Outfit**

Replace:
```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
```
With:
```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
```

- [ ] **Step 6: Commit**

```bash
git add public/index.html
git commit -m "style: update CSS tokens and remove noise texture / Outfit font"
```

---

## Task 2: Replace Structural CSS (Mac Window → Full-Page App)

**Files:**
- Modify: `public/index.html:150-235`

Remove `.mac-window`, `.titlebar`, `.traffic-lights`, `.main-grid`, `.sidebar` (old permanent sidebar) CSS. Add new `.app-nav`, `.sidebar-panel`, `.chat-column` CSS.

- [ ] **Step 1: Remove the entire `.mac-window` block (lines ~150–182)**

Delete:
```css
.mac-window { ... }
.mac-window::before { ... }
.mac-window:hover { ... }
```

- [ ] **Step 2: Remove `.titlebar` and traffic light CSS (lines ~184–229)**

Delete:
```css
.titlebar { ... }
.titlebar::after { ... }
.traffic-lights { ... }
.tl { ... }
.tl::after { ... }
.tl:hover { ... }
.tl-red:hover { ... }
.tl-yellow:hover { ... }
.tl-green:hover { ... }
.tl-red { ... }
.tl-yellow { ... }
.tl-green { ... }
.titlebar-center { ... }
.titlebar-title { ... }
.connection-dot { ... }
@keyframes connPulse { ... }
.connection-dot.offline { ... }
.titlebar-actions { ... }
.titlebar-btn { ... }
```

- [ ] **Step 3: Remove old `.main-grid` and `.sidebar` CSS (lines ~231–269)**

Delete:
```css
.main-grid { ... }
.main-grid.sidebar-collapsed { ... }
.sidebar { ... }
.main-grid.sidebar-collapsed .sidebar { ... }
.sidebar-toggle { ... }
.sidebar-toggle svg { ... }
.main-grid.sidebar-collapsed ~ .sidebar-toggle svg, ... { ... }
```

- [ ] **Step 4: Remove `.chat-area::before` and `.chat-area::after` aurora blocks (lines ~273–310)**

Delete:
```css
/* Aurora borealis animated background */
.chat-area::before { ... }
@keyframes auroraFlow { ... }
.chat-area::after { ... }
```

- [ ] **Step 5: Remove `.chat-header` block (lines ~312–333)**

Delete:
```css
.chat-header { ... }
.chat-header .sidebar-toggle { ... }
.chat-session-info { ... }
.chat-session-icon { ... }
.chat-session-icon:hover { ... }
.chat-session-icon svg { ... }
.chat-session-title { ... }
```

- [ ] **Step 6: Add new structural CSS** — insert after `/* Scrollbar styles */` block:

```css
/* ── Full-Page App Layout ── */
.app-layout {
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ── Top Navigation Bar ── */
.app-nav {
  height: 52px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  padding: 0 20px;
  gap: 12px;
  flex-shrink: 0;
  z-index: 100;
  position: relative;
}

.nav-hamburger {
  width: 34px;
  height: 34px;
  border-radius: var(--radius-md);
  background: var(--surface-muted);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s var(--ease);
  flex-shrink: 0;
}
.nav-hamburger:hover { background: var(--surface); color: var(--text); border-color: var(--border-strong); }
.nav-hamburger svg { width: 16px; height: 16px; }

.nav-logo {
  display: flex;
  align-items: center;
  gap: 8px;
  text-decoration: none;
}
.nav-logo-icon {
  width: 26px;
  height: 26px;
  border-radius: 7px;
  background: var(--gradient);
  flex-shrink: 0;
}
.nav-logo-text {
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.02em;
}

.nav-session-pill {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 12px;
  background: var(--surface-muted);
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  max-width: 200px;
  overflow: hidden;
}
.nav-session-pill .connection-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--success);
  flex-shrink: 0;
  box-shadow: 0 0 6px rgba(16,185,129,0.5);
  animation: connPulse 3s ease-in-out infinite;
}
@keyframes connPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
.nav-session-pill .connection-dot.offline { background: var(--error); box-shadow: 0 0 6px rgba(239,68,68,0.5); animation: none; }
.nav-session-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nav-spacer { flex: 1; }

.nav-action-btn {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  background: var(--surface-muted);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s var(--ease);
}
.nav-action-btn:hover { background: var(--surface); color: var(--text); border-color: var(--border-strong); }
.nav-action-btn svg { width: 16px; height: 16px; }

.nav-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--gradient);
  border: 2px solid var(--surface);
  box-shadow: 0 0 0 1px var(--border);
  flex-shrink: 0;
}

/* ── Sidebar Overlay Panel ── */
.sidebar-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.18);
  z-index: 200;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.3s var(--ease);
}
[data-theme="dark"] .sidebar-backdrop { background: rgba(0,0,0,0.45); }
.sidebar-backdrop.open { opacity: 1; pointer-events: auto; }

.sidebar-panel {
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  width: 260px;
  background: var(--surface);
  border-right: 1px solid var(--border);
  box-shadow: 4px 0 24px rgba(0,0,0,0.08);
  z-index: 201;
  display: flex;
  flex-direction: column;
  transform: translateX(-100%);
  transition: transform 0.3s var(--ease);
}
[data-theme="dark"] .sidebar-panel { box-shadow: 4px 0 24px rgba(0,0,0,0.35); }
.sidebar-panel.open { transform: translateX(0); }

.sidebar-panel-header {
  height: 52px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.sidebar-panel-logo {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sidebar-panel-logo-icon {
  width: 26px;
  height: 26px;
  border-radius: 7px;
  background: var(--gradient);
}
.sidebar-panel-logo-text {
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.02em;
}
.sidebar-close-btn {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  background: var(--surface-muted);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s var(--ease);
}
.sidebar-close-btn:hover { background: var(--surface); color: var(--text); }
.sidebar-close-btn svg { width: 14px; height: 14px; }

/* ── Chat Column ── */
.chat-column {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

.chat-feed-wrap {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  scroll-behavior: smooth;
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
  transition: scrollbar-color 0.3s var(--ease);
}
.chat-feed-wrap:hover { scrollbar-color: var(--border-strong) transparent; }

.chat-inner {
  max-width: 720px;
  margin: 0 auto;
  padding: 32px 24px 0;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
```

- [ ] **Step 7: Commit**

```bash
git add public/index.html
git commit -m "style: replace mac-window/sidebar CSS with full-page app structure"
```

---

## Task 3: Rewrite HTML Body Structure

**Files:**
- Modify: `public/index.html:708-849`

Replace the `<body>` contents (`.mac-window` tree) with the new full-page layout. Keep the `<div class="toast">` and `<script>` tags unchanged.

- [ ] **Step 1: Replace the entire body HTML (lines 708–848)** with:

```html
<body>

<!-- Sidebar overlay backdrop -->
<div class="sidebar-backdrop" id="sidebar-backdrop" onclick="toggleSidebar()"></div>

<!-- Sidebar slide-out panel -->
<div class="sidebar-panel" id="sidebar-panel">
  <div class="sidebar-panel-header">
    <div class="sidebar-panel-logo">
      <div class="sidebar-panel-logo-icon"></div>
      <span class="sidebar-panel-logo-text">Agent</span>
    </div>
    <button class="sidebar-close-btn" onclick="toggleSidebar()" title="Close sidebar">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
    </button>
  </div>
  <div class="sidebar-header">
    <button class="new-chat-btn" onclick="newSession()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
      New Chat
    </button>
  </div>
  <div class="sidebar-section-row">
    <div class="sidebar-section-label" id="sidebar-history-label">History</div>
    <button class="sidebar-refresh-btn" id="history-refresh-btn" onclick="renderHistory()" title="Refresh sessions">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
    </button>
  </div>
  <div class="sidebar-history scrollable" id="history-list"></div>
  <div class="sidebar-footer">
    <button class="sidebar-footer-btn" id="delete-session-btn" onclick="deleteSession()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
      Clear
    </button>
  </div>
</div>

<!-- Main app layout -->
<div class="app-layout">

  <!-- Top navigation bar -->
  <nav class="app-nav">
    <button class="nav-hamburger" id="sidebar-toggle" onclick="toggleSidebar()" title="Open sidebar">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
    </button>
    <div class="nav-logo">
      <div class="nav-logo-icon"></div>
      <span class="nav-logo-text">Agent</span>
    </div>
    <div class="nav-session-pill">
      <span class="connection-dot" id="connection-dot" title="Connected"></span>
      <span class="nav-session-name" id="chat-session-title">New Conversation</span>
    </div>
    <div class="nav-spacer"></div>
    <button class="nav-action-btn" id="lang-toggle-btn" onclick="toggleLang()" title="Switch language">
      <span style="font-size:11px;font-weight:700;letter-spacing:-0.01em" id="lang-label">עב</span>
    </button>
    <button class="nav-action-btn" onclick="toggleTheme()" title="Toggle theme">
      <svg id="theme-icon-light" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="5"></circle>
        <line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line>
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
        <line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line>
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
      </svg>
      <svg id="theme-icon-dark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
      </svg>
    </button>
    <div class="nav-avatar"></div>
  </nav>

  <!-- Chat column -->
  <div class="chat-column">
    <div class="progress-pill" id="progress-pill">
      <span class="pulse-dot"></span>
      <span id="progress-label">Thinking</span>
      <button class="stop-btn" id="stop-btn" onclick="stopStreaming()">Stop</button>
    </div>
    <div class="model-badge" id="model-badge">
      <span class="model-badge-dot"></span>
      <span id="model-badge-label"></span>
    </div>
    <div class="model-toast" id="model-toast">
      <span class="model-toast-dot" id="model-toast-dot"></span>
      <span id="model-toast-text"></span>
    </div>

    <div class="chat-feed-wrap scrollable" id="feed">
      <div class="chat-inner" id="chat-inner">
        <div id="empty-wrap">
          <div class="empty-state">
            <div class="empty-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>
            </div>
            <div class="empty-title">What can I help you with?</div>
            <div class="empty-subtitle">I can search the web, execute code, analyze files, create diagrams, and communicate in multiple languages.</div>
            <div class="empty-chips">
              <div class="empty-chip" onclick="setPrompt(I18N[currentLang].chipSearch)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>Search</div>
              <div class="empty-chip" onclick="setPrompt(I18N[currentLang].chipCode)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>Code</div>
              <div class="empty-chip" onclick="setPrompt(I18N[currentLang].chipFiles)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>Files</div>
              <div class="empty-chip" onclick="setPrompt(I18N[currentLang].chipDiagrams)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>Diagrams</div>
            </div>
            <div class="empty-shortcut">Press <kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for new line</div>
          </div>
        </div>
      </div>
    </div>

    <div class="inputbar-container">
      <div class="inputbar">
        <div class="file-chip" id="file-chip">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
          <span id="file-chip-name">file.txt</span>
          <button class="file-chip-remove" onclick="removeAttachment()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
        <div class="image-chips" id="image-chips"></div>
        <div class="input-row">
          <button class="input-btn" onclick="attachFile()" title="Attach file">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
          </button>
          <button class="input-btn" onclick="attachImage()" title="Attach image">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
          </button>
          <button class="input-btn" id="enhance-btn" onclick="enhancePrompt()" title="Enhance prompt with AI">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></svg>
          </button>
          <textarea id="prompt-input" rows="1" placeholder="Message Agent..." onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendPrompt()}" oninput="autoResize(this)"></textarea>
          <button class="input-btn input-btn-send" onclick="sendPrompt()" title="Send message">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>
          </button>
        </div>
      </div>
    </div>
  </div>

</div><!-- .app-layout -->
```

- [ ] **Step 2: Update `toggleSidebar()` in the JS** to use the new panel+backdrop IDs

Find the existing `toggleSidebar` function (~line 900–920 in JS) and replace it with:

```js
function toggleSidebar() {
  const panel = document.getElementById('sidebar-panel');
  const backdrop = document.getElementById('sidebar-backdrop');
  const isOpen = panel.classList.contains('open');
  panel.classList.toggle('open', !isOpen);
  backdrop.classList.toggle('open', !isOpen);
}
```

- [ ] **Step 3: Verify in browser**
  - Open `http://localhost:3000` (or wherever the app runs)
  - Light mode: full-page layout, top nav visible, no floating window
  - Click hamburger: sidebar slides in from left with backdrop
  - Click backdrop or X: sidebar closes
  - Toggle theme: dark mode works

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "feat: replace mac-window HTML with full-page app layout and slide-out sidebar"
```

---

## Task 4: Update Component CSS

**Files:**
- Modify: `public/index.html` — CSS section for bubbles, input bar, empty state, progress pill, typing indicator

- [ ] **Step 1: Update `.inputbar-container` and `.inputbar`**

Find and replace:
```css
.inputbar-container { padding: 24px 32px 32px; background: transparent; position: relative; z-index: 1; }
.inputbar { max-width: 1000px; margin: 0 auto; background: var(--surface-solid); border-radius: var(--radius-xl); padding: 16px; box-shadow: var(--shadow-lg); border: 1.5px solid var(--border); transition: all 0.4s var(--ease); position: relative; }
.inputbar:focus-within { transform: translateY(-4px); box-shadow: var(--shadow-xl), 0 0 0 4px var(--accent-glow); }
.inputbar:focus-within::before { opacity: 0.9; }
```
With:
```css
.inputbar-container { padding: 16px 24px 20px; background: var(--bg); position: relative; z-index: 1; }
.inputbar { max-width: 720px; margin: 0 auto; background: var(--surface); border-radius: var(--radius-lg); padding: 12px 14px; box-shadow: var(--shadow-md); border: 1.5px solid var(--border); transition: border-color 0.2s var(--ease), box-shadow 0.2s var(--ease); }
.inputbar:focus-within { border-color: var(--accent); box-shadow: var(--shadow-md), 0 0 0 3px var(--accent-subtle); }
```

- [ ] **Step 2: Update message bubble CSS**

Find and replace `.bubble { ... }`:
```css
.bubble { padding: 14px 18px; border-radius: 14px; font-size: 14px; line-height: 1.65; word-break: break-word; position: relative; border: 1px solid var(--border); }
```

Find and replace `.bubble-agent { ... }`:
```css
.bubble-agent { background: var(--surface); border: 1px solid var(--border); color: var(--text); border-bottom-left-radius: 4px; box-shadow: var(--shadow-sm); transition: box-shadow 0.2s var(--ease); }
.bubble-agent:hover { box-shadow: var(--shadow-md); }
```

Find and replace the `.bubble-user { ... }` block:
```css
.bubble-user {
  background: var(--user-bubble);
  color: #fff;
  border-bottom-right-radius: 4px;
  border-color: transparent;
  box-shadow: 0 4px 16px rgba(99,102,241,0.22);
  transition: box-shadow 0.2s var(--ease);
}
.bubble-user:hover { box-shadow: 0 6px 24px rgba(99,102,241,0.30); }
```

Update `.avatar` size to match new design:
```css
.avatar { width: 32px; height: 32px; border-radius: 9px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 16px; transition: transform 0.2s var(--spring); }
```

- [ ] **Step 3: Update `.empty-state` and related CSS**

Find and replace `.empty-icon { ... }`:
```css
.empty-icon { width: 72px; height: 72px; margin: 0 auto 24px; background: var(--surface); border: 1px solid var(--border); border-radius: 18px; display: flex; align-items: center; justify-content: center; color: var(--accent); box-shadow: var(--shadow-md); }
```

Find and replace `.empty-title { ... }`:
```css
.empty-title { font-size: 24px; font-weight: 800; margin-bottom: 12px; letter-spacing: -0.04em; color: var(--text); line-height: 1.2; }
```

Find and replace `.empty-chip { ... }`:
```css
.empty-chip { padding: 9px 16px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-full); font-size: 13px; font-weight: 500; color: var(--text-secondary); display: flex; align-items: center; gap: 7px; transition: all 0.2s var(--ease); cursor: pointer; box-shadow: var(--shadow-sm); }
.empty-chip:hover { color: var(--accent); border-color: var(--accent); background: var(--accent-subtle); transform: translateY(-2px); box-shadow: var(--shadow-md); }
```

- [ ] **Step 4: Update `.progress-pill` — move Stop button inside pill**

Find and replace `.progress-pill { ... }`:
```css
.progress-pill { position: absolute; top: 16px; left: 50%; transform: translateX(-50%) scale(0.9); display: inline-flex; align-items: center; gap: 10px; background: var(--surface); border: 1.5px solid var(--accent); padding: 8px 16px; border-radius: var(--radius-full); font-size: 13px; font-weight: 600; color: var(--accent); box-shadow: var(--shadow-md); opacity: 0; pointer-events: none; z-index: 150; white-space: nowrap; transition: opacity 0.3s var(--spring), transform 0.3s var(--spring); }
.progress-pill.visible { opacity: 1; transform: translateX(-50%) scale(1); pointer-events: auto; }
.progress-pill .pulse-dot { width: 8px; height: 8px; background: var(--accent); border-radius: 50%; animation: pulse 1.2s ease infinite; flex-shrink: 0; }
```

Replace `.stop-btn { ... }` with:
```css
.stop-btn { display: none; margin-left: 4px; background: var(--error); color: #fff; border: none; padding: 4px 10px; border-radius: var(--radius-full); font-size: 11px; font-weight: 600; cursor: pointer; transition: background 0.2s var(--ease); }
.stop-btn:hover { background: #dc2626; }
.stop-btn.visible { display: inline-flex; }
```

- [ ] **Step 5: Update `.typing-bubble` — simpler version**

Find and replace `.typing-bubble { ... }` and `.typing-bubble::before`, `.typing-bubble::after`:
```css
.typing-bubble { background: var(--surface); border: 1px solid var(--border); border-radius: 14px 14px 14px 4px; padding: 14px 18px; display: flex; align-items: center; gap: 8px; box-shadow: var(--shadow-sm); }
```

Delete the `.typing-bubble::before` and `.typing-bubble::after` blocks (remove the shimmer and 🤖 emoji).

- [ ] **Step 6: Update markdown body font size to match new type scale**

Find `.md { line-height: 1.7; font-size: 15px; }` and replace with:
```css
.md { line-height: 1.65; font-size: 14px; }
```

Find `.md h1 { font-size: 24px; ... }` and remove the gradient text effect:
```css
.md h1 { font-size: 22px; font-weight: 800; color: var(--text); }
```

- [ ] **Step 7: Verify in browser**
  - Messages render correctly in both light and dark mode
  - Input bar focus ring appears on click
  - Empty state chips show correctly
  - Progress pill appears when running

- [ ] **Step 8: Commit**

```bash
git add public/index.html
git commit -m "style: update component CSS for clean design — bubbles, input, empty state, progress pill"
```

---

## Task 5: Remove Dead CSS and Fix `#feed` Selector

**Files:**
- Modify: `public/index.html` — CSS section

The `#feed` selector now points to `.chat-feed-wrap`. Message rows need to target the new `.chat-inner` container.

- [ ] **Step 1: Update `#feed` selector**

Find:
```css
#feed { flex: 1; overflow-y: auto; padding: 32px 24px; scroll-behavior: smooth; position: relative; z-index: 1; }
```
Replace with:
```css
#feed { display: contents; }
```
(The overflow/scroll is now on `.chat-feed-wrap`; `#feed` is just a JS anchor.)

- [ ] **Step 2: Update `.feed-inner` selector**

Find:
```css
.feed-inner { max-width: 1100px; margin: 0 auto; display: flex; flex-direction: column; gap: 12px; }
```
Replace with:
```css
.feed-inner { display: contents; }
```
(Layout is now handled by `.chat-inner`.)

- [ ] **Step 3: Remove dead animation keyframes**

Delete these `@keyframes` blocks that are no longer used:
- `@keyframes gradientShift` — only needed if we still have gradient animations (keep it — still used by `.new-chat-btn`)
- `@keyframes auroraFlow` — delete (aurora removed)
- `@keyframes orbFloat1` — delete
- `@keyframes orbFloat2` — delete

- [ ] **Step 4: Remove old RTL rules for removed elements**

Find and delete the RTL block referencing removed selectors:
```css
[dir="rtl"] .sidebar { border-right: none; border-left: 1px solid var(--border); }
[dir="rtl"] .main-grid.sidebar-collapsed .sidebar { transform: translateX(20px); }
[dir="rtl"] .chat-header { padding: 0 24px 0 16px; }
[dir="rtl"] .chat-header .sidebar-toggle { margin-right: 0; margin-left: 4px; }
[dir="rtl"] .stop-btn { margin-left: 0; margin-right: auto; }
```

- [ ] **Step 5: Remove old `@media (max-width: 768px)` blocks referencing `.mac-window` and `.main-grid`**

Find and delete:
```css
@media (max-width: 768px) {
  .mac-window { height: 100vh; margin: 0; border-radius: 0; }
  .main-grid { grid-template-columns: 1fr !important; position: relative; }
  .sidebar { position: absolute; ... }
  ...
}
```

- [ ] **Step 6: Update JS `appendMessage` to target `.chat-inner`**

Find in the JS where messages are appended to `#feed` or `.feed-inner`. Look for:
```js
document.getElementById('feed')
```
or
```js
document.querySelector('.feed-inner')
```

If JS appends to `#feed` directly, add a `chat-inner` child lookup:
```js
// Replace any: feedEl.appendChild(row)
// With: document.getElementById('chat-inner').appendChild(row)
```

> Note: Search the JS for the exact selector used before making this change.

- [ ] **Step 7: Final visual verification**
  - Full page renders correctly: nav bar, chat area, input bar
  - Sidebar opens/closes via hamburger
  - Dark mode toggle works
  - Sending a message shows the message bubble in correct position
  - Empty state disappears when first message is sent

- [ ] **Step 8: Commit**

```bash
git add public/index.html
git commit -m "style: remove dead CSS, fix feed selectors, clean up unused animations"
```

---

## Self-Review Notes

- Task 3 Step 2 requires finding the exact JS `toggleSidebar` function — it likely manages `main-grid` classes currently. The new implementation replaces that with panel/backdrop class toggles.
- Task 5 Step 6 requires searching the JS first before editing — the exact selector may vary. Do not skip this search step.
- The `scroll-to-bottom` button CSS references `.scroller` — this is also being removed. If the JS uses `scroll-to-bottom`, update its anchor in Task 5.
- All `var(--surface-solid)` references in preserved CSS (e.g., `.bubble-agent`, `.review-card`) must be replaced with `var(--surface)` — `--surface-solid` is removed from tokens.
- All `var(--accent-glow)` references must be replaced with `var(--accent-subtle)` — `--accent-glow` is removed.
- All `var(--font-display)` references must be replaced with `'Inter'` — `--font-display` is removed.
