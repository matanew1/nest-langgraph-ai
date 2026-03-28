# index.html Redesign — Design Spec

**Date:** 2026-03-28
**Scope:** Full visual redesign of `public/index.html` — style, layout, and typography.

---

## Overview

Redesign the existing chat UI from a glassmorphism/Mac-window aesthetic to a clean, full-page application design. The current design has a good foundation but suffers from excessive visual complexity (heavy blur, rainbow gradients, floating window chrome) that hurts readability and feels busy. The new design is whitespace-first, typographically precise, and retains both light and dark mode support.

---

## Design Decisions

### 1. Visual Style
- **Direction:** Clean Light (B) — whitespace-first, subtle shadows, no heavy glassmorphism
- **Dark mode:** Fully supported via `[data-theme="dark"]` CSS variables (existing toggle mechanism preserved)
- **No Mac window chrome:** Remove the floating `.mac-window` with its gradient border animation. Full-page `html/body` app instead
- **No Outfit font:** Drop `Outfit` from Google Fonts import. Use `Inter` at weight 800 for display text — same quality, simpler stack

### 2. Layout & Structure
- **Full-page app:** `html, body` fill the viewport. No floating window.
- **Top navigation bar** (height 52px):
  - Left: hamburger button (opens sidebar) → logo icon + "Agent" wordmark
  - Center: session status pill (connection dot + truncated session name)
  - Right: action icon buttons (theme toggle, settings) + user avatar
- **Chat column:** centered, `max-width: 720px`, fills remaining height between nav and input
- **Input bar:** pinned to bottom of chat column, not full-width

### 3. Sidebar
- **No permanent sidebar.** Removed from normal flow entirely.
- **Slide-out overlay panel** (width 260px) triggered by the hamburger button:
  - Slides in from left with a semi-transparent backdrop dimmer
  - Contains: header (logo + close button), "New Chat" button, session history list, footer (user info + settings)
  - Closes on backdrop click or close button

### 4. Typography
| Role | Size | Weight | Color (light) | Color (dark) |
|---|---|---|---|---|
| Display | 24px | 800 | `#1a1a2e` | `#eeeef8` |
| Heading | 16px | 600 | `#1a1a2e` | `#eeeef8` |
| Body | 14px | 400 | `#1a1a2e` | `#c8c8e0` |
| Small | 12px | 500 | `#6b7280` | `#6b6b8a` |
| Label | 11px | 600 | `#9ca3af` | `#4a4a68` |
- Line height: 1.65 for body, 1.4 for headings
- Letter spacing: -0.04em for display, -0.02em for headings, 0.06em for uppercase labels

### 5. Color Tokens

**Light mode:**
| Token | Value | Usage |
|---|---|---|
| `--bg` | `#f5f6fa` | Page background |
| `--surface` | `#ffffff` | Cards, nav, bubbles |
| `--surface-muted` | `#eef0f5` | Hover states, secondary backgrounds |
| `--border` | `#e4e6ed` | All borders |
| `--text` | `#1a1a2e` | Primary text |
| `--text-secondary` | `#6b7280` | Secondary/meta text |
| `--text-tertiary` | `#9ca3af` | Timestamps, labels |
| `--accent` | `#6366f1` | Primary interactive color |
| `--accent-subtle` | `rgba(99,102,241,0.08)` | Hover tints, active states |
| `--gradient` | `linear-gradient(135deg, #6366f1, #a855f7)` | Buttons, user avatar, user bubble |
| `--success` | `#10b981` | Connected status |
| `--error` | `#ef4444` | Disconnected, stop button |
| `--warning` | `#f59e0b` | Reconnecting status |

**Dark mode (overrides):**
| Token | Value |
|---|---|
| `--bg` | `#0d0d18` |
| `--surface` | `#13131f` |
| `--surface-muted` | `#1c1c2e` |
| `--border` | `rgba(255,255,255,0.08)` |
| `--text` | `#eeeef8` |
| `--text-secondary` | `#c8c8e0` |
| `--text-tertiary` | `#4a4a68` |
| `--accent` | `#818cf8` |
| `--accent-subtle` | `rgba(129,140,248,0.12)` |

---

## Components

### Top Navigation Bar
- Height: 52px, `background: var(--surface)`, `border-bottom: 1px solid var(--border)`
- Hamburger: 34×34px, rounded-8, `--surface-muted` background with hover state
- Logo: 26×26px gradient icon + "Agent" text at 14px/700
- Session pill: `background: --surface-muted`, `border-radius: 20px`, connection dot (6px, animated pulse when connected), session name (truncated)
- Action buttons: 32×32px rounded-8, `--surface-muted` background
- Avatar: 32×32px circle, gradient fill

### Sidebar Overlay
- Width: 260px, `background: var(--surface)`, right border `1px solid var(--border)`
- Box shadow: `4px 0 24px rgba(0,0,0,0.08)` (light) / `4px 0 24px rgba(0,0,0,0.3)` (dark)
- Backdrop: `rgba(0,0,0,0.18)` (light) / `rgba(0,0,0,0.45)` (dark)
- Transition: `transform 0.3s ease` (slides from `translateX(-100%)` to `translateX(0)`)
- New Chat button: full-width, gradient background, 8px radius
- History items: 8px padding, active item uses `--accent-subtle` bg + left 3px accent bar
- Footer: avatar + name + settings icon

### Message Bubbles
- **Agent:** `background: var(--surface)`, `border: 1px solid var(--border)`, `border-radius: 14px 14px 14px 4px`, shadow `0 1px 4px rgba(0,0,0,0.04)`
- **User:** gradient background, `border-radius: 14px 14px 4px 14px`, shadow `0 4px 16px rgba(99,102,241,0.22)`
- **Avatar size:** 32×32px, `border-radius: 9px`
- **Timestamp:** 11px/600, `--text-tertiary`, shown below sender name
- **Reaction row** (agent only, visible on hover): thumbs up + copy buttons, 11px pill style
- **Typing indicator:** 3 dots in `--accent` tones inside a regular agent bubble

### Input Bar
- `background: var(--surface)`, `border: 1.5px solid var(--border)`, `border-radius: 14px`
- **Focused state:** `border-color: var(--accent)`, box-shadow `0 0 0 3px var(--accent-subtle)`
- Textarea: auto-grow, no resize handle, 14px body text
- Attachment button: 30×30px, `--surface-muted`
- Send button: 34×34px, gradient (active) or `--surface-muted` (empty/idle), `border-radius: 9px`
- Hint text below: `⌘ + Enter to send`, 11px, `--text-tertiary`

### Empty State
- Centered in chat column
- Icon: 72×72px white card with gradient inner icon, `border-radius: 18px`, subtle shadow
- Headline: 24px/800, `--text`
- Subtitle: 14px/400, `--text-secondary`, max-width 420px
- Suggestion chips: 4 items, pill shape, `--surface` bg, `--border` border, emoji + label, hover → accent border + tint

### Progress Pill
- Floats below top nav (position absolute, centered horizontally)
- `background: var(--surface)`, `border: 1.5px solid var(--accent)`, `border-radius: 20px`
- Contents: pulse dot + label text (e.g., "Researching · Step 2 of 5") + thin progress bar + Stop button
- Stop button: red pill, 11px/600, appears only during active runs

### Connection Status
- Three states: Connected (green), Disconnected (red), Reconnecting (amber)
- Shown as a pill inside the session status area in the nav bar
- Icons: 6px colored dot

---

## What Is Removed

| Removed | Reason |
|---|---|
| `.mac-window` floating container | Full-page layout replaces it |
| Rainbow gradient border animation on window | Replaced by clean border |
| `.sidebar` in normal document flow | Replaced by slide-out overlay |
| Aurora/orb background animations on `.chat-area` | Too visually noisy; removed |
| `Outfit` font import | Replaced by Inter 800 |
| Noise texture `body::after` | Unnecessary with clean design |
| Heavy `backdrop-filter: blur()` on most elements | Reserved for sidebar overlay only |

---

## What Is Preserved

- All existing JavaScript logic (streaming, session management, tool calls, Mermaid rendering)
- Dark/light theme toggle mechanism (`data-theme` attribute)
- `JetBrains Mono` for inline code
- Mermaid diagram rendering
- Scroll-to-bottom button
- Core CSS custom property names preserved (`--bg`, `--surface`, `--border`, `--text`, `--accent`, `--success`, `--error`, `--warning`); new tokens added (`--surface-muted`, `--gradient`); unused tokens removed (`--surface-elevated`, `--surface-glass`, `--surface-hover`, `--bg-gradient`, `--blur`, `--blur-heavy`, `--shadow-glow`, `--accent-glow`, `--noise-opacity`)
- Keyboard shortcut hints

---

## Out of Scope

- No changes to backend API, NestJS modules, or graph nodes
- No new JavaScript features
- No responsive/mobile layout (desktop-first, same as today)
