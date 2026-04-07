import { useMemo, useState } from "react";
import { useTabs, useGroupColor } from "./useTabs";
import type { TabGroup, SavedTab } from "./types";

// ─── helpers ────────────────────────────────────────────────────────────────

function normalize(s: string) {
  return s.toLowerCase().trim();
}

function highlight(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const idx = normalize(text).indexOf(normalize(query));
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark>{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

async function focusTab(tab: chrome.tabs.Tab) {
  if (tab.id == null) return;
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  window.close();
}

async function openSavedTab(url: string) {
  await chrome.tabs.create({ url });
  window.close();
}

/**
 * Restore a closed group with no saved URLs by finding the closest session
 * in Chrome history and recreating the tabs manually (to avoid duplicates).
 */
async function restoreFromSession(group: TabGroup): Promise<boolean> {
  const closedAt = group.closedAt ?? 0;
  const sessions = await chrome.sessions.getRecentlyClosed({ maxResults: 25 });
  const best = sessions
    .map((s) => ({ s, diff: Math.abs(s.lastModified * 1000 - closedAt) }))
    .sort((a, b) => a.diff - b.diff)[0];
  if (!best || best.diff > 60_000) return false;

  // Extract tabs from the matched session
  const sessionTabs: chrome.tabs.Tab[] =
    best.s.window?.tabs ?? (best.s.tab ? [best.s.tab] : []);
  if (sessionTabs.length === 0) return false;

  // Build a map of already-open URLs to avoid duplicates
  const openTabs = await chrome.tabs.query({});
  const openUrlToId = new Map<string, number>(
    openTabs.flatMap((t) => (t.url && t.id != null ? [[t.url, t.id]] : []))
  );

  const tabIds: number[] = [];
  for (const t of sessionTabs) {
    const url = t.url;
    if (!url || url.startsWith("chrome://") || url.startsWith("chrome-extension://")) continue;
    if (openUrlToId.has(url)) {
      // Reuse the already-open tab instead of creating a duplicate
      tabIds.push(openUrlToId.get(url)!);
    } else {
      const newTab = await chrome.tabs.create({ url, active: false });
      if (newTab.id != null) tabIds.push(newTab.id);
    }
  }

  if (tabIds.length === 0) return false;

  const groupId = await chrome.tabs.group({ tabIds });
  await chrome.tabGroups.update(groupId, {
    title: group.title,
    color: group.color as chrome.tabGroups.ColorEnum,
    collapsed: false,
  });
  await chrome.tabs.update(tabIds[0], { active: true });
  window.close();
  return true;
}

async function restoreGroup(group: TabGroup) {
  if (group.savedTabs.length === 0) return;
  const tabIds: number[] = [];
  for (const saved of group.savedTabs) {
    const tab = await chrome.tabs.create({ url: saved.url, active: false });
    if (tab.id != null) tabIds.push(tab.id);
  }
  if (tabIds.length === 0) return;
  const groupId = await chrome.tabs.group({ tabIds });
  await chrome.tabGroups.update(groupId, {
    title: group.title,
    color: group.color as chrome.tabGroups.ColorEnum,
    collapsed: false,
  });
  await chrome.tabs.update(tabIds[0], { active: true });
  window.close();
}

// ─── sub-components ─────────────────────────────────────────────────────────

function GroupDot({ color }: { color: string }) {
  const css = useGroupColor(color);
  // background is a dynamic runtime value — cannot be expressed in static CSS
  return <span className="group-dot" style={{ background: css }} />;
}

function TabRow({ tab, query }: { tab: chrome.tabs.Tab; query: string }) {
  const title = tab.title ?? tab.url ?? "Untitled";
  return (
    <button type="button" className="tab-row" onClick={() => focusTab(tab)} title={tab.url}>
      {tab.favIconUrl ? (
        <img className="favicon" src={tab.favIconUrl} alt="" />
      ) : (
        <span className="favicon favicon--empty" />
      )}
      <span className="tab-title">{highlight(title, query)}</span>
    </button>
  );
}

function ClosedTabRow({ tab, query }: { tab: SavedTab; query: string }) {
  return (
    <button
      type="button"
      className="tab-row"
      onClick={() => openSavedTab(tab.url)}
      title={tab.url}
    >
      {tab.favIconUrl ? (
        <img className="favicon" src={tab.favIconUrl} alt="" />
      ) : (
        <span className="favicon favicon--empty" />
      )}
      <span className="tab-title">{highlight(tab.title, query)}</span>
    </button>
  );
}

function GroupCard({ group, query }: { group: TabGroup; query: string }) {
  const color = useGroupColor(group.color as string);
  const [open, setOpen] = useState(true);
  const [sessionNotFound, setSessionNotFound] = useState(false);

  const tabCount = group.closed ? group.savedTabs.length : group.tabs.length;

  return (
    <div className="group-card">
      {/* --accent is a dynamic CSS custom property; inline style is required */}
      <button
        type="button"
        className="group-header"
        style={{ "--accent": color } as React.CSSProperties}
        onClick={() => setOpen((o) => !o)}
      >
        <GroupDot color={group.color as string} />
        <span className="group-name">{highlight(group.title, query)}</span>
        <span className="group-count">{tabCount}</span>
        {!group.closed
          ? <span className="opened-badge">opened</span>
          : <span className="closed-badge">{timeAgo(group.closedAt!)}</span>
        }
        <span className={`chevron ${open ? "chevron--open" : ""}`}>›</span>
      </button>

      {open && (
        <div className="tab-list">
          {group.closed ? (
            group.savedTabs.length > 0 ? (
              <>
                <button
                  type="button"
                  className="restore-btn-full"
                  onClick={() => restoreGroup(group)}
                >
                  ↩ Restore group
                </button>
                {group.savedTabs.map((tab, i) => (
                  <ClosedTabRow key={i} tab={tab} query={query} />
                ))}
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="restore-btn-full"
                  onClick={async () => {
                    const ok = await restoreFromSession(group);
                    if (!ok) setSessionNotFound(true);
                  }}
                >
                  ↩ Restore from Chrome session history
                </button>
                {sessionNotFound && (
                  <p className="empty-tabs">
                    Session not found — too much time has passed. Use Ctrl+Shift+T in Chrome.
                  </p>
                )}
              </>
            )
          ) : (
            <>
              {group.tabs.map((tab) => (
                <TabRow key={tab.id} tab={tab} query={query} />
              ))}
              {group.tabs.length === 0 && (
                <p className="empty-tabs">No tabs in this group</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── App ────────────────────────────────────────────────────────────────────

export default function App() {
  const { groups, openCount, closedCount, loading, clearClosed } = useTabs();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = normalize(query);
    if (!q) return groups;
    return groups
      .map((g) => {
        const groupMatch = normalize(g.title).includes(q);
        if (g.closed) {
          const matchingTabs = g.savedTabs.filter(
            (t) => normalize(t.title).includes(q) || normalize(t.url).includes(q)
          );
          if (groupMatch) return g;
          if (matchingTabs.length > 0) return { ...g, savedTabs: matchingTabs };
          return null;
        }
        const matchingTabs = g.tabs.filter(
          (t) => normalize(t.title ?? "").includes(q) || normalize(t.url ?? "").includes(q)
        );
        if (groupMatch) return g;
        if (matchingTabs.length > 0) return { ...g, tabs: matchingTabs };
        return null;
      })
      .filter(Boolean) as TabGroup[];
  }, [groups, query]);

  const totalTabs = groups.filter((g) => !g.closed).reduce((n, g) => n + g.tabs.length, 0);

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">Tab<span>Search</span></h1>
        <div className="search-wrap">
          <svg className="search-icon" viewBox="0 0 20 20" fill="none">
            <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M13 13l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            className="search-input"
            type="text"
            placeholder="Search groups or tabs…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          {query && (
            <button type="button" className="clear-btn" onClick={() => setQuery("")}>✕</button>
          )}
        </div>
      </header>

      <main className="results">
        {loading && <p className="state-msg">Loading…</p>}

        {!loading && groups.length === 0 && (
          <p className="state-msg">No tab groups found.<br />Create some in Chrome first!</p>
        )}

        {!loading && filtered.length === 0 && query && (
          <p className="state-msg">Nothing matched "<strong>{query}</strong>"</p>
        )}

        {filtered.map((g) => (
          <GroupCard key={g.uid} group={g} query={query} />
        ))}
      </main>

      <footer className="app-footer">
        <span>{openCount} open · {totalTabs} tabs</span>
        {closedCount > 0 && (
          <>
            <span className="footer-closed-count">{closedCount} closed</span>
            <button type="button" className="clear-closed-btn" onClick={clearClosed}>Clear</button>
          </>
        )}
      </footer>
    </div>
  );
}
