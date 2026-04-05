# peek

<p align="center">
  <img src="src-tauri/icons/icon.svg" alt="Peek Logo" width="128" height="128">
</p>

<p align="center">
  <strong>A lightweight, ultra-persistent system monitor and network traffic tracker</strong>
</p>

<p align="center">
  Built with Tauri v2, Rust, and React. Lives in your system tray with a draggable overlay above your Windows taskbar showing live CPU, GPU, RAM, and Network usage.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tauri_v2-Rust-F46623?logo=tauri" alt="Tauri v2">
  <img src="https://img.shields.io/badge/React-TypeScript-61DAFB?logo=react" alt="React TypeScript">
  <img src="https://img.shields.io/badge/Tailwind_v4-Shadcn_UI-38B2AC?logo=tailwindcss" alt="Tailwind v4">
  <img src="https://img.shields.io/badge/SQLite-sqlx-003B57?logo=sqlite" alt="SQLite">
</p>

---

## ✨ Features

- **Live Taskbar Overlay** — A tiny, draggable, transparent window displaying live ⬇️ Download, ⬆️ Upload, CPU, GPU, and RAM usage
- **Lock Overlay Position** — Lock the overlay in place to prevent accidental repositioning
- **Aggressive Topmost Engine** — Defeats Windows 11's strict taskbar layering by re-asserting `HWND_TOPMOST`
- **Network Traffic Database** — Silently tracks network bytes in SQLite with historical stats
- **Custom Month History** — Navigate through months to view detailed daily network usage
- **Visual Analytics** — Interactive charts with Recharts for traffic distribution and daily activity
- **Modern Dashboard** — Compact tray dashboard with Shadcn UI components
- **Zero-Locking Architecture** — SQLite WAL mode for concurrent reads/writes without UI freezes

---

## 🖼️ Screenshots

<p align="center">
  <em>Overlay sitting above the Windows taskbar</em>
</p>

<p align="center">
  <em>Dashboard with traffic analytics</em>
</p>

---

## 🏗️ Architecture & Data Flow

The app is split into a **Rust Backend** (hardware polling, background DB writes) and a **React Frontend** (UI, manual DB queries).

```
┌─────────────────────────────────────────────────────────────────┐
│                        RUST BACKEND                             │
├─────────────────────────────────────────────────────────────────┤
│  monitor.rs     → Polls CPU/RAM/GPU/Network every 1 second     │
│  lib.rs         → Emits stats-update event to overlay          │
│  db.rs          → Flushes bytes to SQLite every 60 seconds     │
│  tray.rs        → System tray icon & context menu              │
│  overlay.rs     → Win32 topmost enforcement                    │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                       REACT FRONTEND                            │
├─────────────────────────────────────────────────────────────────┤
│  Overlay.tsx    → Live stats display (350x40px window)         │
│  App.tsx        → Dashboard with charts & history              │
│  index.css      → Tailwind v4 + Shadcn dark theme              │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📂 File Structure

### Frontend (`src/`)

| File | Description |
|------|-------------|
| `App.tsx` | Main dashboard with tabs, charts, and SQL queries |
| `Overlay.tsx` | Live taskbar overlay with drag-to-reposition |
| `index.css` | Tailwind v4, Shadcn styles, dark mode enforcement |

### Backend (`src-tauri/src/`)

| File | Description |
|------|-------------|
| `lib.rs` | App initialization, command handlers, monitoring loop |
| `monitor.rs` | Hardware polling via `sysinfo` and WMI |
| `db.rs` | SQLite pool with WAL mode, 60-second upserts |
| `overlay.rs` | Win32 window positioning and topmost enforcement |
| `tray.rs` | System tray icon, menu, and lock position toggle |
| `config.rs` | Overlay position persistence (JSON) |
| `overlay_state.rs` | In-memory overlay state with lock flag |

---

## 🛠️ Getting Started

### Prerequisites

- [Rust](https://www.rust-lang.org/tools/install)
- [Bun](https://bun.sh/) (JavaScript runtime)
- Windows OS (required for WMI and `windows-sys` APIs)

### Installation

```bash
# Clone the repository
git clone https://github.com/pollux-team/peek.git
cd peek

# Install dependencies
bun install

# Run development server
bun run dev
```

### Production Build

```bash
bun run build
```

Outputs `.exe` and `.msi` installers to `src-tauri/target/release/bundle/`.

---

## ⚙️ Configuration

### Tauri v2 Capabilities

Frontend features requiring OS access must be whitelisted in `src-tauri/capabilities/default.json`:

- Window dragging (`data-tauri-drag-region`)
- Window minimize/hide
- SQL queries
- Overlay position locking

### SQLite Database

Two libraries for safe concurrent access:

| Library | Usage |
|---------|-------|
| `sqlx` (Rust) | Background INSERT every 60 seconds |
| `tauri-plugin-sql` (React) | Async SELECT for UI rendering |

Uses WAL mode for zero-locking concurrent access.

---

## 🔧 Key Implementation Details

### Why `force_topmost`?

Windows 11 aggressively pushes overlay windows to the background. The solution:

1. `SetWindowPos` called every 500ms in a background thread
2. `force_topmost` command triggered on window move events
3. Ensures overlay stays above the taskbar layer

### Lock Overlay Position

The `locked` flag in `OverlayConfig` prevents:
- Automatic repositioning on tray icon click
- Position saving on manual drag

Toggle via tray menu or settings panel.

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.