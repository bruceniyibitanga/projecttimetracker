"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type TimerSession = {
  id: string;
  title: string;
  startMs: number; // epoch millis
  endMs: number; // epoch millis
};

const SESSIONS_KEY = "timertrack.sessions.v1";
const RUNNING_KEY = "timertrack.running.v1";

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const hh = hours.toString().padStart(2, "0");
  const mm = minutes.toString().padStart(2, "0");
  const ss = seconds.toString().padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

// Week starts on Monday (ISO week)
function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0..6, Sunday=0
  const diffToMonday = (day === 0 ? -6 : 1) - day; // move to Monday
  d.setDate(d.getDate() + diffToMonday);
  return startOfDay(d);
}

function endOfWeek(date: Date): Date {
  const s = startOfWeek(date);
  const e = new Date(s);
  e.setDate(e.getDate() + 6);
  return endOfDay(e);
}

function clampToRangeOverlap(startA: number, endA: number, startB: number, endB: number): number {
  const start = Math.max(startA, startB);
  const end = Math.min(endA, endB);
  return Math.max(0, end - start);
}

export default function Home() {
  const [taskTitle, setTaskTitle] = useState<string>("");
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [runningStartMs, setRunningStartMs] = useState<number | null>(null);
  const [runningTitle, setRunningTitle] = useState<string>("");
  const [sessions, setSessions] = useState<TimerSession[]>([]);
  const tickRef = useRef<number | null>(null);
  const [, forceTick] = useState<number>(0);

  // Load from localStorage once
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SESSIONS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as TimerSession[];
        if (Array.isArray(parsed)) {
          setSessions(parsed);
        }
      }
      const runningRaw = localStorage.getItem(RUNNING_KEY);
      if (runningRaw) {
        const running = JSON.parse(runningRaw) as {
          isRunning: boolean;
          startMs: number | null;
          title: string;
        };
        if (running && running.isRunning && typeof running.startMs === "number") {
          setIsRunning(true);
          setRunningStartMs(running.startMs);
          setRunningTitle(running.title || "");
          setTaskTitle(running.title || "");
        }
      }
    } catch {
      // ignore corrupted storage
    }
  }, []);

  // Persist sessions
  useEffect(() => {
    try {
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
    } catch {
      // ignore
    }
  }, [sessions]);

  // Persist running state
  useEffect(() => {
    try {
      localStorage.setItem(
        RUNNING_KEY,
        JSON.stringify({ isRunning, startMs: runningStartMs, title: isRunning ? runningTitle || taskTitle : "" })
      );
    } catch {
      // ignore
    }
  }, [isRunning, runningStartMs, runningTitle, taskTitle]);

  // Ticking every second while running for live UI updates
  useEffect(() => {
    if (isRunning) {
      tickRef.current = window.setInterval(() => {
        forceTick((v) => v + 1);
      }, 1000);
      return () => {
        if (tickRef.current) {
          clearInterval(tickRef.current);
        }
      };
    } else {
      if (tickRef.current) {
        clearInterval(tickRef.current);
      }
    }
    return;
  }, [isRunning]);

  const nowMs = Date.now();
  const liveElapsedMs = isRunning && runningStartMs ? nowMs - runningStartMs : 0;

  const handleStart = useCallback(() => {
    if (isRunning) return;
    const title = taskTitle.trim() || "Untitled Task";
    setRunningTitle(title);
    setRunningStartMs(Date.now());
    setIsRunning(true);
  }, [isRunning, taskTitle]);

  const handlePause = useCallback(() => {
    if (!isRunning || runningStartMs == null) return;
    const end = Date.now();
    const newSession: TimerSession = {
      id: `${runningStartMs}-${end}`,
      title: taskTitle.trim() || runningTitle || "Untitled Task",
      startMs: runningStartMs,
      endMs: end,
    };
    setSessions((prev) => [newSession, ...prev]);
    setIsRunning(false);
    setRunningStartMs(null);
    setRunningTitle("");
  }, [isRunning, runningStartMs, taskTitle, runningTitle]);

  const handleToggle = useCallback(() => {
    if (isRunning) {
      handlePause();
    } else {
      handleStart();
    }
  }, [isRunning, handlePause, handleStart]);

  // Date ranges
  const todayStart = useMemo(() => startOfDay(new Date()), []);
  const todayEnd = useMemo(() => endOfDay(new Date()), []);
  const weekStart = useMemo(() => startOfWeek(new Date()), []);
  const weekEnd = useMemo(() => endOfWeek(new Date()), []);

  // Compute totals
  const { todayTotalMs, weekTotalMs, perTaskWeekTotals } = useMemo(() => {
    const sessionsInRange = (start: number, end: number) =>
      sessions.filter((s) => Math.max(s.startMs, start) <= Math.min(s.endMs, end));

    const todaySessions = sessionsInRange(todayStart.getTime(), todayEnd.getTime());
    const weekSessions = sessionsInRange(weekStart.getTime(), weekEnd.getTime());

    const durations = (list: TimerSession[], start: number, end: number) =>
      list.reduce((acc, s) => acc + clampToRangeOverlap(s.startMs, s.endMs, start, end), 0);

    const todayTotal = durations(todaySessions, todayStart.getTime(), todayEnd.getTime());
    const weekTotal = durations(weekSessions, weekStart.getTime(), weekEnd.getTime());

    const perTask = new Map<string, number>();
    for (const s of weekSessions) {
      const overlap = clampToRangeOverlap(s.startMs, s.endMs, weekStart.getTime(), weekEnd.getTime());
      perTask.set(s.title, (perTask.get(s.title) || 0) + overlap);
    }

    return {
      todayTotalMs: todayTotal + (isRunning ? clampToRangeOverlap(runningStartMs ?? 0, nowMs, todayStart.getTime(), todayEnd.getTime()) : 0),
      weekTotalMs: weekTotal + (isRunning ? clampToRangeOverlap(runningStartMs ?? 0, nowMs, weekStart.getTime(), weekEnd.getTime()) : 0),
      perTaskWeekTotals: perTask,
    };
  }, [sessions, todayStart, todayEnd, weekStart, weekEnd, isRunning, runningStartMs, nowMs]);

  const weekSessionsSorted = useMemo(() => {
    const start = weekStart.getTime();
    const end = weekEnd.getTime();
    return sessions
      .filter((s) => Math.max(s.startMs, start) <= Math.min(s.endMs, end))
      .sort((a, b) => b.startMs - a.startMs);
  }, [sessions, weekStart, weekEnd]);

  // Export
  const exportJSON = useCallback(() => {
    const totals: { task: string; totalMs: number }[] = Array.from(perTaskWeekTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([task, totalMs]) => ({ task, totalMs }));

    const payload = {
      weekStartISO: weekStart.toISOString(),
      weekEndISO: weekEnd.toISOString(),
      totalsByTask: totals,
      sessions: weekSessionsSorted,
      generatedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `timertrack-week-${weekStart.toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [perTaskWeekTotals, weekStart, weekEnd, weekSessionsSorted]);

  const exportCSV = useCallback(() => {
    const rows: string[] = [];
    rows.push(`Week Start,${weekStart.toISOString()}`);
    rows.push(`Week End,${weekEnd.toISOString()}`);
    rows.push("");
    rows.push("Task,Total (ms),Total (hh:mm:ss)");
    const entries = Array.from(perTaskWeekTotals.entries()).sort((a, b) => b[1] - a[1]);
    for (const [task, totalMs] of entries) {
      rows.push(`${escapeCsv(task)},${totalMs},${formatDuration(totalMs)}`);
    }
    const csv = rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `timertrack-week-${weekStart.toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [perTaskWeekTotals, weekStart, weekEnd]);

  return (
    <div className="min-h-screen w-full bg-neutral-50 text-neutral-900">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <header className="mb-8 flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">TimerTrack</h1>
          <div className="flex gap-2">
            <button
              onClick={exportCSV}
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
            >
              Export CSV (week)
            </button>
            <button
              onClick={exportJSON}
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
            >
              Export JSON (week)
            </button>
          </div>
        </header>

        <section className="mb-6 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="flex flex-col gap-2">
            <label htmlFor="task" className="text-sm text-gray-600">
              Task title
            </label>
            <input
              id="task"
              type="text"
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              placeholder="What are you working on?"
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-900"
            />
          </div>

          <button
            onClick={handleToggle}
            className={`h-11 rounded-md px-6 font-medium text-white transition-colors ${
              isRunning ? "bg-amber-600 hover:bg-amber-700" : "bg-neutral-900 hover:bg-neutral-800"
            }`}
          >
            {isRunning ? "Pause" : "Start"}
          </button>
        </section>

        <section className="mb-8 rounded-lg border border-neutral-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-600">Current task</div>
              <div className="text-lg font-semibold">
                {isRunning ? runningTitle || taskTitle || "Untitled Task" : taskTitle || "—"}
              </div>
            </div>
            <div className="text-3xl font-mono tabular-nums">
              {isRunning ? formatDuration(liveElapsedMs) : "00:00:00"}
            </div>
          </div>
        </section>

        <section className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-neutral-200 bg-white p-4">
            <div className="text-sm text-gray-600">Today total</div>
            <div className="text-2xl font-mono tabular-nums">{formatDuration(todayTotalMs)}</div>
          </div>
          <div className="rounded-lg border border-neutral-200 bg-white p-4">
            <div className="text-sm text-gray-600">This week total</div>
            <div className="text-2xl font-mono tabular-nums">{formatDuration(weekTotalMs)}</div>
          </div>
          <div className="rounded-lg border border-neutral-200 bg-white p-4">
            <div className="text-sm text-gray-600">Running</div>
            <div className="text-2xl font-mono tabular-nums">{isRunning ? "Yes" : "No"}</div>
          </div>
        </section>

        <section className="mb-8">
          <h2 className="mb-3 text-lg font-semibold">This week by task</h2>
          {perTaskWeekTotals.size === 0 && !isRunning ? (
            <div className="text-sm text-gray-600">No tracked time this week yet.</div>
          ) : (
            <div className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
              {Array.from(perTaskWeekTotals.entries())
                .sort((a, b) => b[1] - a[1])
                .map(([task, ms]) => (
                  <div key={task} className="flex items-center justify-between px-4 py-3">
                    <div className="truncate pr-4">{task}</div>
                    <div className="font-mono tabular-nums">{formatDuration(ms)}</div>
                  </div>
                ))}
              {isRunning && (
                <div className="flex items-center justify-between bg-amber-50 px-4 py-3">
                  <div className="truncate pr-4">{runningTitle || taskTitle || "Untitled Task"} (running)</div>
                  <div className="font-mono tabular-nums">{formatDuration(liveElapsedMs)}</div>
                </div>
              )}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">This week sessions</h2>
          {weekSessionsSorted.length === 0 ? (
            <div className="text-sm text-gray-600">No sessions recorded this week.</div>
          ) : (
            <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
              {weekSessionsSorted.map((s) => {
                const duration = s.endMs - s.startMs;
                const start = new Date(s.startMs);
                const end = new Date(s.endMs);
                return (
                  <li key={s.id} className="px-4 py-3">
                    <div className="flex items-center justify-between">
                      <div className="min-w-0 pr-4">
                        <div className="truncate font-medium">{s.title}</div>
                        <div className="text-xs text-gray-600">
                          {start.toLocaleString()} → {end.toLocaleString()}
                        </div>
                      </div>
                      <div className="font-mono tabular-nums">{formatDuration(duration)}</div>
                    </div>
                  </li>
                );
              })}
              {isRunning && runningStartMs && (
                <li className="bg-amber-50 px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 pr-4">
                      <div className="truncate font-medium">{runningTitle || taskTitle || "Untitled Task"} (running)</div>
                      <div className="text-xs text-amber-700">
                        {new Date(runningStartMs).toLocaleString()} → running…
                      </div>
                    </div>
                    <div className="font-mono tabular-nums">{formatDuration(liveElapsedMs)}</div>
                  </div>
                </li>
              )}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function escapeCsv(value: string): string {
  if (/[",\n]/.test(value)) {
    return '"' + value.replaceAll('"', '""') + '"';
  }
  return value;
}
