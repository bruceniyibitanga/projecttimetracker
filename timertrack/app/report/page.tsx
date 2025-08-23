"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import React from "react";

type TimerSession = {
  id: string;
  title: string;
  startMs: number;
  endMs: number;
  tags?: string[];
};

function formatDuration(ms: number): string {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}

function endOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? 0 : 7);
  return new Date(d.setDate(diff));
}

function formatDateForInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseDateTimeLocal(dateStr: string, timeStr: string): Date | null {
  try {
    const [year, month, day] = dateStr.split("-").map(Number);
    const [hour, minute] = timeStr.split(":").map(Number);
    return new Date(year, month - 1, day, hour, minute);
  } catch {
    return null;
  }
}

// Enhanced Markdown Parser Functions
function parseInlineMarkdown(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let currentIndex = 0;

  // Regex patterns for different markdown elements
  const patterns = [
    { regex: /\*\*(.*?)\*\*/g, type: "bold" },
    { regex: /\*(.*?)\*/g, type: "italic" },
    { regex: /`(.*?)`/g, type: "code" },
    { regex: /\[([^\]]+)\]\(([^)]+)\)/g, type: "link" },
  ];

  let result;
  let lastIndex = 0;

  // Find all matches and sort by position
  const matches: Array<{
    start: number;
    end: number;
    type: string;
    content: string;
    url?: string;
  }> = [];

  patterns.forEach(({ regex, type }) => {
    regex.lastIndex = 0;
    while ((result = regex.exec(text)) !== null) {
      matches.push({
        start: result.index,
        end: result.index + result[0].length,
        type,
        content: result[1],
        url: type === "link" ? result[2] : undefined,
      });
    }
  });

  // Sort matches by start position
  matches.sort((a, b) => a.start - b.start);

  // Process matches and build parts
  for (const match of matches) {
    // Add text before match
    if (match.start > lastIndex) {
      parts.push(text.slice(lastIndex, match.start));
    }

    // Add the formatted content
    switch (match.type) {
      case "bold":
        parts.push(
          <strong key={`bold-${match.start}`}>{match.content}</strong>
        );
        break;
      case "italic":
        parts.push(<em key={`italic-${match.start}`}>{match.content}</em>);
        break;
      case "code":
        parts.push(
          <code
            key={`code-${match.start}`}
            className="bg-neutral-100 px-1 py-0.5 rounded text-sm font-mono"
          >
            {match.content}
          </code>
        );
        break;
      case "link":
        parts.push(
          <a
            key={`link-${match.start}`}
            href={match.url}
            className="text-blue-600 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            {match.content}
          </a>
        );
        break;
    }

    lastIndex = match.end;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}

function parseMarkdownLine(line: string, index: number): React.ReactNode {
  const trimmedLine = line.trim();

  // Headers (H1-H6)
  if (trimmedLine.startsWith("# ")) {
    return (
      <h1 key={index} className="text-2xl font-bold text-neutral-900 mb-4">
        {parseInlineMarkdown(trimmedLine.substring(2))}
      </h1>
    );
  } else if (trimmedLine.startsWith("## ")) {
    return (
      <h2 key={index} className="text-xl font-bold text-neutral-900 mb-3">
        {parseInlineMarkdown(trimmedLine.substring(3))}
      </h2>
    );
  } else if (trimmedLine.startsWith("### ")) {
    return (
      <h3 key={index} className="text-lg font-bold text-neutral-900 mb-2">
        {parseInlineMarkdown(trimmedLine.substring(4))}
      </h3>
    );
  } else if (trimmedLine.startsWith("#### ")) {
    return (
      <h4 key={index} className="text-base font-bold text-neutral-900 mb-2">
        {parseInlineMarkdown(trimmedLine.substring(5))}
      </h4>
    );
  } else if (trimmedLine.startsWith("##### ")) {
    return (
      <h5 key={index} className="text-sm font-bold text-neutral-900 mb-1">
        {parseInlineMarkdown(trimmedLine.substring(6))}
      </h5>
    );
  } else if (trimmedLine.startsWith("###### ")) {
    return (
      <h6 key={index} className="text-xs font-bold text-neutral-900 mb-1">
        {parseInlineMarkdown(trimmedLine.substring(7))}
      </h6>
    );
  }

  // Horizontal rule
  if (trimmedLine.match(/^[-*_]{3,}$/)) {
    return <hr key={index} className="my-4 border-neutral-300" />;
  }

  // Blockquote
  if (trimmedLine.startsWith("> ")) {
    return (
      <blockquote
        key={index}
        className="border-l-4 border-neutral-300 pl-4 my-2 text-neutral-700 italic"
      >
        {parseInlineMarkdown(trimmedLine.substring(2))}
      </blockquote>
    );
  }

  // Unordered list
  if (trimmedLine.match(/^[-*+]\s/)) {
    return (
      <li key={index} className="ml-4 text-neutral-900 mb-1">
        {parseInlineMarkdown(trimmedLine.substring(2))}
      </li>
    );
  }

  // Ordered list
  if (trimmedLine.match(/^\d+\.\s/)) {
    return (
      <li key={index} className="ml-4 text-neutral-900 mb-1">
        {parseInlineMarkdown(trimmedLine.replace(/^\d+\.\s/, ""))}
      </li>
    );
  }

  // Code block (single line)
  if (trimmedLine.startsWith("```")) {
    return (
      <pre
        key={index}
        className="bg-neutral-100 p-3 rounded my-2 overflow-x-auto"
      >
        <code className="text-sm font-mono text-neutral-900">
          {trimmedLine.substring(3)}
        </code>
      </pre>
    );
  }

  // Regular paragraph
  if (trimmedLine) {
    return (
      <p key={index} className="text-neutral-900 mb-2">
        {parseInlineMarkdown(trimmedLine)}
      </p>
    );
  }

  // Empty line
  return <br key={index} />;
}

function parseMarkdownContent(content: string): React.ReactNode[] {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeBlockContent: string[] = [];
  let listItems: React.ReactNode[] = [];
  let inList = false;
  let listType: "ul" | "ol" = "ul";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // Handle code blocks
    if (trimmedLine.startsWith("```")) {
      if (inCodeBlock) {
        // End code block
        elements.push(
          <pre
            key={`code-${i}`}
            className="bg-neutral-100 p-3 rounded my-2 overflow-x-auto"
          >
            <code className="text-sm font-mono text-neutral-900">
              {codeBlockContent.join("\n")}
            </code>
          </pre>
        );
        codeBlockContent = [];
        inCodeBlock = false;
      } else {
        // Start code block
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent.push(line);
      continue;
    }

    // Handle lists
    const isUnorderedListItem = trimmedLine.match(/^[-*+]\s/);
    const isOrderedListItem = trimmedLine.match(/^\d+\.\s/);
    const isListItem = isUnorderedListItem || isOrderedListItem;

    if (isListItem) {
      if (!inList) {
        inList = true;
        listItems = [];
        listType = isOrderedListItem ? "ol" : "ul";
      }
      listItems.push(parseMarkdownLine(line, i));
    } else {
      if (inList && listItems.length > 0) {
        // End list
        if (listType === "ol") {
          elements.push(
            <ol key={`list-${i}`} className="mb-2 list-decimal list-inside">
              {listItems}
            </ol>
          );
        } else {
          elements.push(
            <ul key={`list-${i}`} className="mb-2 list-disc list-inside">
              {listItems}
            </ul>
          );
        }
        listItems = [];
        inList = false;
      }

      // Parse regular line
      elements.push(parseMarkdownLine(line, i));
    }
  }

  // Handle any remaining list
  if (inList && listItems.length > 0) {
    if (listType === "ol") {
      elements.push(
        <ol key="list-end" className="mb-2 list-decimal list-inside">
          {listItems}
        </ol>
      );
    } else {
      elements.push(
        <ul key="list-end" className="mb-2 list-disc list-inside">
          {listItems}
        </ul>
      );
    }
  }

  return elements;
}

export default function ReportPage() {
  const router = useRouter();

  // Timer data from localStorage
  const [sessions, setSessions] = useState<TimerSession[]>([]);

  // Report state
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [customStartDate, setCustomStartDate] = useState<string>(
    formatDateForInput(startOfWeek(new Date()))
  );
  const [customEndDate, setCustomEndDate] = useState<string>(
    formatDateForInput(endOfWeek(new Date()))
  );
  const [useCustomRange, setUseCustomRange] = useState<boolean>(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [markdownContent, setMarkdownContent] = useState<string>("");
  const [showPreview, setShowPreview] = useState<boolean>(false);

  // Load data from localStorage
  useEffect(() => {
    const savedSessions = localStorage.getItem("timerSessions");
    if (savedSessions) {
      setSessions(JSON.parse(savedSessions));
    }
  }, []);

  // Calculate date range
  const reportStartDate = useMemo(() => {
    if (useCustomRange) {
      return parseDateTimeLocal(customStartDate, "00:00");
    }
    return startOfWeek(selectedDate);
  }, [useCustomRange, customStartDate, selectedDate]);

  const reportEndDate = useMemo(() => {
    if (useCustomRange) {
      return parseDateTimeLocal(customEndDate, "23:59");
    }
    return endOfWeek(selectedDate);
  }, [useCustomRange, customEndDate, selectedDate]);

  // Filter sessions based on date range and tags
  const filteredSessions = useMemo(() => {
    if (!reportStartDate || !reportEndDate) return [];

    const startMs = reportStartDate.getTime();
    const endMs = reportEndDate.getTime();

    return sessions
      .filter((s) => Math.max(s.startMs, startMs) <= Math.min(s.endMs, endMs))
      .filter((s) =>
        selectedTags.length === 0
          ? true
          : (s.tags || []).some((t) => selectedTags.includes(t))
      );
  }, [sessions, reportStartDate, reportEndDate, selectedTags]);

  // Calculate totals
  const totalDuration = useMemo(
    () => filteredSessions.reduce((acc, s) => acc + (s.endMs - s.startMs), 0),
    [filteredSessions]
  );

  const perTaskTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const session of filteredSessions) {
      const current = totals.get(session.title) || 0;
      totals.set(session.title, current + (session.endMs - session.startMs));
    }
    return totals;
  }, [filteredSessions]);

  const perTagTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const session of filteredSessions) {
      for (const tag of session.tags || []) {
        const current = totals.get(tag) || 0;
        totals.set(tag, current + (session.endMs - session.startMs));
      }
    }
    return totals;
  }, [filteredSessions]);

  // Get all available tags
  const allTags = useMemo(() => {
    const tags = new Set<string>();
    for (const session of sessions) {
      for (const tag of session.tags || []) {
        tags.add(tag);
      }
    }
    return Array.from(tags).sort();
  }, [sessions]);

  // Generate markdown template
  const generateMarkdownTemplate = useCallback(() => {
    if (!reportStartDate || !reportEndDate) return "";

    const lines: string[] = [];

    lines.push(`# TimerTrack Report`);
    lines.push(``);
    lines.push(
      `**Date Range:** ${reportStartDate
        .toISOString()
        .slice(0, 10)} → ${reportEndDate.toISOString().slice(0, 10)}`
    );
    lines.push(`**Generated:** ${new Date().toLocaleString()}`);
    if (selectedTags.length > 0) {
      lines.push(`**Tags Filter:** ${selectedTags.join(", ")}`);
    }
    lines.push(``);

    // Summary
    const totalHours = Math.floor(totalDuration / (1000 * 60 * 60));
    const totalMinutes = Math.floor(
      (totalDuration % (1000 * 60 * 60)) / (1000 * 60)
    );

    lines.push(`## Summary`);
    lines.push(``);
    lines.push(`- **Total Sessions:** ${filteredSessions.length}`);
    lines.push(
      `- **Total Time:** ${formatDuration(
        totalDuration
      )} (${totalHours}h ${totalMinutes}m)`
    );
    lines.push(``);

    // Time by task
    if (perTaskTotals.size > 0) {
      lines.push(`## Time by Task`);
      lines.push(``);
      const taskEntries = Array.from(perTaskTotals.entries()).sort(
        (a, b) => b[1] - a[1]
      );
      for (const [task, totalMs] of taskEntries) {
        lines.push(`- **${task}:** ${formatDuration(totalMs)}`);
      }
      lines.push(``);
    }

    // Time by tag
    if (perTagTotals.size > 0) {
      lines.push(`## Time by Tag`);
      lines.push(``);
      const tagEntries = Array.from(perTagTotals.entries()).sort(
        (a, b) => b[1] - a[1]
      );
      for (const [tag, totalMs] of tagEntries) {
        lines.push(`- **#${tag}:** ${formatDuration(totalMs)}`);
      }
      lines.push(``);
    }

    // Sessions
    lines.push(`## Sessions`);
    lines.push(``);
    for (const session of filteredSessions.sort(
      (a, b) => b.startMs - a.startMs
    )) {
      const start = new Date(session.startMs);
      const end = new Date(session.endMs);
      const duration = session.endMs - session.startMs;
      const tags =
        session.tags && session.tags.length > 0
          ? ` [${session.tags.join(", ")}]`
          : "";

      lines.push(`### ${session.title}${tags}`);
      lines.push(``);
      lines.push(`- **Date:** ${start.toLocaleDateString()}`);
      lines.push(
        `- **Time:** ${start.toLocaleTimeString()} - ${end.toLocaleTimeString()}`
      );
      lines.push(`- **Duration:** ${formatDuration(duration)}`);
      lines.push(``);
    }

    return lines.join("\n");
  }, [
    reportStartDate,
    reportEndDate,
    selectedTags,
    filteredSessions,
    totalDuration,
    perTaskTotals,
    perTagTotals,
  ]);

  // Initialize markdown content
  useEffect(() => {
    if (!markdownContent) {
      setMarkdownContent(generateMarkdownTemplate());
    }
  }, [generateMarkdownTemplate, markdownContent]);

  // Export functions
  const exportMarkdown = useCallback(() => {
    const blob = new Blob([markdownContent], {
      type: "text/markdown;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `timertrack-report-${reportStartDate
      ?.toISOString()
      .slice(0, 10)}_to_${reportEndDate?.toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [markdownContent, reportStartDate, reportEndDate]);

  const exportPDF = useCallback(async () => {
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ unit: "pt" });
    const margin = 40;
    const lineHeight = 18;
    let y = margin;

    // Simple markdown to text conversion for PDF
    const lines = markdownContent.split("\n");
    doc.setFontSize(16);
    doc.text("TimerTrack Report", margin, y);
    y += lineHeight * 1.5;

    doc.setFontSize(11);
    for (const line of lines) {
      if (line.startsWith("# ")) {
        doc.setFont("helvetica", "bold");
        doc.text(line.substring(2), margin, y);
        doc.setFont("helvetica", "normal");
        y += lineHeight * 1.2;
      } else if (line.startsWith("## ")) {
        doc.setFont("helvetica", "bold");
        doc.text(line.substring(3), margin, y);
        doc.setFont("helvetica", "normal");
        y += lineHeight * 1.1;
      } else if (line.startsWith("### ")) {
        doc.setFont("helvetica", "bold");
        doc.text(line.substring(4), margin, y);
        doc.setFont("helvetica", "normal");
        y += lineHeight;
      } else if (line.startsWith("- ")) {
        doc.text(line, margin, y);
        y += lineHeight;
      } else if (line.trim()) {
        doc.text(line, margin, y);
        y += lineHeight;
      } else {
        y += lineHeight * 0.5;
      }

      if (y > 750) {
        doc.addPage();
        y = margin;
      }
    }

    doc.save(
      `timertrack-report-${reportStartDate
        ?.toISOString()
        .slice(0, 10)}_to_${reportEndDate?.toISOString().slice(0, 10)}.pdf`
    );
  }, [markdownContent, reportStartDate, reportEndDate]);

  return (
    <div className="min-h-screen bg-neutral-50 p-4">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-neutral-900">
              Report Editor
            </h1>
            <p className="text-neutral-600">
              Edit and customize your time tracking reports
            </p>
          </div>
          <button
            onClick={() => router.push("/")}
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
          >
            ← Back to Timer
          </button>
        </div>

        {/* Controls */}
        <div className="mb-6 rounded-lg border border-neutral-200 bg-white p-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            {/* Date Range Selection */}
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                Date Range
              </label>
              <div className="space-y-2">
                <label className="flex items-center text-neutral-900">
                  <input
                    type="radio"
                    checked={!useCustomRange}
                    onChange={() => setUseCustomRange(false)}
                    className="mr-2"
                  />
                  Week of
                </label>
                {!useCustomRange && (
                  <input
                    type="date"
                    value={formatDateForInput(selectedDate)}
                    onChange={(e) => setSelectedDate(new Date(e.target.value))}
                    className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900"
                  />
                )}
                <label className="flex items-center text-neutral-900">
                  <input
                    type="radio"
                    checked={useCustomRange}
                    onChange={() => setUseCustomRange(true)}
                    className="mr-2"
                  />
                  Custom Range
                </label>
                {useCustomRange && (
                  <div className="space-y-2">
                    <input
                      type="date"
                      value={customStartDate}
                      onChange={(e) => setCustomStartDate(e.target.value)}
                      className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900"
                    />
                    <input
                      type="date"
                      value={customEndDate}
                      onChange={(e) => setCustomEndDate(e.target.value)}
                      className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Tag Filter */}
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                Filter by Tags
              </label>
              <div className="max-h-32 overflow-y-auto space-y-1">
                {allTags.map((tag) => (
                  <label
                    key={tag}
                    className="flex items-center text-neutral-900"
                  >
                    <input
                      type="checkbox"
                      checked={selectedTags.includes(tag)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedTags([...selectedTags, tag]);
                        } else {
                          setSelectedTags(
                            selectedTags.filter((t) => t !== tag)
                          );
                        }
                      }}
                      className="mr-2"
                    />
                    <span className="text-sm">{tag}</span>
                  </label>
                ))}
                {allTags.length === 0 && (
                  <p className="text-sm text-neutral-600">No tags available</p>
                )}
              </div>
            </div>

            {/* Summary Stats */}
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                Summary
              </label>
              <div className="space-y-1 text-sm text-neutral-900">
                <p>
                  <strong>Sessions:</strong> {filteredSessions.length}
                </p>
                <p>
                  <strong>Total Time:</strong> {formatDuration(totalDuration)}
                </p>
                <p>
                  <strong>Tasks:</strong> {perTaskTotals.size}
                </p>
                <p>
                  <strong>Tags:</strong> {perTagTotals.size}
                </p>
              </div>
            </div>

            {/* Actions */}
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                Actions
              </label>
              <div className="space-y-2">
                <button
                  onClick={() => setMarkdownContent(generateMarkdownTemplate())}
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
                >
                  Refresh Template
                </button>
                <button
                  onClick={() => setShowPreview(!showPreview)}
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
                >
                  {showPreview ? "Hide Preview" : "Show Preview"}
                </button>
                <button
                  onClick={exportMarkdown}
                  className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm text-white hover:bg-neutral-800"
                >
                  Export MD
                </button>
                <button
                  onClick={exportPDF}
                  className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm text-white hover:bg-neutral-800"
                >
                  Export PDF
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Editor and Preview */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Markdown Editor */}
          <div className="rounded-lg border border-neutral-200 bg-white">
            <div className="border-b border-neutral-200 px-4 py-3">
              <h3 className="font-medium text-neutral-900">Markdown Editor</h3>
            </div>
            <textarea
              value={markdownContent}
              onChange={(e) => setMarkdownContent(e.target.value)}
              className="h-96 w-full resize-none border-0 p-4 font-mono text-sm text-neutral-900 focus:ring-0"
              placeholder="Edit your markdown content here..."
            />
          </div>

          {/* Preview */}
          <div className="rounded-lg border border-neutral-200 bg-white">
            <div className="border-b border-neutral-200 px-4 py-3">
              <h3 className="font-medium text-neutral-900">Preview</h3>
            </div>
            <div className="h-96 overflow-y-auto p-4">
              {showPreview ? (
                <div className="prose prose-sm max-w-none text-neutral-900">
                  {parseMarkdownContent(markdownContent)}
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-neutral-600">
                  Click &quot;Show Preview&quot; to see the rendered markdown
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
