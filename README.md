
# 👁️ Peek

**Peek** is a lightweight, ultra-persistent system monitor and network traffic tracker built with Tauri v2, Rust, and React. 

It lives in your system tray, provides a beautifully modern Shadcn-powered dashboard for network analytics, and features a bulletproof, draggable overlay that sits permanently above your Windows taskbar to show live CPU, GPU, RAM, and Network usage.

![Tech Stack](https://img.shields.io/badge/Tauri_v2-Rust-F46623?logo=tauri)
![Tech Stack](https://img.shields.io/badge/React-TypeScript-61DAFB?logo=react)
![Tech Stack](https://img.shields.io/badge/Tailwind_v4-Shadcn_UI-38B2AC?logo=tailwindcss)
![Tech Stack](https://img.shields.io/badge/SQLite-sqlx-003B57?logo=sqlite)

---

## ✨ Features

- **Live Taskbar Overlay**: A tiny, draggable, transparent window displaying live ⬇️ Download, ⬆️ Upload, CPU, GPU, and RAM usage.
- **Aggressive Topmost Engine**: Defeats Windows 11's strict taskbar layering by aggressively re-asserting `HWND_TOPMOST` native Win32 calls.
- **Network Traffic Database**: Silently tracks precise network bytes transferred locally in a SQLite database.
- **Modern Dashboard**: A compact tray dashboard featuring glass-morphic UI, visual distribution bars, and historical stats (Today, 7 Days, 30 Days, All Time).
- **Zero-Locking Architecture**: Uses SQLite WAL (Write-Ahead Logging) so the Rust backend can write data simultaneously while the React frontend queries it, ensuring 0 UI freezes.

---

## 🏗️ Architecture & Data Flow

Understanding the data flow is critical to contributing to Peek. The app is split into a **Rust Backend** (Heavy lifting, hardware polling, background DB writes) and a **React Frontend** (UI, manual DB queries).

1. **Hardware Polling (`monitor.rs`)**: Every 1 second, a background Tokio thread polls the OS for network bytes, CPU, RAM, and GPU usage (via WMI).
2. **Live UI Updates (`lib.rs`)**: The 1-second loop emits a Tauri event (`stats-update`) to the React `Overlay.tsx`, updating the live taskbar overlay.
3. **Traffic Accumulation (`db.rs`)**: Raw bytes are accumulated in memory. Every 60 seconds, Rust uses `sqlx` to flush these bytes to `peek.db` (SQLite) to minimize SSD wear.
4. **Dashboard Queries (`App.tsx`)**: When the user opens the tray dashboard, React uses `@tauri-apps/plugin-sql` to execute direct `SELECT` queries against `peek.db` to render historical data.

---

## 📂 File Structure Guide (Which file does what?)

### Frontend (`src/`)
- **`App.tsx`**: The main Dashboard. Runs in a borderless, transparent, portrait window. Features the Shadcn Tabs, customized draggable title bar, and executes SQL queries for historical data.
- **`Overlay.tsx`**: The Live Taskbar Overlay. Runs in a tiny 350x40px window. Listens to Tauri events to update live stats. Includes logic to save its X/Y coordinates when dragged.
- **`index.css`**: Injects Tailwind v4, Shadcn styles, and strictly enforces the dark-mode theme across all windows.

### Backend (`src-tauri/src/`)
- **`lib.rs`**: The brain of the app. Initializes Tauri, sets up SQLite migrations, spawns the 1-second background monitoring loop, and registers all frontend-invokable commands.
- **`monitor.rs`**: System hardware polling. Uses `sysinfo` for CPU/RAM/Network, and spawns a separate COM thread using `wmi` to query the Windows GPU Performance Counters.
- **`db.rs`**: Configures the async `sqlx` SQLite pool. Forces `WAL` journal mode and handles the 60-second background data upserts.
- **`overlay.rs`**: The Win32 specific windowing logic. Calculates the exact dimensions of the Windows Taskbar to anchor the overlay on initial launch. Spawns an aggressive 500ms background thread utilizing `windows-sys` to force the window above the taskbar layer.
- **`tray.rs`**: Builds the system tray icon and native context menu. Handles left-click events to toggle the visibility of the main dashboard window.
- **`config.rs` & `overlay_state.rs`**: Handles saving and loading the X/Y coordinates of the overlay window so it remembers where the user dragged it between sessions.

### Permissions (`src-tauri/capabilities/`)
- **`default.json`**: Tauri v2 is strictly secure by default. This file explicitly whitelists the frontend's ability to drag windows, minimize/hide windows, and execute SQL queries.

---

## 🛠️ Contributor Guide

### Prerequisites
- [Rust](https://www.rust-lang.org/tools/install)
- [Bun](https://bun.sh/) (JavaScript runtime and package manager)
- Windows OS (Required for local development due to WMI and `windows-sys` taskbar API calls).

### Local Setup
1. Clone the repository.
2. Install frontend dependencies:
   ```bash
   bun install
   ```
3. Run the development server (compiles Rust and launches Vite):
   ```bash
   bun run dev
   ```

### Important Development Notes

#### 1. Tauri v2 Capabilities
If you add a new feature to the frontend that interacts with the OS (e.g., resizing a window, reading a file, sending a notification), **it will silently fail** unless you explicitly allow it in `src-tauri/capabilities/default.json`. Always check permissions if an API call returns `undefined` or does nothing.

#### 2. The `peek.db` SQLite Database
We intentionally use two different SQLite libraries:
- **`sqlx` (Rust)**: Used exclusively by the background thread to safely `INSERT` data every 60 seconds without freezing the UI.
- **`tauri-plugin-sql` (React)**: Used by the frontend to asynchronously `SELECT` data for rendering. 
*Note: Because we use SQLite `WAL` mode, the DB will safely handle concurrent reads and writes. Do not remove the `WAL` configuration in `db.rs`!*

#### 3. Why `force_topmost`?
Windows 11 constantly pushes taskbar overlays to the background. If you edit `overlay.rs`, you will notice a loop that calls `SetWindowPos` every 500ms, and a `force_topmost` Tauri command triggered "onMoved" in `Overlay.tsx`. These are intentional "hacks" required to prevent the OS from burying our overlay widget. 

### Building for Production
To compile the final `.exe` and `.msi` installers:
```bash
bun run build
```
The compiled binaries will be located in `src-tauri/target/release/bundle/`.

---

## 📄 License
This project is licensed under the MIT License.
