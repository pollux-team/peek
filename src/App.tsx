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
  ChevronLeft,
  ChevronRight,
  Clock3,
  DownloadCloud,
  History,
  Minimize2,
  RefreshCw,
  TrendingUp,
  X,
} from "lucide-react";

import appLogo from "./assets/icon.svg";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import "./index.css";

// ─── Types ────────────────────────────────────────────────────────────────────

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

interface MonthOption {
  value: string;
  label: string;
}

interface MonthDayUsage extends Usage {
  date: string;
  day: number;
  total: number;
  isActive: boolean;
}

interface MonthHistoryReport {
  month: string;
  label: string;
  totals: Usage;
  totalDays: number;
  activeDays: number;
  busiestDay: MonthDayUsage | null;
  days: MonthDayUsage[];
}

type SqlValue = number | string | null | undefined;

interface SqlUsageRow {
  rx: SqlValue;
  tx: SqlValue;
}

interface SqlMonthRow {
  month: string | null;
}

interface SqlMonthSummaryRow extends SqlUsageRow {
  active_days: SqlValue;
}

interface SqlDayRow {
  date: string;
  rx: SqlValue;
  tx: SqlValue;
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

let dbPromise: Promise<Database> | null = null;

async function getDb() {
  if (!dbPromise) dbPromise = Database.load("sqlite:overlay.db");
  return dbPromise;
}

function toNumber(value: SqlValue) {
  return Number(value ?? 0);
}

function toUsage(row?: SqlUsageRow): Usage {
  return { rx: toNumber(row?.rx), tx: toNumber(row?.tx) };
}

async function selectUsage(query: string, bindValues?: unknown[]) {
  const db = await getDb();
  const rows = await db.select<SqlUsageRow[]>(query, bindValues);
  return toUsage(rows[0]);
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function parseMonthKey(month: string) {
  const [year, mm] = month.split("-").map(Number);
  return { year, monthIndex: mm - 1 };
}

function getDaysInMonth(month: string) {
  const { year, monthIndex } = parseMonthKey(month);
  return new Date(year, monthIndex + 1, 0).getDate();
}

function formatMonthLabel(month: string) {
  const { year, monthIndex } = parseMonthKey(month);
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
  }).format(new Date(year, monthIndex, 1, 12));
}

function fillMonthDays(month: string, rows: SqlDayRow[]): MonthDayUsage[] {
  const totalDays = getDaysInMonth(month);
  const byDate = new Map(
    rows.map((row) => [row.date, { rx: toNumber(row.rx), tx: toNumber(row.tx) }]),
  );

  return Array.from({ length: totalDays }, (_, index) => {
    const day = index + 1;
    const date = `${month}-${String(day).padStart(2, "0")}`;
    const usage = byDate.get(date) ?? { rx: 0, tx: 0 };
    const total = usage.rx + usage.tx;
    return { date, day, rx: usage.rx, tx: usage.tx, total, isActive: total > 0 };
  });
}

function formatTime(date: Date | null) {
  if (!date) return "—";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatDayLabel(dateString: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "2-digit",
  }).format(new Date(`${dateString}T12:00:00`));
}

function formatShortDate(dateString: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(`${dateString}T12:00:00`));
}

function formatBytes(bytes: number) {
  if (!bytes || bytes <= 0) return "0 B";
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), sizes.length - 1);
  const value = bytes / Math.pow(1024, i);
  const decimals = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${parseFloat(value.toFixed(decimals))} ${sizes[i]}`;
}

// ─── API ──────────────────────────────────────────────────────────────────────

const api = {
  async getAutostartEnabled(): Promise<boolean | null> {
    try {
      return await invoke<boolean>("is_autostart_enabled");
    } catch {
      return null;
    }
  },

  async setAutostartEnabled(enabled: boolean) {
    await invoke("set_autostart_enabled", { enabled });
  },

  async getUsageOverview(): Promise<UsageReport> {
    const [today, week, month, allTime] = await Promise.all([
      selectUsage(
        `SELECT COALESCE(SUM(rx_bytes),0) AS rx, COALESCE(SUM(tx_bytes),0) AS tx
         FROM network_usage WHERE date = date('now','localtime')`,
      ),
      selectUsage(
        `SELECT COALESCE(SUM(rx_bytes),0) AS rx, COALESCE(SUM(tx_bytes),0) AS tx
         FROM network_usage WHERE date >= date('now','localtime','-6 days')`,
      ),
      selectUsage(
        `SELECT COALESCE(SUM(rx_bytes),0) AS rx, COALESCE(SUM(tx_bytes),0) AS tx
         FROM network_usage WHERE date >= date('now','localtime','-29 days')`,
      ),
      selectUsage(
        `SELECT COALESCE(SUM(rx_bytes),0) AS rx, COALESCE(SUM(tx_bytes),0) AS tx
         FROM network_usage`,
      ),
    ]);
    return { today, week, month, all_time: allTime };
  },

  async getAvailableMonths(): Promise<MonthOption[]> {
    const db = await getDb();
    const rows = await db.select<SqlMonthRow[]>(
      `SELECT DISTINCT strftime('%Y-%m', date) AS month
       FROM network_usage WHERE date IS NOT NULL ORDER BY month DESC`,
    );
    const monthMap = new Map<string, MonthOption>();
    for (const row of rows) {
      if (!row.month) continue;
      monthMap.set(row.month, { value: row.month, label: formatMonthLabel(row.month) });
    }
    const current = currentMonthKey();
    if (!monthMap.has(current)) {
      monthMap.set(current, { value: current, label: formatMonthLabel(current) });
    }
    return Array.from(monthMap.values()).sort((a, b) =>
      a.value < b.value ? 1 : a.value > b.value ? -1 : 0,
    );
  },

  async getMonthHistory(month: string): Promise<MonthHistoryReport> {
    const db = await getDb();
    const [summaryRows, dailyRows] = await Promise.all([
      db.select<SqlMonthSummaryRow[]>(
        `SELECT COALESCE(SUM(rx_bytes),0) AS rx, COALESCE(SUM(tx_bytes),0) AS tx,
                COUNT(DISTINCT date) AS active_days
         FROM network_usage WHERE strftime('%Y-%m', date) = ?`,
        [month],
      ),
      db.select<SqlDayRow[]>(
        `SELECT date, COALESCE(SUM(rx_bytes),0) AS rx, COALESCE(SUM(tx_bytes),0) AS tx
         FROM network_usage WHERE strftime('%Y-%m', date) = ?
         GROUP BY date ORDER BY date ASC`,
        [month],
      ),
    ]);
    const days = fillMonthDays(month, dailyRows);
    const totals = toUsage(summaryRows[0]);
    const busiestDay = days.reduce<MonthDayUsage | null>((best, day) => {
      if (day.total <= 0) return best;
      if (!best) return day;
      return day.total > best.total ? day : best;
    }, null);
    return {
      month,
      label: formatMonthLabel(month),
      totals,
      totalDays: days.length,
      activeDays: days.filter((d) => d.isActive).length,
      busiestDay,
      days,
    };
  },
};

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<UsageReport | null>(null);
  const [availableMonths, setAvailableMonths] = useState<MonthOption[]>([]);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [monthHistory, setMonthHistory] = useState<MonthHistoryReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [monthLoading, setMonthLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [monthError, setMonthError] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState("Not checked yet");
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  const bootstrap = async () => {
    try {
      setLoading(true);
      setLoadError(null);
      setMonthError(null);
      const [autostartValue, usageData, months] = await Promise.all([
        api.getAutostartEnabled(),
        api.getUsageOverview(),
        api.getAvailableMonths(),
      ]);
      const initialMonth = months[0]?.value ?? currentMonthKey();
      const monthData = await api.getMonthHistory(initialMonth);
      setAutostart(autostartValue);
      setUsage(usageData);
      setAvailableMonths(months);
      setSelectedMonth(initialMonth);
      setMonthHistory(monthData);
      setLastSyncedAt(new Date());
    } catch (e) {
      console.error("Failed to bootstrap app:", e);
      setLoadError("Could not load local usage data.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const fetchUsage = async () => {
    try {
      setRefreshing(true);
      setLoadError(null);
      setMonthError(null);
      const [usageData, months] = await Promise.all([
        api.getUsageOverview(),
        api.getAvailableMonths(),
      ]);
      const nextMonth =
        months.find((m) => m.value === selectedMonth)?.value ??
        months[0]?.value ??
        currentMonthKey();
      const monthData = await api.getMonthHistory(nextMonth);
      setUsage(usageData);
      setAvailableMonths(months);
      setSelectedMonth(nextMonth);
      setMonthHistory(monthData);
      setLastSyncedAt(new Date());
    } catch (e) {
      console.error("Failed to fetch usage:", e);
      setLoadError("Refresh failed. Try again.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const loadSelectedMonth = async (month: string) => {
    try {
      setMonthLoading(true);
      setMonthError(null);
      setSelectedMonth(month);
      const data = await api.getMonthHistory(month);
      setMonthHistory(data);
    } catch (e) {
      console.error("Failed to load month history:", e);
      setMonthError("Could not load the selected month.");
    } finally {
      setMonthLoading(false);
    }
  };

  useEffect(() => {
    document.documentElement.classList.add("dark");
    bootstrap();
  }, []);

  async function toggleAutostart(checked: boolean) {
    try {
      setAutostart(checked);
      await api.setAutostartEnabled(checked);
    } catch {
      setAutostart(!checked);
    }
  }

  async function minimizeWindow() {
    try {
      await getCurrentWindow().minimize();
    } catch (e) {
      console.error("Failed to minimize:", e);
    }
  }

  async function closeWindow() {
    try {
      await getCurrentWindow().hide();
    } catch (e) {
      console.error("Failed to hide:", e);
      try {
        await getCurrentWindow().minimize();
      } catch { }
    }
  }

  async function checkForUpdates() {
    try {
      setCheckingUpdate(true);
      setUpdateStatus("Checking for updates...");
      const update = await check();
      if (update) {
        setUpdateStatus(`Downloading v${update.version}...`);
        let downloaded = 0;
        let contentLength = 0;
        await update.downloadAndInstall((event) => {
          switch (event.event) {
            case "Started":
              contentLength = event.data.contentLength || 0;
              setUpdateStatus(`Downloading v${update.version}...`);
              break;
            case "Progress":
              downloaded += event.data.chunkLength;
              if (contentLength > 0) {
                const pct = Math.round((downloaded / contentLength) * 100);
                setUpdateStatus(`Downloading update... ${pct}%`);
              } else {
                setUpdateStatus("Downloading update...");
              }
              break;
            case "Finished":
              setUpdateStatus("Installing update...");
              break;
          }
        });
        setUpdateStatus("Relaunching...");
        await relaunch();
      } else {
        setUpdateStatus("App is up to date");
        setTimeout(() => setUpdateStatus("Not checked yet"), 3000);
      }
    } catch (error) {
      console.error(error);
      setUpdateStatus("Update failed");
      setTimeout(() => setUpdateStatus("Not checked yet"), 3000);
    } finally {
      setCheckingUpdate(false);
    }
  }

  // ── Derived state ────────────────────────────────────────────────────────────

  const todayTotal = useMemo(
    () => (usage ? usage.today.rx + usage.today.tx : 0),
    [usage],
  );

  const downloadShare = useMemo(() => {
    if (!usage) return 0;
    const total = usage.all_time.rx + usage.all_time.tx;
    return total === 0 ? 0 : Math.round((usage.all_time.rx / total) * 100);
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
    return periods.reduce((max, p) => (p.total > max.total ? p : max), periods[0]);
  }, [usage]);

  const overviewRows = useMemo(() => {
    if (!usage) return [];
    return [
      {
        name: "Today",
        icon: <CalendarDays className="h-3.5 w-3.5" />,
        total: usage.today.rx + usage.today.tx,
        rx: usage.today.rx,
        tx: usage.today.tx,
      },
      {
        name: "7 Days",
        icon: <TrendingUp className="h-3.5 w-3.5" />,
        total: usage.week.rx + usage.week.tx,
        rx: usage.week.rx,
        tx: usage.week.tx,
      },
      {
        name: "30 Days",
        icon: <Clock3 className="h-3.5 w-3.5" />,
        total: usage.month.rx + usage.month.tx,
        rx: usage.month.rx,
        tx: usage.month.tx,
      },
      {
        name: "All Time",
        icon: <History className="h-3.5 w-3.5" />,
        total: usage.all_time.rx + usage.all_time.tx,
        rx: usage.all_time.rx,
        tx: usage.all_time.tx,
      },
    ];
  }, [usage]);

  const maxOverviewTotal = useMemo(
    () => Math.max(...overviewRows.map((r) => r.total), 1),
    [overviewRows],
  );

  const monthDownloadShare = useMemo(() => {
    if (!monthHistory) return 0;
    const total = monthHistory.totals.rx + monthHistory.totals.tx;
    return total === 0 ? 0 : Math.round((monthHistory.totals.rx / total) * 100);
  }, [monthHistory]);

  const monthUploadShare = 100 - monthDownloadShare;

  const activeMonthDays = useMemo(
    () => (monthHistory ? monthHistory.days.filter((d) => d.total > 0).slice().reverse() : []),
    [monthHistory],
  );

  const maxMonthDayTotal = useMemo(
    () => Math.max(...activeMonthDays.map((d) => d.total), 1),
    [activeMonthDays],
  );

  const selectedMonthIndex = useMemo(
    () => availableMonths.findIndex((m) => m.value === selectedMonth),
    [availableMonths, selectedMonth],
  );

  const canGoOlder = selectedMonthIndex >= 0 && selectedMonthIndex < availableMonths.length - 1;
  const canGoNewer = selectedMonthIndex > 0;

  function goOlderMonth() {
    if (!canGoOlder) return;
    const next = availableMonths[selectedMonthIndex + 1];
    if (next) loadSelectedMonth(next.value);
  }

  function goNewerMonth() {
    if (!canGoNewer) return;
    const next = availableMonths[selectedMonthIndex - 1];
    if (next) loadSelectedMonth(next.value);
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <TooltipProvider delayDuration={200}>
      <main className="h-screen overflow-hidden bg-transparent text-foreground select-none">
        <div className="mx-auto flex h-screen w-full max-w-[420px] flex-col overflow-hidden rounded-[22px] border bg-card shadow-2xl">

          {/* ── Title bar ──────────────────────────────────────────────────── */}
          <div
            className="flex items-center justify-between border-b px-3 py-2.5"
            data-tauri-drag-region
          >
            <div className="flex min-w-0 flex-1 items-center gap-2.5" data-tauri-drag-region>
              <img
                src={appLogo}
                alt="peek logo"
                className="h-7 w-7 object-contain pointer-events-none"
                draggable={false}
                data-tauri-drag-region
              />

              <div className="min-w-0" data-tauri-drag-region>
                <div className="text-sm font-semibold tracking-tight" data-tauri-drag-region>
                  peek
                </div>
                <div className="text-[10px] text-muted-foreground" data-tauri-drag-region>
                  compact network tray
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label="Minimize window"
                    onClick={(e) => { e.stopPropagation(); minimizeWindow(); }}
                  >
                    <Minimize2 className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">Minimize</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 hover:bg-destructive/15 hover:text-destructive"
                    aria-label="Hide window"
                    onClick={(e) => { e.stopPropagation(); closeWindow(); }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">Hide to tray</TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* ── Tabs ───────────────────────────────────────────────────────── */}
          <Tabs defaultValue="overview" className="flex min-h-0 flex-1 flex-col">
            <div className="border-b px-3 py-2">
              <TabsList className="grid h-8 w-full grid-cols-3 rounded-lg">
                <TabsTrigger value="overview" className="text-xs">Overview</TabsTrigger>
                <TabsTrigger value="history" className="text-xs">History</TabsTrigger>
                <TabsTrigger value="settings" className="text-xs">Settings</TabsTrigger>
              </TabsList>
            </div>

            <div className="min-h-0 flex-1">
              <ScrollArea className="h-full">
                <div className="space-y-3 p-3">

                  {/* ── Overview tab ─────────────────────────────────────── */}
                  <TabsContent value="overview" className="mt-0 space-y-3">
                    {loading ? (
                      <DashboardSkeleton />
                    ) : loadError ? (
                      <RetryState text={loadError} onRetry={fetchUsage} />
                    ) : usage ? (
                      <>
                        {/* Today hero card */}
                        <Card className="rounded-2xl">
                          <CardHeader className="pb-2">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                                  Today
                                </p>
                                <CardTitle className="mt-1 text-xl tracking-tight">
                                  {formatBytes(todayTotal)}
                                </CardTitle>
                              </div>
                              <div className="text-right">
                                <p className="text-[10px] text-muted-foreground">Last sync</p>
                                <p className="text-xs font-medium">{formatTime(lastSyncedAt)}</p>
                              </div>
                            </div>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            <TrafficSplitBar rx={usage.today.rx} tx={usage.today.tx} />
                            <div className="grid grid-cols-2 gap-2">
                              <CompactStat
                                label="Download"
                                value={formatBytes(usage.today.rx)}
                                icon={<ArrowDown className="h-3.5 w-3.5 text-primary" />}
                              />
                              <CompactStat
                                label="Upload"
                                value={formatBytes(usage.today.tx)}
                                icon={<ArrowUp className="h-3.5 w-3.5 text-primary-foreground" />}
                              />
                            </div>
                            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                              <span>All-time split</span>
                              <span>{downloadShare}% down · {uploadShare}% up</span>
                            </div>
                          </CardContent>
                        </Card>

                        {/* Usage windows card */}
                        <Card className="rounded-2xl">
                          <CardHeader className="pb-2">
                            <div className="flex items-center justify-between gap-3">
                              <CardTitle className="text-sm">Usage windows</CardTitle>
                              <Badge variant="secondary" className="text-[10px] font-normal">
                                Strongest: {strongestPeriod?.name ?? "—"}
                              </Badge>
                            </div>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            {overviewRows.map((row, index) => (
                              <div key={row.name}>
                                <UsageWindowRow
                                  label={row.name}
                                  icon={row.icon}
                                  total={row.total}
                                  rx={row.rx}
                                  tx={row.tx}
                                  maxTotal={maxOverviewTotal}
                                />
                                {index < overviewRows.length - 1 && (
                                  <Separator className="mt-3" />
                                )}
                              </div>
                            ))}
                          </CardContent>
                        </Card>
                      </>
                    ) : (
                      <EmptyState text="No usage data found." />
                    )}
                  </TabsContent>

                  {/* ── History tab ──────────────────────────────────────── */}
                  <TabsContent value="history" className="mt-0 space-y-3">
                    {loading ? (
                      <HistorySkeleton />
                    ) : loadError ? (
                      <RetryState text={loadError} onRetry={fetchUsage} />
                    ) : (
                      <>
                        {/* Month picker card */}
                        <Card className="rounded-2xl">
                          <CardHeader className="pb-2">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <CardTitle className="text-sm">Custom month history</CardTitle>
                                <p className="mt-1 text-[11px] text-muted-foreground">
                                  Inspect any recorded month in detail.
                                </p>
                              </div>
                              {monthLoading && (
                                <Badge variant="outline" className="text-[10px] font-normal shrink-0">
                                  Loading...
                                </Badge>
                              )}
                            </div>
                          </CardHeader>

                          <CardContent className="space-y-3">
                            {/* Month navigator */}
                            <div className="flex items-center gap-2">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="icon"
                                    className="h-8 w-8 shrink-0"
                                    onClick={goOlderMonth}
                                    disabled={!canGoOlder || monthLoading}
                                    aria-label="Older month"
                                  >
                                    <ChevronLeft className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent side="bottom" className="text-xs">Older month</TooltipContent>
                              </Tooltip>

                              <Select
                                value={selectedMonth}
                                onValueChange={loadSelectedMonth}
                                disabled={monthLoading || availableMonths.length === 0}
                              >
                                <SelectTrigger className="h-8 flex-1 text-xs">
                                  <SelectValue placeholder="Select a month" />
                                </SelectTrigger>
                                <SelectContent>
                                  {availableMonths.map((month) => (
                                    <SelectItem
                                      key={month.value}
                                      value={month.value}
                                      className="text-xs"
                                    >
                                      {month.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>

                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="icon"
                                    className="h-8 w-8 shrink-0"
                                    onClick={goNewerMonth}
                                    disabled={!canGoNewer || monthLoading}
                                    aria-label="Newer month"
                                  >
                                    <ChevronRight className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent side="bottom" className="text-xs">Newer month</TooltipContent>
                              </Tooltip>
                            </div>

                            {/* Month content */}
                            {monthError ? (
                              <InlineEmpty text={monthError} />
                            ) : monthHistory ? (
                              <>
                                <div className="grid grid-cols-3 gap-2">
                                  <CompactStat
                                    label="Total"
                                    value={formatBytes(monthHistory.totals.rx + monthHistory.totals.tx)}
                                    icon={<History className="h-3.5 w-3.5 text-muted-foreground" />}
                                  />
                                  <CompactStat
                                    label="Down"
                                    value={formatBytes(monthHistory.totals.rx)}
                                    icon={<ArrowDown className="h-3.5 w-3.5 text-primary" />}
                                  />
                                  <CompactStat
                                    label="Up"
                                    value={formatBytes(monthHistory.totals.tx)}
                                    icon={<ArrowUp className="h-3.5 w-3.5 text-primary-foreground" />}
                                  />
                                </div>

                                <Separator />

                                <div className="space-y-2">
                                  <HistoryRow label="Month" value={monthHistory.label} />
                                  <Separator />
                                  <HistoryRow
                                    label="Active days"
                                    value={`${monthHistory.activeDays}/${monthHistory.totalDays}`}
                                  />
                                  <Separator />
                                  <HistoryRow
                                    label="Traffic split"
                                    value={`${monthDownloadShare}% / ${monthUploadShare}%`}
                                  />
                                  <Separator />
                                  <HistoryRow
                                    label="Busiest day"
                                    value={
                                      monthHistory.busiestDay
                                        ? `${formatShortDate(monthHistory.busiestDay.date)} · ${formatBytes(monthHistory.busiestDay.total)}`
                                        : "—"
                                    }
                                  />
                                </div>
                              </>
                            ) : (
                              <InlineEmpty text="Select a month to load detailed history." />
                            )}
                          </CardContent>
                        </Card>

                        {/* Daily activity bars */}
                        <Card className="rounded-2xl">
                          <CardHeader className="pb-2">
                            <CardTitle className="text-sm">Daily activity</CardTitle>
                          </CardHeader>
                          <CardContent>
                            {monthLoading && !monthHistory ? (
                              <div className="space-y-2">
                                <Skeleton className="h-24 w-full rounded-xl" />
                                <Skeleton className="h-3 w-16" />
                              </div>
                            ) : monthHistory ? (
                              monthHistory.activeDays > 0 ? (
                                <MonthActivityBars days={monthHistory.days} />
                              ) : (
                                <InlineEmpty text="No traffic was recorded for this month." />
                              )
                            ) : (
                              <InlineEmpty text="Month history is not available." />
                            )}
                          </CardContent>
                        </Card>

                        {/* Detailed day rows */}
                        <Card className="rounded-2xl">
                          <CardHeader className="pb-2">
                            <div className="flex items-center justify-between gap-3">
                              <CardTitle className="text-sm">Detailed days</CardTitle>
                              <Badge variant="secondary" className="text-[10px] font-normal">
                                {activeMonthDays.length} active
                              </Badge>
                            </div>
                          </CardHeader>
                          <CardContent className="space-y-2">
                            {monthLoading && !monthHistory ? (
                              Array.from({ length: 5 }).map((_, i) => (
                                <Skeleton key={i} className="h-16 w-full rounded-xl" />
                              ))
                            ) : activeMonthDays.length > 0 ? (
                              activeMonthDays.map((day) => (
                                <MonthDayRow
                                  key={day.date}
                                  day={day}
                                  maxTotal={maxMonthDayTotal}
                                />
                              ))
                            ) : (
                              <InlineEmpty text="No active days to show for the selected month." />
                            )}
                          </CardContent>
                        </Card>
                      </>
                    )}
                  </TabsContent>

                  {/* ── Settings tab ─────────────────────────────────────── */}
                  <TabsContent value="settings" className="mt-0 space-y-3">
                    {/* General */}
                    <Card className="rounded-2xl">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">General</CardTitle>
                      </CardHeader>
                      <CardContent>
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
                      </CardContent>
                    </Card>

                    {/* Maintenance */}
                    <Card className="rounded-2xl">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Maintenance</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <SettingRow
                          title="Refresh data"
                          description={
                            refreshing
                              ? "Reloading usage from the database..."
                              : "Reload current usage and month history"
                          }
                          control={
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 gap-2 text-xs"
                              onClick={fetchUsage}
                              disabled={refreshing}
                            >
                              <RefreshCw
                                className={`h-3.5 w-3.5 ${refreshing ? "animate-spin text-primary" : ""}`}
                              />
                              Refresh
                            </Button>
                          }
                        />

                        <Separator />

                        <SettingRow
                          title="Software update"
                          description={updateStatus}
                          control={
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 gap-2 text-xs bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground border-primary/20"
                              onClick={checkForUpdates}
                              disabled={checkingUpdate}
                            >
                              <DownloadCloud className="h-3.5 w-3.5" />
                              {checkingUpdate ? "Working..." : "Check now"}
                            </Button>
                          }
                        />
                      </CardContent>
                    </Card>

                    {/* App info */}
                    <Card className="rounded-2xl">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">App info</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        <HistoryRow label="Mode" value="Tray panel" />
                        <Separator />
                        <HistoryRow label="Theme" value="Dark" />
                        <Separator />
                        <HistoryRow label="Version" value="0.4.0" />
                        <Separator />
                        <HistoryRow label="Viewport" value="420 × 620 fixed" />
                        <Separator />
                        <HistoryRow label="Window" value="Hide to tray on close" />
                      </CardContent>
                    </Card>
                  </TabsContent>

                </div>
              </ScrollArea>
            </div>
          </Tabs>
        </div>
      </main>
    </TooltipProvider>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function UsageWindowRow({
  label,
  icon,
  total,
  rx,
  tx,
  maxTotal,
}: {
  label: string;
  icon: React.ReactNode;
  total: number;
  rx: number;
  tx: number;
  maxTotal: number;
}) {
  const pct = maxTotal > 0 ? Math.max(6, (total / maxTotal) * 100) : 6;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="rounded-md border bg-background/40 p-1 text-muted-foreground">
            {icon}
          </div>
          <span className="text-sm font-medium">{label}</span>
        </div>
        <span className="text-sm font-semibold tabular-nums">{formatBytes(total)}</span>
      </div>

      <Progress value={pct} className="h-1.5" />

      <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <ArrowDown className="h-3 w-3 text-primary" />
          {formatBytes(rx)}
        </span>
        <span className="inline-flex items-center gap-1">
          <ArrowUp className="h-3 w-3 text-primary-foreground" />
          {formatBytes(tx)}
        </span>
      </div>
    </div>
  );
}

function TrafficSplitBar({ rx, tx }: { rx: number; tx: number }) {
  const total = rx + tx;
  const rxPct = total > 0 ? (rx / total) * 100 : 50;
  const txPct = total > 0 ? (tx / total) * 100 : 50;

  return (
    <div className="space-y-2">
      <div className="h-2.5 overflow-hidden rounded-full bg-muted/40 flex">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${rxPct}%`, opacity: total > 0 ? 1 : 0.35 }}
        />
        <div
          className="h-full bg-primary-foreground transition-all"
          style={{ width: `${txPct}%`, opacity: total > 0 ? 1 : 0.35 }}
        />
      </div>
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>Download / Upload</span>
        <span>{Math.round(rxPct)}% / {Math.round(txPct)}%</span>
      </div>
    </div>
  );
}

function MonthActivityBars({ days }: { days: MonthDayUsage[] }) {
  const max = Math.max(...days.map((d) => d.total), 1);

  return (
    <div className="space-y-3">
      <div className="flex h-24 items-end gap-[3px]">
        {days.map((day) => {
          const height = day.total > 0 ? Math.max(10, (day.total / max) * 100) : 6;

          return (
            <Tooltip key={day.date}>
              <TooltipTrigger asChild>
                <div
                  className="flex h-full flex-1 cursor-default items-end overflow-hidden rounded-sm bg-muted/30"
                >
                  <div
                    className={`w-full rounded-sm transition-colors ${day.total > 0
                      ? "bg-foreground/75 hover:bg-foreground"
                      : "bg-muted/50"
                      }`}
                    style={{ height: `${height}%` }}
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                className="flex flex-col gap-0.5 p-2 text-xs"
              >
                <span className="font-semibold">{formatShortDate(day.date)}</span>
                {day.total > 0 ? (
                  <>
                    <span className="text-muted-foreground">
                      Total: <span className="text-foreground font-medium">{formatBytes(day.total)}</span>
                    </span>
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <ArrowDown className="h-3 w-3 text-primary" />
                      {formatBytes(day.rx)}
                    </span>
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <ArrowUp className="h-3 w-3 text-primary-foreground" />
                      {formatBytes(day.tx)}
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">No activity</span>
                )}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>1</span>
        <span>{days.length}</span>
      </div>
    </div>
  );
}

function MonthDayRow({
  day,
  maxTotal,
}: {
  day: MonthDayUsage;
  maxTotal: number;
}) {
  const pct = maxTotal > 0 ? Math.max(6, (day.total / maxTotal) * 100) : 6;

  return (
    <div className="rounded-xl border bg-background/40 p-2.5 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium">{formatDayLabel(day.date)}</p>
          <div className="mt-1 flex items-center gap-3 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <ArrowDown className="h-3 w-3 text-primary" />
              {formatBytes(day.rx)}
            </span>
            <span className="inline-flex items-center gap-1">
              <ArrowUp className="h-3 w-3 text-primary-foreground" />
              {formatBytes(day.tx)}
            </span>
          </div>
        </div>
        <span className="text-xs font-semibold tabular-nums shrink-0">
          {formatBytes(day.total)}
        </span>
      </div>
      <Progress value={pct} className="h-1.5" />
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
      <p className="text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function HistoryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-right">{value}</span>
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
      <div className="min-w-0 space-y-0.5">
        <Label className="text-sm font-medium leading-none">{title}</Label>
        <p className="text-[11px] text-muted-foreground">{description}</p>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

function InlineEmpty({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed bg-background/30 px-3 py-4 text-center text-xs text-muted-foreground">
      {text}
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

function RetryState({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <Card className="rounded-2xl">
      <CardContent className="flex flex-col items-center justify-center gap-3 py-6 text-center">
        <p className="text-sm text-muted-foreground">{text}</p>
        <Button variant="outline" size="sm" className="h-8 gap-2 text-xs" onClick={onRetry}>
          <RefreshCw className="h-3.5 w-3.5" />
          Try again
        </Button>
      </CardContent>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-3">
      <Card className="rounded-2xl">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between">
            <div>
              <Skeleton className="mb-2 h-3 w-14" />
              <Skeleton className="h-6 w-24" />
            </div>
            <div className="space-y-1">
              <Skeleton className="h-3 w-12" />
              <Skeleton className="h-4 w-16" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-2.5 w-full rounded-full" />
          <div className="grid grid-cols-2 gap-2">
            <Skeleton className="h-14 w-full rounded-xl" />
            <Skeleton className="h-14 w-full rounded-xl" />
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader className="pb-2">
          <Skeleton className="h-4 w-28" />
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i}>
              <Skeleton className="h-12 w-full rounded-xl" />
              {i < 3 && <Separator className="mt-3" />}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function HistorySkeleton() {
  return (
    <div className="space-y-3">
      <Card className="rounded-2xl">
        <CardHeader className="pb-2">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="mt-2 h-3 w-44" />
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-8 rounded-md" />
            <Skeleton className="h-8 flex-1 rounded-md" />
            <Skeleton className="h-8 w-8 rounded-md" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Skeleton className="h-14 rounded-xl" />
            <Skeleton className="h-14 rounded-xl" />
            <Skeleton className="h-14 rounded-xl" />
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader className="pb-2">
          <Skeleton className="h-4 w-24" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 w-full rounded-xl" />
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader className="pb-2">
          <Skeleton className="h-4 w-28" />
        </CardHeader>
        <CardContent className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}