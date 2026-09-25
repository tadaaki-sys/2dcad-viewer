import { useCallback, useState } from "react";
import type { RecentFileEntry } from "../components/StartScreen";

const STORAGE_KEY = "2dcad-viewer:recent-files";
const MAX_RECENT_FILES = 8;

type StoredRecentFile = {
  fileName: string;
  lastViewedAtIso: string;
};

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function loadStoredEntries(): StoredRecentFile[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is StoredRecentFile =>
        typeof entry?.fileName === "string" && typeof entry?.lastViewedAtIso === "string",
    );
  } catch {
    return [];
  }
}

function saveStoredEntries(entries: StoredRecentFile[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // localStorageが使えない環境(プライベートブラウジング等)では何もしない
  }
}

function toDisplayEntries(stored: StoredRecentFile[]): RecentFileEntry[] {
  return stored.map((entry) => ({
    fileName: entry.fileName,
    lastViewedAt: formatDateTime(entry.lastViewedAtIso),
  }));
}

export function useRecentFiles() {
  const [entries, setEntries] = useState<StoredRecentFile[]>(() => loadStoredEntries());

  const addRecentFile = useCallback((fileName: string) => {
    setEntries((prev) => {
      const withoutDuplicate = prev.filter((entry) => entry.fileName !== fileName);
      const next = [{ fileName, lastViewedAtIso: new Date().toISOString() }, ...withoutDuplicate].slice(
        0,
        MAX_RECENT_FILES,
      );
      saveStoredEntries(next);
      return next;
    });
  }, []);

  return { recentFiles: toDisplayEntries(entries), addRecentFile };
}
