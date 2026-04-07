import { useEffect, useState } from "react";
import type { TabGroup } from "./types";

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

export function useTabs() {
  const [groups, setGroups] = useState<TabGroup[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const rawGroups = await chrome.tabGroups.query({});
      const allTabs = await chrome.tabs.query({});

      const result: TabGroup[] = rawGroups.map((g) => ({
        id: g.id,
        title: g.title ?? "(no name)",
        color: g.color,
        collapsed: g.collapsed,
        windowId: g.windowId,
        tabs: allTabs.filter((t) => t.groupId === g.id),
      }));

      setGroups(result);
      setLoading(false);
    }

    load();
  }, []);

  return { groups, loading };
}
