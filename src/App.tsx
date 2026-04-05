import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Database from "@tauri-apps/plugin-sql";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  Clock3,
  DownloadCloud,
  History,
  Minimize2,
  RefreshCw,
  TrendingUp,
  X,
} from "lucide-react";

import appLogo from "./assets/icon.svg";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import "./index.css";

interface Usage {
  rx: number;
  tx: number;
}

interface UsageReport {
  today: Usage;
  week: Usage;
  month: Usage;
  all_time: Usage;
}

export default function App() {
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<UsageReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updateStatus, setUpdateStatus] = useState("Check for updates");

  const fetchUsage = async () => {
    try {
      setRefreshing(true);
      setLoading((prev) => (usage ? prev : true));

      const db = await Database.load("sqlite:overlay.db");

      const today = await db.select<Usage[]>(
        `SELECT
          COALESCE(SUM(rx_bytes), 0) as rx,
          COALESCE(SUM(tx_bytes), 0) as tx
         FROM network_usage
         WHERE date = date('now', 'localtime')`,
      );

      const week = await db.select<Usage[]>(
        `SELECT
          COALESCE(SUM(rx_bytes), 0) as rx,
          COALESCE(SUM(tx_bytes), 0) as tx
         FROM network_usage
         WHERE date >= date('now', 'localtime', '-7 days')`,
      );

      const month = await db.select<Usage[]>(
        `SELECT
          COALESCE(SUM(rx_bytes), 0) as rx,
          COALESCE(SUM(tx_bytes), 0) as tx
         FROM network_usage
         WHERE date >= date('now', 'localtime', '-30 days')`,
      );

      const allTime = await db.select<Usage[]>(
        `SELECT
          COALESCE(SUM(rx_bytes), 0) as rx,
          COALESCE(SUM(tx_bytes), 0) as tx
         FROM network_usage`,
      );

      setUsage({
        today: today[0] || { rx: 0, tx: 0 },
        week: week[0] || { rx: 0, tx: 0 },
        month: month[0] || { rx: 0, tx: 0 },
        all_time: allTime[0] || { rx: 0, tx: 0 },
      });
    } catch (e) {
      console.error("Failed to fetch usage from database:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    document.documentElement.classList.add("dark");

    invoke<boolean>("is_autostart_enabled")
      .then((v) => setAutostart(v))
      .catch(() => setAutostart(null));

    fetchUsage();
    const interval = setInterval(fetchUsage, 10000);
    return () => clearInterval(interval);
  }, []);

  async function toggleAutostart(checked: boolean) {
    try {
      setAutostart(checked);
      await invoke("set_autostart_enabled", { enabled: checked });
    } catch {
      setAutostart(!checked);
    }
  }

  async function minimizeWindow() {
    try {
      const win = getCurrentWindow();
      await win.minimize();
    } catch (e) {
      console.error("Failed to minimize window:", e);
    }
  }

  async function closeWindow() {
    try {
      const win = getCurrentWindow();
      await win.hide();
    } catch (e) {
      console.error("Failed to hide window:", e);
      try {
        const win = getCurrentWindow();
        await win.minimize();
      } catch {}
    }
  }

  async function checkForUpdates() {
    try {
      setUpdateStatus("Checking...");
      const update = await check();

      if (update) {
        setUpdateStatus(`Downloading v${update.version}...`);
        let downloaded = 0;
        let contentLength = 0;

        await update.downloadAndInstall((event) => {
          switch (event.event) {
            case "Started":
              contentLength = event.data.contentLength || 0;
              break;
            case "Progress":
              downloaded += event.data.chunkLength;
              if (contentLength > 0) {
                const percent = Math.round((downloaded / contentLength) * 100);
                setUpdateStatus(`Downloading ${percent}%`);
              }
              break;
            case "Finished":
              setUpdateStatus("Installing...");
              break;
          }
        });

        setUpdateStatus("Relaunching...");
        await relaunch();
      } else {
        setUpdateStatus("App is up to date");
        setTimeout(() => setUpdateStatus("Check for updates"), 3000);
      }
    } catch (error) {
      console.error(error);
      setUpdateStatus("Update failed");
      setTimeout(() => setUpdateStatus("Check for updates"), 3000);
    }
  }

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  const totalTraffic = useMemo(() => {
    if (!usage) return 0;
    return usage.all_time.rx + usage.all_time.tx;
  }, [usage]);

  const downloadShare = useMemo(() => {
    if (!usage) return 0;
    const total = usage.all_time.rx + usage.all_time.tx;
    if (total === 0) return 0;
    return Math.round((usage.all_time.rx / total) * 100);
  }, [usage]);

  const uploadShare = 100 - downloadShare;

  const strongestPeriod = useMemo(() => {
    if (!usage) return null;
    const periods = [
      { name: "Today", total: usage.today.rx + usage.today.tx },
      { name: "7 Days", total: usage.week.rx + usage.week.tx },
      { name: "30 Days", total: usage.month.rx + usage.month.tx },
      { name: "All Time", total: usage.all_time.rx + usage.all_time.tx },
    ];
    return periods.reduce(
      (max, p) => (p.total > max.total ? p : max),
      periods[0],
    );
  }, [usage]);

  return (
    <main className="h-screen overflow-hidden bg-transparent text-foreground">
      <div className="mx-auto flex h-screen w-full max-w-[420px] flex-col overflow-hidden rounded-[22px] border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b px-3 py-2.5">
          <div
            className="flex min-w-0 items-center gap-2.5"
            data-tauri-drag-region
          >
            <div className="flex h-8 w-8 items-center justify-center overflow-hidden">
              <img
                src={appLogo}
                alt="peek logo"
                className="h-full w-full object-contain pointer-events-none"
                draggable={false}
              />
            </div>

            <div className="min-w-0 pointer-events-none" data-tauri-drag-region>
              <div className="text-sm font-semibold tracking-tight">peek</div>
              <div className="text-[10px] text-muted-foreground">
                compact network tray
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                minimizeWindow();
              }}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Minimize window"
              title="Minimize"
            >
              <Minimize2 className="h-3.5 w-3.5" />
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                closeWindow();
              }}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
              aria-label="Hide window"
              title="Hide to tray"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <Tabs defaultValue="overview" className="flex min-h-0 flex-1 flex-col">
          <div className="border-b px-3 py-2">
            <TabsList className="grid h-8 w-full grid-cols-3 rounded-lg">
              <TabsTrigger value="overview" className="text-xs">
                Overview
              </TabsTrigger>
              <TabsTrigger value="history" className="text-xs">
                History
              </TabsTrigger>
              <TabsTrigger value="settings" className="text-xs">
                Settings
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="min-h-0 flex-1">
            <ScrollArea className="h-full">
              <div className="space-y-3 p-3">
                <TabsContent value="overview" className="mt-0 space-y-3">
                  {loading ? (
                    <DashboardSkeleton />
                  ) : usage ? (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <SmallUsageCard
                          title="Today"
                          icon={<CalendarDays className="h-3.5 w-3.5" />}
                          rx={formatBytes(usage.today.rx)}
                          tx={formatBytes(usage.today.tx)}
                        />
                        <SmallUsageCard
                          title="7 Days"
                          icon={<TrendingUp className="h-3.5 w-3.5" />}
                          rx={formatBytes(usage.week.rx)}
                          tx={formatBytes(usage.week.tx)}
                        />
                        <SmallUsageCard
                          title="30 Days"
                          icon={<Clock3 className="h-3.5 w-3.5" />}
                          rx={formatBytes(usage.month.rx)}
                          tx={formatBytes(usage.month.tx)}
                        />
                        <SmallUsageCard
                          title="All Time"
                          icon={<History className="h-3.5 w-3.5" />}
                          rx={formatBytes(usage.all_time.rx)}
                          tx={formatBytes(usage.all_time.tx)}
                        />
                      </div>

                      <Card className="rounded-2xl">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm">
                            Traffic split
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <div className="flex items-center justify-between text-[11px]">
                            <div className="flex items-center gap-1.5">
                              <span className="h-2 w-2 rounded-full bg-sky-500" />
                              <span className="text-muted-foreground">
                                Download
                              </span>
                              <span className="font-medium">
                                {downloadShare}%
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="h-2 w-2 rounded-full bg-emerald-500" />
                              <span className="text-muted-foreground">
                                Upload
                              </span>
                              <span className="font-medium">
                                {uploadShare}%
                              </span>
                            </div>
                          </div>

                          <Progress value={downloadShare} className="h-2" />

                          <div className="grid grid-cols-2 gap-2">
                            <CompactStat
                              label="Download"
                              value={formatBytes(usage.all_time.rx)}
                              icon={
                                <ArrowDown className="h-3.5 w-3.5 text-sky-500" />
                              }
                            />
                            <CompactStat
                              label="Upload"
                              value={formatBytes(usage.all_time.tx)}
                              icon={
                                <ArrowUp className="h-3.5 w-3.5 text-emerald-500" />
                              }
                            />
                          </div>
                        </CardContent>
                      </Card>
                    </>
                  ) : (
                    <EmptyState text="No usage data found." />
                  )}
                </TabsContent>

                <TabsContent value="history" className="mt-0 space-y-3">
                  {loading ? (
                    <DashboardSkeleton />
                  ) : usage ? (
                    <>
                      <Card className="rounded-2xl">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm">
                            Usage summary
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <HistoryRow
                            label="Total traffic"
                            value={formatBytes(totalTraffic)}
                          />
                          <Separator />
                          <HistoryRow
                            label="Most active window"
                            value={strongestPeriod?.name ?? "—"}
                          />
                          <Separator />
                          <HistoryRow
                            label="Today download"
                            value={formatBytes(usage.today.rx)}
                          />
                          <Separator />
                          <HistoryRow
                            label="Today upload"
                            value={formatBytes(usage.today.tx)}
                          />
                          <Separator />
                          <HistoryRow
                            label="7-day total"
                            value={formatBytes(usage.week.rx + usage.week.tx)}
                          />
                          <Separator />
                          <HistoryRow
                            label="30-day total"
                            value={formatBytes(usage.month.rx + usage.month.tx)}
                          />
                        </CardContent>
                      </Card>

                      <Card className="rounded-2xl">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm">
                            Recorded totals
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="grid grid-cols-2 gap-2">
                          <CompactStat
                            label="All download"
                            value={formatBytes(usage.all_time.rx)}
                            icon={
                              <ArrowDown className="h-3.5 w-3.5 text-sky-500" />
                            }
                          />
                          <CompactStat
                            label="All upload"
                            value={formatBytes(usage.all_time.tx)}
                            icon={
                              <ArrowUp className="h-3.5 w-3.5 text-emerald-500" />
                            }
                          />
                        </CardContent>
                      </Card>
                    </>
                  ) : (
                    <EmptyState text="History is not available." />
                  )}
                </TabsContent>

                <TabsContent value="settings" className="mt-0 space-y-3">
                  <Card className="rounded-2xl">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">General</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <SettingRow
                        title="Autostart"
                        description="Launch peek on system startup"
                        control={
                          <Switch
                            checked={!!autostart}
                            onCheckedChange={toggleAutostart}
                            disabled={autostart === null}
                          />
                        }
                      />

                      <Separator />

                      <SettingRow
                        title="Refresh data"
                        description="Reload current usage from the database"
                        control={
                          <button
                            type="button"
                            onClick={fetchUsage}
                            className="inline-flex h-8 items-center gap-2 rounded-md border px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                          >
                            <RefreshCw
                              className={`h-3.5 w-3.5 ${refreshing ? "animate-spin text-primary" : ""}`}
                            />
                            Refresh
                          </button>
                        }
                      />

                      <Separator />

                      <SettingRow
                        title="Software update"
                        description="Check for the latest version of Peek"
                        control={
                          <button
                            type="button"
                            onClick={checkForUpdates}
                            disabled={
                              updateStatus !== "Check for updates" &&
                              updateStatus !== "App is up to date" &&
                              updateStatus !== "Update failed"
                            }
                            className="inline-flex h-8 items-center gap-2 rounded-md border bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground px-2.5 text-xs font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none"
                          >
                            <DownloadCloud className="h-3.5 w-3.5" />
                            {updateStatus}
                          </button>
                        }
                      />
                    </CardContent>
                  </Card>

                  <Card className="rounded-2xl">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">App info</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <HistoryRow label="Mode" value="Tray panel" />
                      <Separator />
                      <HistoryRow label="Theme" value="Dark" />
                      <Separator />
                      <HistoryRow label="Version" value="0.1.0" />
                      <Separator />
                      <HistoryRow label="Author" value="peek" />
                      <Separator />
                      <HistoryRow
                        label="Window"
                        value="Hide to tray on close"
                      />
                    </CardContent>
                  </Card>
                </TabsContent>
              </div>
            </ScrollArea>
          </div>
        </Tabs>
      </div>
    </main>
  );
}

function SmallUsageCard({
  title,
  icon,
  rx,
  tx,
}: {
  title: string;
  icon: React.ReactNode;
  rx: string;
  tx: string;
}) {
  return (
    <Card className="rounded-2xl">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs font-medium">{title}</CardTitle>
        <div className="rounded-md border p-1 text-muted-foreground">
          {icon}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <MiniMetric
          label="Down"
          value={rx}
          icon={<ArrowDown className="h-3 w-3 text-sky-500" />}
        />
        <MiniMetric
          label="Up"
          value={tx}
          icon={<ArrowUp className="h-3 w-3 text-emerald-500" />}
        />
      </CardContent>
    </Card>
  );
}

function MiniMetric({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl border bg-background/40 px-2.5 py-2">
      <div className="rounded-md border bg-card p-1">{icon}</div>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="truncate text-xs font-semibold">{value}</p>
      </div>
    </div>
  );
}

function CompactStat({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-background/40 p-2.5">
      <div className="mb-1 flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="text-[11px]">{label}</span>
      </div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}

function HistoryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

function SettingRow({
  title,
  description,
  control,
}: {
  title: string;
  description: string;
  control: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-[11px] text-muted-foreground">{description}</p>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <Card className="rounded-2xl">
      <CardContent className="flex min-h-24 items-center justify-center text-sm text-muted-foreground">
        {text}
      </CardContent>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="rounded-2xl">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <Skeleton className="h-3.5 w-12" />
                <Skeleton className="h-5 w-5 rounded-md" />
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <Skeleton className="h-10 w-full rounded-xl" />
              <Skeleton className="h-10 w-full rounded-xl" />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="rounded-2xl">
        <CardHeader className="pb-2">
          <Skeleton className="h-4 w-28" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-2 w-full" />
          <div className="grid grid-cols-2 gap-2">
            <Skeleton className="h-14 w-full rounded-xl" />
            <Skeleton className="h-14 w-full rounded-xl" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
