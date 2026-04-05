import { useEffect, useState } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import "./overlay.css";

export default function Overlay() {
  const [upload, setUpload] = useState<string>("—");
  const [download, setDownload] = useState<string>("—");
  const [cpu, setCpu] = useState<string>("—");
  const [gpu, setGpu] = useState<string>("—");
  const [ram, setRam] = useState<string>("—");

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let unlistenTray: UnlistenFn | null = null;
    let unlistenMove: UnlistenFn | null = null;
    let unlistenReset: UnlistenFn | null = null;
    let timeoutId: ReturnType<typeof setTimeout>;

    // 1. Stats Listener
    listen("stats-update", (evt) => {
      if (evt && typeof evt.payload === "string") {
        const payload = evt.payload as string;
        try {
          const parts = payload.split("|").map((p) => p.trim());
          if (parts[0]) {
            const io = parts[0];
            const downSplit = io.split("↓");
            if (downSplit.length >= 2) {
              setUpload(downSplit[0].replace("↑", "").trim());
              setDownload(downSplit[1].trim());
            } else {
              const tokens = parts[0].split(/\s+/);
              if (tokens.length >= 2) {
                setUpload(tokens[0].replace(/^↑/, ""));
                setDownload(tokens[1].replace(/^↓/, ""));
              }
            }
          }

          if (parts[1]) {
            const m = parts[1].match(/CPU\s*([0-9.]+)%?/i);
            if (m) setCpu(m[1] + "%");
          }

          if (parts[2]) {
            const m = parts[2].match(/GPU\s*([0-9.]+)%?/i);
            if (m) setGpu(m[1] + "%");
          }

          if (parts[3]) {
            const m = parts[3].match(/RAM\s*(.+)/i);
            if (m) setRam(m[1].trim());
          }
        } catch (e) {
          setUpload(payload);
        }
      }
    }).then((fn) => (unlisten = fn));

    // 2. Tray Events
    listen("tray-rect", () => {}).then((fn) => (unlistenTray = fn));

    const dynamicImport = (s: string) =>
      new Function("s", "return import(s)")(s);

    // 3. Reset Event
    listen("overlay-reset", async () => {
      try {
        const dbModule = await dynamicImport("@tauri-apps/plugin-sql").catch(
          () => null,
        );
        const Database = dbModule ? (dbModule as any).default : null;
        if (Database) {
          const db = await Database.load("sqlite:overlay.db");
          await db.execute("DELETE FROM overlay;", []);
        } else {
          try {
            await invoke("clear_saved_overlay_position");
          } catch (e) {}
        }
      } catch (e) {}
    }).then((fn) => (unlistenReset = fn));

    // 4. Initialization (Load position)
    (async () => {
      try {
        const dbModule = await dynamicImport("@tauri-apps/plugin-sql").catch(
          () => null,
        );
        const Database = dbModule ? (dbModule as any).default : null;
        if (Database) {
          const db = await Database.load("sqlite:overlay.db");
          await db.execute(
            `CREATE TABLE IF NOT EXISTS overlay (id INTEGER PRIMARY KEY, x INTEGER, y INTEGER, width INTEGER, height INTEGER, manual INTEGER);`,
          );
          const rows = await db.select(
            "SELECT x, y, width, height, manual FROM overlay ORDER BY id DESC LIMIT 1",
            [],
          );
          if (rows && rows.length > 0) {
            const r: any = rows[0];
            const manual = Number(r.manual) === 1;
            const w = getCurrentWindow();
            await (w as any).setSize({
              width: Number(r.width),
              height: Number(r.height),
            });
            await (w as any).setPosition({ x: Number(r.x), y: Number(r.y) });
            await invoke("set_overlay_state", {
              x: Number(r.x),
              y: Number(r.y),
              width: Number(r.width),
              height: Number(r.height),
              manual,
            });
          }
        } else {
          const cfg: any = await invoke("load_overlay_position");
          if (cfg) {
            const w = getCurrentWindow();
            await (w as any).setSize({
              width: Number(cfg.width),
              height: Number(cfg.height),
            });
            await (w as any).setPosition({
              x: Number(cfg.x),
              y: Number(cfg.y),
            });
            await invoke("set_overlay_state", {
              x: Number(cfg.x),
              y: Number(cfg.y),
              width: Number(cfg.width),
              height: Number(cfg.height),
              manual: Boolean(cfg.manual),
            });
          }
        }
      } catch (e) {}
    })();

    // 5. Window Move Listener (Fixes the Drop & Remember state bug, AND ensures it stays on top)
    getCurrentWindow()
      .onMoved(async () => {
        // Force the window to stay on top while dragging
        try {
          await invoke("force_topmost");
        } catch (e) {}

        clearTimeout(timeoutId);
        timeoutId = setTimeout(async () => {
          try {
            const w = getCurrentWindow();
            const pos = await w.outerPosition();
            const size = await w.outerSize();

            // Save to DB
            const dbModule = await dynamicImport(
              "@tauri-apps/plugin-sql",
            ).catch(() => null);
            const Database = dbModule ? (dbModule as any).default : null;
            if (Database) {
              const db = await Database.load("sqlite:overlay.db");
              await db.execute("DELETE FROM overlay;", []);
              await db.execute(
                "INSERT INTO overlay (x,y,width,height,manual) VALUES ($1,$2,$3,$4,$5)",
                [pos.x, pos.y, size.width, size.height, 1],
              );
            }

            // Save to Rust
            await invoke("save_overlay_position", {
              x: pos.x,
              y: pos.y,
              width: size.width,
              height: size.height,
              manual: true,
            });
            await invoke("set_overlay_state", {
              x: pos.x,
              y: pos.y,
              width: size.width,
              height: size.height,
              manual: true,
            });
          } catch (e) {}
        }, 500); // 500ms debounce
      })
      .then((fn) => (unlistenMove = fn));

    // Call topmost immediately on mount
    invoke("force_topmost").catch(() => {});

    return () => {
      if (unlisten) unlisten();
      if (unlistenTray) unlistenTray();
      if (unlistenReset) unlistenReset();
      if (unlistenMove) unlistenMove();
      clearTimeout(timeoutId);
    };
  }, []);

  return (
    <div className="overlay-root" data-tauri-drag-region>
      <div className="overlay-bar" data-tauri-drag-region>
        <div className="stat upload" data-tauri-drag-region>
          ↑ {upload}
        </div>
        <div className="stat download" data-tauri-drag-region>
          ↓ {download}
        </div>
        <div className="stat cpu" data-tauri-drag-region>
          CPU {cpu}
        </div>
        <div className="stat gpu" data-tauri-drag-region>
          GPU {gpu}
        </div>
        <div className="stat ram" data-tauri-drag-region>
          RAM {ram}
        </div>
      </div>
    </div>
  );
}
