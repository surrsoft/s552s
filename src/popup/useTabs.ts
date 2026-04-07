import { useEffect, useState } from "react";
import type { TabGroup, SavedTab } from "./types";

// Maps Chrome's color names to CSS values
const COLOR_MAP: Record<string, string> = {
  grey: "#5f6368",
  blue: "#1a73e8",
  red: "#d93025",
  yellow: "#f9ab00",
  green: "#1e8e3e",
  pink: "#e52592",
  purple: "#a142f4",
  cyan: "#007b83",
  orange: "#fa903e",
};

export function useGroupColor(color: string): string {
  return COLOR_MAP[color] ?? "#5f6368";
}

interface StoredClosedGroup {
  uid: string;
  id: number;
  title: string;
  color: string;
  tabs: SavedTab[];
  closedAt: number;
}

export function useTabs() {
  const [openGroups, setOpenGroups] = useState<TabGroup[]>([]);
  const [closedGroups, setClosedGroups] = useState<TabGroup[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [rawGroups, allTabs, storageData] = await Promise.all([
        chrome.tabGroups.query({}),
        chrome.tabs.query({}),
        chrome.storage.local.get("closedGroups"),
      ]);

      const live: TabGroup[] = rawGroups.map((g) => ({
        uid: String(g.id),
        id: g.id,
        title: g.title ?? "(no name)",
        color: g.color,
        collapsed: g.collapsed,
        windowId: g.windowId,
        tabs: allTabs.filter((t) => t.groupId === g.id),
        closed: false,
        savedTabs: [],
      }));

      const stored: StoredClosedGroup[] = storageData.closedGroups ?? [];
      const closed: TabGroup[] = stored.map((g) => ({
        uid: g.uid,
        id: g.id,
        title: g.title,
        color: g.color as chrome.tabGroups.ColorEnum,
        collapsed: false,
        windowId: -1,
        tabs: [],
        closed: true,
        savedTabs: g.tabs,
        closedAt: g.closedAt,
      }));

      setOpenGroups(live);
      setClosedGroups(closed);
      setLoading(false);
    }

    load();
  }, []);

  async function clearClosed() {
    await chrome.storage.local.set({ closedGroups: [] });
    setClosedGroups([]);
  }

  return { openGroups, closedGroups, loading, clearClosed };
}
