import { useMemo, useState } from "react";
import { useTabs, useGroupColor } from "./useTabs";
import type { TabGroup } from "./types";

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

async function focusTab(tab: chrome.tabs.Tab) {
  if (tab.id == null) return;
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  window.close();
}

async function expandAndFocusGroup(group: TabGroup) {
  await chrome.tabGroups.update(group.id, { collapsed: false });
  const first = group.tabs[0];
  if (first) focusTab(first);
}

// ─── sub-components ─────────────────────────────────────────────────────────

function GroupDot({ color }: { color: string }) {
  const css = useGroupColor(color);
  return <span className="group-dot" style={{ background: css }} />;
}

function TabRow({
  tab,
  query,
}: {
  tab: chrome.tabs.Tab;
  query: string;
}) {
  const title = tab.title ?? tab.url ?? "Untitled";
  return (
    <button className="tab-row" onClick={() => focusTab(tab)} title={tab.url}>
      {tab.favIconUrl ? (
        <img className="favicon" src={tab.favIconUrl} alt="" />
      ) : (
        <span className="favicon favicon--empty" />
      )}
      <span className="tab-title">{highlight(title, query)}</span>
    </button>
  );
}

function GroupCard({
  group,
  query,
}: {
  group: TabGroup;
  query: string;
}) {
  const color = useGroupColor(group.color as string);
  const [open, setOpen] = useState(true);

  return (
    <div className="group-card">
      <button
        className="group-header"
        style={{ "--accent": color } as React.CSSProperties}
        onClick={() => setOpen((o) => !o)}
      >
        <GroupDot color={group.color as string} />
        <span className="group-name">{highlight(group.title, query)}</span>
        <span className="group-count">{group.tabs.length}</span>
        <span className={`chevron ${open ? "chevron--open" : ""}`}>›</span>
      </button>

      {open && (
        <div className="tab-list">
          {group.tabs.map((tab) => (
            <TabRow key={tab.id} tab={tab} query={query} />
          ))}
          {group.tabs.length === 0 && (
            <p className="empty-tabs">No tabs in this group</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── App ────────────────────────────────────────────────────────────────────

export default function App() {
  const { groups, loading } = useTabs();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = normalize(query);
    if (!q) return groups;

    return groups
      .map((g) => {
        const groupMatch = normalize(g.title).includes(q);
        const matchingTabs = g.tabs.filter(
          (t) =>
            normalize(t.title ?? "").includes(q) ||
            normalize(t.url ?? "").includes(q)
        );
        if (groupMatch) return g; // show all tabs when group name matches
        if (matchingTabs.length > 0) return { ...g, tabs: matchingTabs };
        return null;
      })
      .filter(Boolean) as TabGroup[];
  }, [groups, query]);

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
            <button className="clear-btn" onClick={() => setQuery("")}>✕</button>
          )}
        </div>
      </header>

      <main className="results">
        {loading && <p className="state-msg">Loading…</p>}

        {!loading && groups.length === 0 && (
          <p className="state-msg">No tab groups found.<br />Create some in Chrome first!</p>
        )}

        {!loading && groups.length > 0 && filtered.length === 0 && (
          <p className="state-msg">Nothing matched "<strong>{query}</strong>"</p>
        )}

        {filtered.map((g) => (
          <GroupCard key={g.id} group={g} query={query} />
        ))}
      </main>

      <footer className="app-footer">
        {groups.length} group{groups.length !== 1 ? "s" : ""} ·{" "}
        {groups.reduce((n, g) => n + g.tabs.length, 0)} tabs
      </footer>
    </div>
  );
}
