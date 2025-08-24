"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type TimerSession = {
  id: string;
  title: string;
  startMs: number; // epoch millis
  endMs: number; // epoch millis
  tags?: string[]; // optional categorization tags
};

const SESSIONS_KEY = "timertrack.sessions.v1";
const RUNNING_KEY = "timertrack.running.v1";
const TAG_COLORS_KEY = "timertrack.tagcolors.v1";
const POMODORO_SETTINGS_KEY = "timertrack.pomodoro.v1";

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
  const [currentTagsInput, setCurrentTagsInput] = useState<string>("");
  const [showEntryModal, setShowEntryModal] = useState<boolean>(false);
  const [editingSession, setEditingSession] = useState<TimerSession | null>(
    null
  );
  const [entryForm, setEntryForm] = useState<{
    title: string;
    date: string; // yyyy-mm-dd
    startTime: string; // HH:MM
    endTime: string; // HH:MM
    tags: string; // comma-separated
  }>({
    title: "",
    date: formatDateForInput(new Date()),
    startTime: "09:00",
    endTime: "10:00",
    tags: "",
  });
  const [reminderMinutes, setReminderMinutes] = useState<number>(0);
  const reminderIntervalRef = useRef<number | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");
  const [tagColors, setTagColors] = useState<Record<string, string>>({});
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);
  const [showExportModal, setShowExportModal] = useState<boolean>(false);
  const [exportForm, setExportForm] = useState<{
    startDate: string;
    endDate: string;
    tagsCsv: string;
  }>(() => {
    const now = new Date();
    const ws = startOfWeek(now);
    const we = endOfWeek(now);
    return {
      startDate: formatDateForInput(ws),
      endDate: formatDateForInput(we),
      tagsCsv: "",
    };
  });

  // Week navigation
  const [selectedWeekOffset, setSelectedWeekOffset] = useState<number>(0);

  // Pomodoro
  const [pomodoroEnabled, setPomodoroEnabled] = useState<boolean>(false);
  const [pomodoroFocusMin, setPomodoroFocusMin] = useState<number>(25);
  const [pomodoroBreakMin, setPomodoroBreakMin] = useState<number>(5);
  const [pomodoroAutoContinue, setPomodoroAutoContinue] =
    useState<boolean>(true);
  const [pomodoroPhase, setPomodoroPhase] = useState<
    "idle" | "focus" | "break"
  >("idle");
  const [pomodoroEndMs, setPomodoroEndMs] = useState<number | null>(null);
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
        if (
          running &&
          running.isRunning &&
          typeof running.startMs === "number"
        ) {
          setIsRunning(true);
          setRunningStartMs(running.startMs);
          setRunningTitle(running.title || "");
          setTaskTitle(running.title || "");
        }
      }
      const tagsRaw = localStorage.getItem(TAG_COLORS_KEY);
      if (tagsRaw) {
        try {
          const parsed = JSON.parse(tagsRaw) as Record<string, string>;
          if (parsed && typeof parsed === "object") setTagColors(parsed);
        } catch {}
      }
      const pomoRaw = localStorage.getItem(POMODORO_SETTINGS_KEY);
      if (pomoRaw) {
        try {
          const p = JSON.parse(pomoRaw) as {
            enabled?: boolean;
            focus?: number;
            break?: number;
            auto?: boolean;
          };
          if (p) {
            if (typeof p.enabled === "boolean") setPomodoroEnabled(p.enabled);
            if (typeof p.focus === "number") setPomodoroFocusMin(p.focus);
            if (typeof p.break === "number") setPomodoroBreakMin(p.break);
            if (typeof p.auto === "boolean") setPomodoroAutoContinue(p.auto);
          }
        } catch {}
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
        JSON.stringify({
          isRunning,
          startMs: runningStartMs,
          title: isRunning ? runningTitle || taskTitle : "",
        })
      );
    } catch {
      // ignore
    }
  }, [isRunning, runningStartMs, runningTitle, taskTitle]);

  // Persist tag colors and pomodoro settings
  useEffect(() => {
    try {
      localStorage.setItem(TAG_COLORS_KEY, JSON.stringify(tagColors));
    } catch {}
  }, [tagColors]);
  useEffect(() => {
    try {
      localStorage.setItem(
        POMODORO_SETTINGS_KEY,
        JSON.stringify({
          enabled: pomodoroEnabled,
          focus: pomodoroFocusMin,
          break: pomodoroBreakMin,
          auto: pomodoroAutoContinue,
        })
      );
    } catch {}
  }, [
    pomodoroEnabled,
    pomodoroFocusMin,
    pomodoroBreakMin,
    pomodoroAutoContinue,
  ]);

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
  const liveElapsedMs =
    isRunning && runningStartMs ? nowMs - runningStartMs : 0;

  const handleStart = useCallback(() => {
    if (isRunning) return;
    const title = taskTitle.trim();
    if (!title) {
      // eslint-disable-next-line no-alert
      alert("Please enter a task title before starting the timer.");
      return;
    }
    setRunningTitle(title);
    setRunningStartMs(Date.now());
    setIsRunning(true);
    if (pomodoroEnabled) {
      setPomodoroPhase("focus");
      setPomodoroEndMs(Date.now() + pomodoroFocusMin * 60 * 1000);
    } else {
      setPomodoroPhase("idle");
      setPomodoroEndMs(null);
    }
  }, [isRunning, taskTitle, pomodoroEnabled, pomodoroFocusMin]);

  const handlePause = useCallback(() => {
    if (!isRunning || runningStartMs == null) return;
    const end = Date.now();
    const newSession: TimerSession = {
      id: `${runningStartMs}-${end}`,
      title: taskTitle.trim() || runningTitle || "Untitled Task",
      startMs: runningStartMs,
      endMs: end,
      tags: currentTagsInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    };
    setSessions((prev) => [newSession, ...prev]);
    setIsRunning(false);
    setRunningStartMs(null);
    setRunningTitle("");
    if (pomodoroEnabled) {
      setPomodoroPhase("break");
      setPomodoroEndMs(Date.now() + pomodoroBreakMin * 60 * 1000);
    }
  }, [
    isRunning,
    runningStartMs,
    taskTitle,
    runningTitle,
    currentTagsInput,
    pomodoroEnabled,
    pomodoroBreakMin,
  ]);

  // Pomodoro auto transitions ticker (depends on handlePause, so declared after it)
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!pomodoroEnabled) return;
      if (!pomodoroEndMs) return;
      const now = Date.now();
      if (pomodoroPhase === "focus" && isRunning && now >= pomodoroEndMs) {
        handlePause();
      } else if (
        pomodoroPhase === "break" &&
        !isRunning &&
        now >= pomodoroEndMs
      ) {
        if (pomodoroAutoContinue) {
          const title = taskTitle.trim() || runningTitle || "Untitled Task";
          setRunningTitle(title);
          const start = Date.now();
          setRunningStartMs(start);
          setIsRunning(true);
          setPomodoroPhase("focus");
          setPomodoroEndMs(start + pomodoroFocusMin * 60 * 1000);
        } else {
          setPomodoroPhase("idle");
          setPomodoroEndMs(null);
        }
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [
    pomodoroEnabled,
    pomodoroEndMs,
    pomodoroPhase,
    pomodoroAutoContinue,
    pomodoroFocusMin,
    handlePause,
    isRunning,
    runningTitle,
    taskTitle,
  ]);

  // Date ranges
  const todayStart = useMemo(() => startOfDay(new Date()), []);
  const todayEnd = useMemo(() => endOfDay(new Date()), []);
  const selectedDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + selectedWeekOffset * 7);
    return d;
  }, [selectedWeekOffset]);
  const weekStart = useMemo(() => startOfWeek(selectedDate), [selectedDate]);
  const weekEnd = useMemo(() => endOfWeek(selectedDate), [selectedDate]);

  // Update export form when week changes
  useEffect(() => {
    setExportForm({
      startDate: formatDateForInput(weekStart),
      endDate: formatDateForInput(weekEnd),
      tagsCsv: "",
    });
  }, [weekStart, weekEnd]);

  // Compute totals
  const { todayTotalMs, weekTotalMs, perTaskWeekTotals, perTagWeekTotals } =
    useMemo(() => {
      const sessionsInRange = (start: number, end: number) =>
        sessions.filter(
          (s) => Math.max(s.startMs, start) <= Math.min(s.endMs, end)
        );

      const todaySessions = sessionsInRange(
        todayStart.getTime(),
        todayEnd.getTime()
      );
      const weekSessions = sessionsInRange(
        weekStart.getTime(),
        weekEnd.getTime()
      );

      const durations = (list: TimerSession[], start: number, end: number) =>
        list.reduce(
          (acc, s) => acc + clampToRangeOverlap(s.startMs, s.endMs, start, end),
          0
        );

      const todayTotal = durations(
        todaySessions,
        todayStart.getTime(),
        todayEnd.getTime()
      );
      const weekTotal = durations(
        weekSessions,
        weekStart.getTime(),
        weekEnd.getTime()
      );

      const perTask = new Map<string, number>();
      const perTag = new Map<string, number>();
      for (const s of weekSessions) {
        const overlap = clampToRangeOverlap(
          s.startMs,
          s.endMs,
          weekStart.getTime(),
          weekEnd.getTime()
        );
        perTask.set(s.title, (perTask.get(s.title) || 0) + overlap);
        if (s.tags && s.tags.length > 0) {
          for (const tag of s.tags) {
            perTag.set(tag, (perTag.get(tag) || 0) + overlap);
          }
        }
      }

      return {
        todayTotalMs:
          todayTotal +
          (isRunning
            ? clampToRangeOverlap(
                runningStartMs ?? 0,
                nowMs,
                todayStart.getTime(),
                todayEnd.getTime()
              )
            : 0),
        weekTotalMs:
          weekTotal +
          (isRunning
            ? clampToRangeOverlap(
                runningStartMs ?? 0,
                nowMs,
                weekStart.getTime(),
                weekEnd.getTime()
              )
            : 0),
        perTaskWeekTotals: perTask,
        perTagWeekTotals: perTag,
      };
    }, [
      sessions,
      todayStart,
      todayEnd,
      weekStart,
      weekEnd,
      isRunning,
      runningStartMs,
      nowMs,
    ]);

  const weekSessionsSorted = useMemo(() => {
    const start = weekStart.getTime();
    const end = weekEnd.getTime();
    return sessions
      .filter((s) => Math.max(s.startMs, start) <= Math.min(s.endMs, end))
      .sort((a, b) => b.startMs - a.startMs);
  }, [sessions, weekStart, weekEnd]);

  const isCurrentWeek = selectedWeekOffset === 0;

  // Reminders
  useEffect(() => {
    if (reminderIntervalRef.current) {
      clearInterval(reminderIntervalRef.current);
      reminderIntervalRef.current = null;
    }
    if (reminderMinutes > 0) {
      const intervalMs = reminderMinutes * 60 * 1000;
      reminderIntervalRef.current = window.setInterval(async () => {
        if (!isRunning) {
          try {
            if ("Notification" in window) {
              if (Notification.permission === "default") {
                await Notification.requestPermission();
              }
              if (Notification.permission === "granted") {
                new Notification("TimerTrack", {
                  body: "Reminder: start tracking your time?",
                });
                return;
              }
            }
          } catch {
            // ignore notification errors
          }
          // fallback
          // eslint-disable-next-line no-alert
          alert("Reminder: start tracking your time?");
        }
      }, intervalMs);
    }
    return () => {
      if (reminderIntervalRef.current) {
        clearInterval(reminderIntervalRef.current);
      }
    };
  }, [reminderMinutes, isRunning]);

  const handleToggle = useCallback(() => {
    if (isRunning) {
      handlePause();
    } else {
      handleStart();
    }
  }, [isRunning, handlePause, handleStart]);

  return (
    <div className="min-h-screen w-full bg-neutral-50 text-neutral-900">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-neutral-900">TimerTrack</h1>
            <p className="text-neutral-600">
              Track your time, boost your productivity
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/report"
              className="rounded-md border border-neutral-300 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
            >
              📊 Report Editor
            </a>
            <button
              onClick={() => setShowExportModal(true)}
              className="hidden rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100 sm:block"
            >
              Export
            </button>
            <button
              onClick={() => setShowSettingsModal(true)}
              className="hidden rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100 sm:block"
            >
              Settings
            </button>
            <button
              onClick={() => {
                setEditingSession(null);
                setEntryForm({
                  title: taskTitle || "",
                  date: formatDateForInput(new Date()),
                  startTime: "09:00",
                  endTime: "10:00",
                  tags: "",
                });
                setShowEntryModal(true);
              }}
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-800"
            >
              + Entry
            </button>
          </div>
        </div>

        <section className="mb-6 grid gap-3 lg:grid-cols-[1fr_auto] sm:grid-cols-1 sm:items-end">
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
            <label htmlFor="tags" className="mt-2 text-sm text-gray-600">
              Tags (comma-separated)
            </label>
            <input
              id="tags"
              type="text"
              value={currentTagsInput}
              onChange={(e) => setCurrentTagsInput(e.target.value)}
              placeholder="e.g. client-a, feature-x"
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-900"
            />
          </div>

          <button
            onClick={handleToggle}
            className={`h-11 rounded-md px-6 font-medium text-white transition-colors ${
              isRunning
                ? "bg-amber-600 hover:bg-amber-700"
                : "bg-neutral-900 hover:bg-neutral-800"
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
                {isRunning
                  ? runningTitle || taskTitle || "Untitled Task"
                  : taskTitle || "—"}
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
            <div className="text-2xl font-mono tabular-nums">
              {formatDuration(todayTotalMs)}
            </div>
          </div>
          <div className="rounded-lg border border-neutral-200 bg-white p-4">
            <div className="text-sm text-gray-600">
              {isCurrentWeek
                ? "This week total"
                : `${weekStart.toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })} - ${weekEnd.toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })} total`}
            </div>
            <div className="text-2xl font-mono tabular-nums">
              {formatDuration(weekTotalMs)}
            </div>
          </div>
          <div className="rounded-lg border border-neutral-200 bg-white p-4">
            <div className="text-sm text-gray-600">Running</div>
            <div className="text-2xl font-mono tabular-nums">
              {isRunning ? "Yes" : "No"}
            </div>
          </div>
        </section>

        <section className="mb-8 rounded-lg border border-neutral-200 bg-white p-4">
          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="flex-1">
              <label htmlFor="reminder" className="text-sm text-gray-600">
                Remind me every (minutes)
              </label>
              <input
                id="reminder"
                type="number"
                min={0}
                step={5}
                value={reminderMinutes}
                onChange={(e) =>
                  setReminderMinutes(Math.max(0, Number(e.target.value) || 0))
                }
                className="mt-1 w-full max-w-[200px] rounded-md border border-neutral-300 bg-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-900"
              />
            </div>
            <div className="text-sm text-gray-600">
              Set to 0 to disable reminders.
            </div>
          </div>
        </section>

        <section className="mb-8 rounded-lg border border-neutral-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Pomodoro</h2>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={pomodoroEnabled}
                onChange={(e) => setPomodoroEnabled(e.target.checked)}
              />{" "}
              Enable
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-4 sm:items-end">
            <div>
              <label className="text-sm text-gray-600">Focus minutes</label>
              <input
                type="number"
                min={1}
                value={pomodoroFocusMin}
                onChange={(e) =>
                  setPomodoroFocusMin(Math.max(1, Number(e.target.value) || 1))
                }
                className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-900"
              />
            </div>
            <div>
              <label className="text-sm text-gray-600">Break minutes</label>
              <input
                type="number"
                min={1}
                value={pomodoroBreakMin}
                onChange={(e) =>
                  setPomodoroBreakMin(Math.max(1, Number(e.target.value) || 1))
                }
                className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-900"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600">Auto-continue</label>
              <input
                type="checkbox"
                checked={pomodoroAutoContinue}
                onChange={(e) => setPomodoroAutoContinue(e.target.checked)}
              />
            </div>
            <div className="text-sm text-gray-600">
              {pomodoroEnabled && (
                <div>
                  Phase: <span className="font-medium">{pomodoroPhase}</span>
                  {pomodoroEndMs && (
                    <span className="ml-2">
                      ({formatDuration(Math.max(0, pomodoroEndMs - Date.now()))}{" "}
                      left)
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="mb-8">
          <h2 className="mb-3 text-lg font-semibold">
            {isCurrentWeek
              ? "This week by task"
              : `${weekStart.toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })} - ${weekEnd.toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })} by task`}
          </h2>
          {perTaskWeekTotals.size === 0 && !isRunning ? (
            <div className="text-sm text-gray-600">
              No tracked time in this week.
            </div>
          ) : (
            <div className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
              {Array.from(perTaskWeekTotals.entries())
                .sort((a, b) => b[1] - a[1])
                .map(([task, ms]) => (
                  <div
                    key={task}
                    className="flex items-center justify-between px-4 py-3"
                  >
                    <div className="truncate pr-4">{task}</div>
                    <div className="font-mono tabular-nums">
                      {formatDuration(ms)}
                    </div>
                  </div>
                ))}
              {isRunning && (
                <div className="flex items-center justify-between bg-amber-50 px-4 py-3">
                  <div className="truncate pr-4">
                    {runningTitle || taskTitle || "Untitled Task"} (running)
                  </div>
                  <div className="font-mono tabular-nums">
                    {formatDuration(liveElapsedMs)}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        <section className="mb-8">
          <h2 className="mb-3 text-lg font-semibold">
            {isCurrentWeek
              ? "This week by tag"
              : `${weekStart.toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })} - ${weekEnd.toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })} by tag`}
          </h2>
          {perTagWeekTotals.size === 0 ? (
            <div className="text-sm text-gray-600">
              No tags recorded in this week.
            </div>
          ) : (
            <div className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
              {Array.from(perTagWeekTotals.entries())
                .sort((a, b) => b[1] - a[1])
                .map(([tag, ms]) => (
                  <div
                    key={tag}
                    className="flex items-center justify-between px-4 py-3"
                  >
                    <div className="flex min-w-0 items-center gap-3 pr-4">
                      <span
                        className="inline-block h-3 w-3 rounded"
                        style={{ backgroundColor: tagColors[tag] || "#f3f4f6" }}
                      />
                      <div className="truncate">#{tag}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="font-mono tabular-nums">
                        {formatDuration(ms)}
                      </div>
                      <input
                        type="color"
                        value={tagColors[tag] || "#f3f4f6"}
                        onChange={(e) =>
                          setTagColors((prev) => ({
                            ...prev,
                            [tag]: e.target.value,
                          }))
                        }
                        title={`Pick color for #${tag}`}
                      />
                    </div>
                  </div>
                ))}
            </div>
          )}
        </section>

        <section className="mb-8">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-semibold">
              {isCurrentWeek
                ? "This week sessions"
                : `${weekStart.toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })} - ${weekEnd.toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })} sessions`}
            </h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelectedWeekOffset((prev) => prev - 1)}
                className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-100"
              >
                ← Previous
              </button>
              <button
                onClick={() => setSelectedWeekOffset(0)}
                className={`rounded border px-2 py-1 text-xs ${
                  isCurrentWeek
                    ? "bg-neutral-900 text-white border-neutral-900"
                    : "border-neutral-300 text-neutral-700 hover:bg-neutral-100"
                }`}
              >
                Today
              </button>
              <button
                onClick={() => setSelectedWeekOffset((prev) => prev + 1)}
                disabled={isCurrentWeek}
                className={`rounded border px-2 py-1 text-xs ${
                  isCurrentWeek
                    ? "border-neutral-200 text-neutral-400 cursor-not-allowed"
                    : "border-neutral-300 text-neutral-700 hover:bg-neutral-100"
                }`}
              >
                Next →
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setViewMode("list")}
                className={`rounded border px-2 py-1 text-xs ${
                  viewMode === "list"
                    ? "bg-neutral-900 text-white border-neutral-900"
                    : "border-neutral-300 text-neutral-700"
                }`}
              >
                List
              </button>
              <button
                onClick={() => setViewMode("calendar")}
                className={`rounded border px-2 py-1 text-xs ${
                  viewMode === "calendar"
                    ? "bg-neutral-900 text-white border-neutral-900"
                    : "border-neutral-300 text-neutral-700"
                }`}
              >
                Calendar
              </button>
              <button
                onClick={() => setShowExportModal(true)}
                className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-100"
              >
                Export…
              </button>
              <button
                onClick={() => setShowSettingsModal(true)}
                className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-100"
              >
                Settings
              </button>
            </div>
          </div>
          {viewMode === "list" && (
            <>
              {weekSessionsSorted.length === 0 ? (
                <div className="text-sm text-gray-600">
                  No sessions recorded in this week.
                </div>
              ) : (
                <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
                  {weekSessionsSorted.map((s) => {
                    const duration = s.endMs - s.startMs;
                    const start = new Date(s.startMs);
                    const end = new Date(s.endMs);
                    return (
                      <li key={s.id} className="px-4 py-3">
                        <div className="flex items-center justify-between gap-4">
                          <div className="min-w-0 pr-2">
                            <div className="truncate font-medium">
                              {s.title}
                            </div>
                            <div className="text-xs text-gray-600">
                              {start.toLocaleString()} → {end.toLocaleString()}
                            </div>
                            {s.tags && s.tags.length > 0 && (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {s.tags.map((t) => (
                                  <span
                                    key={t}
                                    className="rounded px-2 py-0.5 text-[10px] text-neutral-800"
                                    style={{
                                      backgroundColor:
                                        tagColors[t] || "#f3f4f6",
                                    }}
                                  >
                                    #{t}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <div className="font-mono tabular-nums mr-2">
                              {formatDuration(duration)}
                            </div>
                            <button
                              onClick={() => {
                                setEditingSession(s);
                                const d = new Date(s.startMs);
                                const dEnd = new Date(s.endMs);
                                setEntryForm({
                                  title: s.title,
                                  date: formatDateForInput(d),
                                  startTime: formatTimeForInput(d),
                                  endTime: formatTimeForInput(dEnd),
                                  tags: (s.tags || []).join(", "),
                                });
                                setShowEntryModal(true);
                              }}
                              className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-100"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => {
                                setSessions((prev) =>
                                  prev.filter((it) => it.id !== s.id)
                                );
                              }}
                              className="rounded border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                  {isRunning && runningStartMs && isCurrentWeek && (
                    <li className="bg-amber-50 px-4 py-3">
                      <div className="flex items-center justify-between">
                        <div className="min-w-0 pr-4">
                          <div className="truncate font-medium">
                            {runningTitle || taskTitle || "Untitled Task"}{" "}
                            (running)
                          </div>
                          <div className="text-xs text-amber-700">
                            {new Date(runningStartMs).toLocaleString()} →
                            running…
                          </div>
                        </div>
                        <div className="font-mono tabular-nums">
                          {formatDuration(liveElapsedMs)}
                        </div>
                      </div>
                    </li>
                  )}
                </ul>
              )}
            </>
          )}
          {viewMode === "calendar" && (
            <div className="grid grid-cols-1 sm:grid-cols-7 gap-3">
              {Array.from({ length: 7 }).map((_, idx) => {
                const day = new Date(weekStart);
                day.setDate(day.getDate() + idx);
                const dayStart = startOfDay(day).getTime();
                const dayEnd = endOfDay(day).getTime();
                const daySessions = sessions
                  .filter(
                    (s) =>
                      Math.max(s.startMs, dayStart) <= Math.min(s.endMs, dayEnd)
                  )
                  .sort((a, b) => a.startMs - b.startMs);
                const totalMs = daySessions.reduce(
                  (acc, s) =>
                    acc +
                    clampToRangeOverlap(s.startMs, s.endMs, dayStart, dayEnd),
                  0
                );
                return (
                  <div
                    key={idx}
                    className="flex h-64 flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white"
                  >
                    <div className="flex items-center justify-between border-b border-neutral-100 px-3 py-2">
                      <div className="truncate text-sm font-medium">
                        {day.toLocaleDateString(undefined, {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                        })}
                      </div>
                      <div className="text-xs font-mono tabular-nums text-gray-600">
                        {formatDuration(totalMs)}
                      </div>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 pr-2">
                      {daySessions.length === 0 ? (
                        <div className="text-xs text-gray-500">—</div>
                      ) : (
                        <ul className="space-y-2">
                          {daySessions.map((s) => (
                            <li key={s.id} className="text-xs">
                              <div className="truncate font-medium break-words">
                                {s.title}
                              </div>
                              <div className="text-[10px] text-gray-600">
                                {new Date(s.startMs).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}{" "}
                                –{" "}
                                {new Date(s.endMs).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}{" "}
                                • {formatDuration(s.endMs - s.startMs)}
                              </div>
                              {s.tags && s.tags.length > 0 && (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {s.tags.map((t) => (
                                    <span
                                      key={t}
                                      className="rounded px-1.5 py-0.5 text-[9px]"
                                      style={{
                                        backgroundColor:
                                          tagColors[t] || "#f3f4f6",
                                      }}
                                    >
                                      #{t}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {showEntryModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-lg">
              <div className="mb-4 flex items-center justify-between">
                <div className="text-lg font-semibold">
                  {editingSession ? "Edit Entry" : "Add Entry"}
                </div>
                <button
                  onClick={() => setShowEntryModal(false)}
                  className="text-sm text-neutral-600 hover:text-neutral-900"
                >
                  Close
                </button>
              </div>
              <div className="grid gap-3">
                <div className="grid gap-1">
                  <label className="text-sm text-gray-600">Title</label>
                  <input
                    type="text"
                    value={entryForm.title}
                    onChange={(e) =>
                      setEntryForm((f) => ({ ...f, title: e.target.value }))
                    }
                    className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-900"
                  />
                </div>
                <div className="grid gap-1 sm:grid-cols-3 sm:items-end sm:gap-3">
                  <div className="grid gap-1">
                    <label className="text-sm text-gray-600">Date</label>
                    <input
                      type="date"
                      value={entryForm.date}
                      onChange={(e) =>
                        setEntryForm((f) => ({ ...f, date: e.target.value }))
                      }
                      className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-900"
                    />
                  </div>
                  <div className="grid gap-1">
                    <label className="text-sm text-gray-600">Start</label>
                    <input
                      type="time"
                      value={entryForm.startTime}
                      onChange={(e) =>
                        setEntryForm((f) => ({
                          ...f,
                          startTime: e.target.value,
                        }))
                      }
                      className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-900"
                    />
                  </div>
                  <div className="grid gap-1">
                    <label className="text-sm text-gray-600">End</label>
                    <input
                      type="time"
                      value={entryForm.endTime}
                      onChange={(e) =>
                        setEntryForm((f) => ({ ...f, endTime: e.target.value }))
                      }
                      className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-900"
                    />
                  </div>
                </div>
                <div className="grid gap-1">
                  <label className="text-sm text-gray-600">
                    Tags (comma-separated)
                  </label>
                  <input
                    type="text"
                    value={entryForm.tags}
                    onChange={(e) =>
                      setEntryForm((f) => ({ ...f, tags: e.target.value }))
                    }
                    placeholder="e.g. client-a, feature-x"
                    className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-900"
                  />
                </div>
                <div className="mt-2 flex justify-end gap-2">
                  <button
                    onClick={() => setShowEntryModal(false)}
                    className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      const start = parseDateTimeLocal(
                        entryForm.date,
                        entryForm.startTime
                      );
                      const end = parseDateTimeLocal(
                        entryForm.date,
                        entryForm.endTime
                      );
                      if (!start || !end || end <= start) {
                        // eslint-disable-next-line no-alert
                        alert("Please provide a valid date/time range.");
                        return;
                      }

                      // Check if the session is in the future
                      const now = new Date();
                      if (end > now) {
                        // eslint-disable-next-line no-alert
                        alert(
                          "Cannot add sessions in the future. Please use a past or current date/time."
                        );
                        return;
                      }

                      const tags = entryForm.tags
                        .split(",")
                        .map((t) => t.trim())
                        .filter(Boolean);

                      if (editingSession) {
                        setSessions((prev) =>
                          prev.map((it) =>
                            it.id === editingSession.id
                              ? {
                                  ...it,
                                  title:
                                    entryForm.title.trim() || "Untitled Task",
                                  startMs: start.getTime(),
                                  endMs: end.getTime(),
                                  tags,
                                }
                              : it
                          )
                        );
                      } else {
                        const id = `manual-${Date.now()}-${Math.random()
                          .toString(36)
                          .slice(2, 8)}`;
                        const newSession: TimerSession = {
                          id,
                          title: entryForm.title.trim() || "Untitled Task",
                          startMs: start.getTime(),
                          endMs: end.getTime(),
                          tags,
                        };
                        setSessions((prev) => [newSession, ...prev]);
                      }
                      setShowEntryModal(false);
                      setEditingSession(null);
                    }}
                    className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800"
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {showExportModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-2 sm:px-4">
            <div className="w-full max-w-lg rounded-lg bg-white p-4 sm:p-5 shadow-lg">
              <div className="mb-4 flex items-center justify-between">
                <div className="text-lg font-semibold">Export</div>
                <button
                  onClick={() => setShowExportModal(false)}
                  className="text-sm text-neutral-600 hover:text-neutral-900"
                >
                  Close
                </button>
              </div>
              <div className="grid gap-3 grid-cols-1 sm:grid-cols-3 sm:items-end sm:gap-3">
                <div className="grid gap-1">
                  <label className="text-sm text-gray-600">Start date</label>
                  <input
                    type="date"
                    value={exportForm.startDate}
                    onChange={(e) =>
                      setExportForm((f) => ({
                        ...f,
                        startDate: e.target.value,
                      }))
                    }
                    className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-900"
                  />
                </div>
                <div className="grid gap-1">
                  <label className="text-sm text-gray-600">End date</label>
                  <input
                    type="date"
                    value={exportForm.endDate}
                    onChange={(e) =>
                      setExportForm((f) => ({ ...f, endDate: e.target.value }))
                    }
                    className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-900"
                  />
                </div>
                <div className="grid gap-1 sm:col-span-1">
                  <label className="text-sm text-gray-600">Tags filter</label>
                  <input
                    type="text"
                    placeholder="comma-separated, optional"
                    value={exportForm.tagsCsv}
                    onChange={(e) =>
                      setExportForm((f) => ({ ...f, tagsCsv: e.target.value }))
                    }
                    className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-900"
                  />
                </div>
              </div>
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <button
                  onClick={() => {
                    setExportForm((prev) => ({
                      ...prev,
                      endDate: formatDateForInput(new Date()),
                    }));
                  }}
                  className="min-w-[90px] rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
                >
                  To Present
                </button>
                <button
                  onClick={() =>
                    handleExportFiltered("csv", exportForm, sessions)
                  }
                  className="min-w-[90px] rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
                >
                  CSV
                </button>
                <button
                  onClick={() =>
                    handleExportFiltered("json", exportForm, sessions)
                  }
                  className="min-w-[90px] rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
                >
                  JSON
                </button>
                <button
                  onClick={() =>
                    handleExportFiltered("md", exportForm, sessions)
                  }
                  className="min-w-[90px] rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
                >
                  MD
                </button>
                <button
                  onClick={() =>
                    handleExportFiltered("pdf", exportForm, sessions)
                  }
                  className="min-w-[90px] rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800"
                >
                  PDF
                </button>
              </div>
            </div>
          </div>
        )}

        {showSettingsModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-2 sm:px-4">
            <div className="w-full max-w-lg rounded-lg bg-white p-4 sm:p-5 shadow-lg">
              <div className="mb-4 flex items-center justify-between">
                <div className="text-lg font-semibold">Settings</div>
                <button
                  onClick={() => setShowSettingsModal(false)}
                  className="text-sm text-neutral-600 hover:text-neutral-900"
                >
                  Close
                </button>
              </div>
              <div>
                <div className="mb-2 text-sm text-gray-600">Tag colors</div>
                <div className="grid grid-cols-1 gap-2">
                  {Array.from(new Set(sessions.flatMap((s) => s.tags || [])))
                    .length === 0 ? (
                    <div className="text-sm text-gray-600">No tags yet.</div>
                  ) : (
                    Array.from(new Set(sessions.flatMap((s) => s.tags || [])))
                      .sort()
                      .map((tag) => (
                        <div
                          key={tag}
                          className="flex flex-wrap items-center justify-between gap-3 rounded border border-neutral-200 p-2"
                        >
                          <div className="text-sm">#{tag}</div>
                          <input
                            type="color"
                            value={tagColors[tag] || "#f3f4f6"}
                            onChange={(e) =>
                              setTagColors((prev) => ({
                                ...prev,
                                [tag]: e.target.value,
                              }))
                            }
                          />
                        </div>
                      ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-200 bg-white/95 p-3 backdrop-blur sm:hidden">
          <div className="mx-auto flex max-w-3xl items-center justify-between">
            <div className="truncate pr-4 text-sm">
              {isRunning
                ? runningTitle || taskTitle || "Untitled Task"
                : taskTitle || "No task"}
            </div>
            <button
              onClick={handleToggle}
              className={`rounded-md px-4 py-2 text-sm font-medium text-white ${
                isRunning ? "bg-amber-600" : "bg-neutral-900"
              }`}
            >
              {isRunning ? "Pause" : "Start"}
            </button>
          </div>
        </div>
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

function formatDateForInput(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatTimeForInput(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function parseDateTimeLocal(dateStr: string, timeStr: string): Date | null {
  if (!dateStr || !timeStr) return null;
  const [year, month, day] = dateStr.split("-").map((v) => Number(v));
  const [hh, mm] = timeStr.split(":").map((v) => Number(v));
  if (!year || !month || !day || isNaN(hh) || isNaN(mm)) return null;
  const d = new Date();
  d.setFullYear(year);
  d.setMonth(month - 1);
  d.setDate(day);
  d.setHours(hh, mm, 0, 0);
  return d;
}

type ExportFormat = "csv" | "json" | "pdf" | "md";
function handleExportFiltered(
  format: ExportFormat,
  form: { startDate: string; endDate: string; tagsCsv: string },
  sessions: TimerSession[]
) {
  const start = parseDateTimeLocal(form.startDate, "00:00");
  const end = parseDateTimeLocal(form.endDate, "23:59");
  if (!start || !end) return;
  const startMs = start.getTime();
  const endMs = end.getTime();
  const tags = form.tagsCsv
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const sessionsInRange = sessions
    .filter((s) => Math.max(s.startMs, startMs) <= Math.min(s.endMs, endMs))
    .filter((s) =>
      tags.length === 0 ? true : (s.tags || []).some((t) => tags.includes(t))
    );

  if (format === "json") {
    const payload = {
      startISO: new Date(startMs).toISOString(),
      endISO: new Date(endMs).toISOString(),
      sessions: sessionsInRange,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `timertrack-${form.startDate}_to_${form.endDate}.json`;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }

  if (format === "csv") {
    const rows: string[] = [];
    rows.push(`Start,${new Date(startMs).toISOString()}`);
    rows.push(`End,${new Date(endMs).toISOString()}`);
    if (tags.length) rows.push(`Tags,${escapeCsv(tags.join(";"))}`);
    rows.push("");
    rows.push("Title,Start,End,Duration (ms),Duration (hh:mm:ss),Tags");
    for (const s of sessionsInRange) {
      const dur = s.endMs - s.startMs;
      rows.push(
        `${escapeCsv(s.title)},${new Date(s.startMs).toISOString()},${new Date(
          s.endMs
        ).toISOString()},${dur},${formatDuration(dur)},${escapeCsv(
          (s.tags || []).join(";")
        )}`
      );
    }
    const csv = rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `timertrack-${form.startDate}_to_${form.endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }

  if (format === "md") {
    const lines: string[] = [];
    lines.push(`# TimerTrack Report`);
    lines.push(``);
    lines.push(`**Date Range:** ${form.startDate} → ${form.endDate}`);
    if (tags.length) {
      lines.push(`**Tags Filter:** ${tags.join(", ")}`);
    }
    lines.push(`**Generated:** ${new Date().toLocaleString()}`);
    lines.push(``);

    // Summary
    const totalDuration = sessionsInRange.reduce(
      (acc, s) => acc + (s.endMs - s.startMs),
      0
    );
    const totalHours = Math.floor(totalDuration / (1000 * 60 * 60));
    const totalMinutes = Math.floor(
      (totalDuration % (1000 * 60 * 60)) / (1000 * 60)
    );

    lines.push(`## Summary`);
    lines.push(``);
    lines.push(`- **Total Sessions:** ${sessionsInRange.length}`);
    lines.push(
      `- **Total Time:** ${formatDuration(
        totalDuration
      )} (${totalHours}h ${totalMinutes}m)`
    );
    lines.push(``);

    // Group by task
    const taskGroups = new Map<string, TimerSession[]>();
    for (const session of sessionsInRange) {
      if (!taskGroups.has(session.title)) {
        taskGroups.set(session.title, []);
      }
      taskGroups.get(session.title)!.push(session);
    }

    lines.push(`## Time by Task`);
    lines.push(``);
    const taskTotals = Array.from(taskGroups.entries())
      .map(([task, sessions]) => {
        const total = sessions.reduce(
          (acc, s) => acc + (s.endMs - s.startMs),
          0
        );
        return { task, total, sessions };
      })
      .sort((a, b) => b.total - a.total);

    for (const { task, total } of taskTotals) {
      lines.push(`- **${task}:** ${formatDuration(total)}`);
    }
    lines.push(``);

    // Detailed sessions
    lines.push(`## Sessions`);
    lines.push(``);
    if (sessionsInRange.length === 0) {
      lines.push(`No sessions found in this date range.`);
    } else {
      for (const session of sessionsInRange) {
        const start = new Date(session.startMs);
        const end = new Date(session.endMs);
        const duration = session.endMs - session.startMs;
        const tags =
          session.tags && session.tags.length > 0
            ? ` [${session.tags.join(", ")}]`
            : "";

        lines.push(`### ${session.title}${tags}`);
        lines.push(``);
        lines.push(`- **Duration:** ${formatDuration(duration)}`);
        lines.push(`- **Start:** ${start.toLocaleString()}`);
        lines.push(`- **End:** ${end.toLocaleString()}`);
        lines.push(``);
      }
    }

    const markdown = lines.join("\n");
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `timertrack-${form.startDate}_to_${form.endDate}.md`;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }

  if (format === "pdf") {
    import("jspdf").then(({ jsPDF }) => {
      const doc = new jsPDF({ unit: "pt" });
      const margin = 40;
      const lineHeight = 18;
      let y = margin;
      doc.setFontSize(16);
      doc.text(`TimerTrack Report`, margin, y);
      y += lineHeight;
      doc.setFontSize(11);
      doc.text(
        `Range: ${form.startDate} → ${form.endDate}${
          tags.length ? ` | Tags: ${tags.join(", ")}` : ""
        }`,
        margin,
        y
      );
      y += lineHeight * 1.5;

      doc.setFont("helvetica", "bold");
      doc.text("Sessions", margin, y);
      doc.setFont("helvetica", "normal");
      y += lineHeight;
      if (sessionsInRange.length === 0) {
        doc.text("No sessions in this range.", margin, y);
      } else {
        for (const s of sessionsInRange) {
          const when = `${new Date(s.startMs).toLocaleString()} → ${new Date(
            s.endMs
          ).toLocaleString()}`;
          doc.text(
            `${formatDuration(s.endMs - s.startMs)}  ${s.title}`,
            margin,
            y
          );
          y += lineHeight;
          doc.setFontSize(10);
          doc.setTextColor(100);
          doc.text(when, margin + 12, y);
          doc.setTextColor(0);
          doc.setFontSize(11);
          y += lineHeight;
          if (y > 760) {
            doc.addPage();
            y = margin;
          }
        }
      }
      doc.save(`timertrack-${form.startDate}_to_${form.endDate}.pdf`);
    });
  }
}