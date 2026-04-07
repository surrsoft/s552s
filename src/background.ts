/**
 * Background service worker.
 * Maintains an in-memory cache of groupId → tabs so that when a tab group is
 * removed (e.g. the window closes) we still have the last-known tab URLs and
 * can persist them to storage.local as a "closed group".
 */

interface SavedTab {
  title: string;
  url: string;
  favIconUrl?: string;
}

interface ClosedGroup {
  uid: string;
  id: number;
  title: string;
  color: string;
  tabs: SavedTab[];
  closedAt: number;
}

interface GroupEntry {
  title: string;
  color: string;
  tabs: Map<number, SavedTab>; // tabId → snapshot
}

// ─── In-memory state ──────────────────────────────────────────────────────────

/** groupId → entry */
const groupCache = new Map<number, GroupEntry>();

/** tabId → groupId (reverse lookup for fast removal) */
const tabToGroup = new Map<number, number>();

/** tabId → pending removal timer — gives tabGroups.onRemoved time to fire first */
const pendingRemovals = new Map<number, ReturnType<typeof setTimeout>>();

/** groupId → last activity timestamp (ms) */
const groupLastSeen = new Map<number, number>();

let saveLastSeenTimer: ReturnType<typeof setTimeout> | null = null;

function touchGroup(groupId: number) {
  if (groupId <= 0) return;
  groupLastSeen.set(groupId, Date.now());
  if (saveLastSeenTimer) clearTimeout(saveLastSeenTimer);
  saveLastSeenTimer = setTimeout(async () => {
    const obj: Record<string, number> = {};
    for (const [k, v] of groupLastSeen) obj[k] = v;
    await chrome.storage.local.set({ groupLastSeen: obj });
  }, 1000);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toSavedTab(t: chrome.tabs.Tab): SavedTab {
  return {
    title: t.title ?? t.url ?? "Untitled",
    url: t.url ?? "",
    favIconUrl: t.favIconUrl || undefined,
  };
}

function setTab(tab: chrome.tabs.Tab) {
  if (tab.id == null) return;
  const newGroupId = tab.groupId ?? -1;
  const oldGroupId = tabToGroup.get(tab.id);

  // Move out of old group if groupId changed
  if (oldGroupId != null && oldGroupId !== newGroupId) {
    groupCache.get(oldGroupId)?.tabs.delete(tab.id);
    if (newGroupId <= 0) tabToGroup.delete(tab.id);
  }

  if (newGroupId > 0) {
    tabToGroup.set(tab.id, newGroupId);
    if (!groupCache.has(newGroupId)) {
      groupCache.set(newGroupId, { title: "(no name)", color: "grey", tabs: new Map() });
    }
    groupCache.get(newGroupId)!.tabs.set(tab.id, toSavedTab(tab));
  }
}

/**
 * Remove a tab from the cache.
 *
 * Two tricky cases:
 * 1. Window closing — Chrome fires tabs.onRemoved (isWindowClosing=true) for every
 *    tab BEFORE firing tabGroups.onRemoved. We skip removal so the snapshot is intact.
 * 2. Last tab manually closed — isWindowClosing=false, but tabGroups.onRemoved fires
 *    almost immediately after. We defer the actual removal by 600 ms so that
 *    markGroupClosed() still sees the tab data.
 */
function removeTab(tabId: number, isWindowClosing: boolean) {
  if (isWindowClosing) return;

  // Cancel any previously scheduled removal for this tab
  const existing = pendingRemovals.get(tabId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    const groupId = tabToGroup.get(tabId);
    if (groupId != null) {
      groupCache.get(groupId)?.tabs.delete(tabId);
      tabToGroup.delete(tabId);
    }
    pendingRemovals.delete(tabId);
  }, 600);

  pendingRemovals.set(tabId, timer);
}

async function markGroupClosed(group: chrome.tabGroups.TabGroup) {
  // Cancel pending tab removals for this group so we capture all tabs
  for (const [tabId, groupId] of tabToGroup) {
    if (groupId === group.id) {
      const timer = pendingRemovals.get(tabId);
      if (timer) { clearTimeout(timer); pendingRemovals.delete(tabId); }
    }
  }

  const cached = groupCache.get(group.id);
  const tabs = cached ? Array.from(cached.tabs.values()) : [];

  const entry: ClosedGroup = {
    uid: `${Date.now()}_${group.id}`,
    id: group.id,
    title: group.title ?? "(no name)",
    color: group.color,
    tabs,
    closedAt: Date.now(),
  };

  const data = await chrome.storage.local.get("closedGroups");
  const existing: ClosedGroup[] = data.closedGroups ?? [];
  // Remove previous entries for the same group (same title + color) — keep only the latest
  const deduplicated = existing.filter(
    (g) => !(g.title === entry.title && g.color === entry.color)
  );
  await chrome.storage.local.set({
    closedGroups: [entry, ...deduplicated].slice(0, 200),
  });

  groupCache.delete(group.id);
}

// ─── Initialisation ───────────────────────────────────────────────────────────

async function init() {
  groupCache.clear();
  tabToGroup.clear();
  groupLastSeen.clear();

  const [allGroups, allTabs, stored] = await Promise.all([
    chrome.tabGroups.query({}),
    chrome.tabs.query({}),
    chrome.storage.local.get("groupLastSeen"),
  ]);

  // Restore persisted lastSeen timestamps
  const persisted: Record<string, number> = stored.groupLastSeen ?? {};
  for (const [k, v] of Object.entries(persisted)) {
    groupLastSeen.set(Number(k), v);
  }

  for (const g of allGroups) {
    groupCache.set(g.id, {
      title: g.title ?? "(no name)",
      color: g.color,
      tabs: new Map(),
    });
    if (!groupLastSeen.has(g.id)) touchGroup(g.id);
  }
  for (const t of allTabs) {
    if (t.id != null && t.groupId != null && t.groupId > 0) {
      tabToGroup.set(t.id, t.groupId);
      groupCache.get(t.groupId)?.tabs.set(t.id, toSavedTab(t));
    }
  }
}

init();
chrome.runtime.onStartup.addListener(init);
chrome.runtime.onInstalled.addListener(init);

// ─── Tab listeners ────────────────────────────────────────────────────────────

chrome.tabs.onCreated.addListener((tab) => { setTab(tab); touchGroup(tab.groupId ?? -1); });
chrome.tabs.onUpdated.addListener((_id, _change, tab) => { setTab(tab); touchGroup(tab.groupId ?? -1); });
chrome.tabs.onRemoved.addListener((tabId, info) => removeTab(tabId, info.isWindowClosing));
chrome.tabs.onAttached.addListener(async (tabId) => {
  const tab = await chrome.tabs.get(tabId);
  setTab(tab);
});
chrome.tabs.onDetached.addListener((tabId) => removeTab(tabId, false));

// ─── Group listeners ──────────────────────────────────────────────────────────

chrome.tabGroups.onCreated.addListener((g) => {
  if (!groupCache.has(g.id)) {
    groupCache.set(g.id, { title: g.title ?? "(no name)", color: g.color, tabs: new Map() });
  }
  touchGroup(g.id);
});

chrome.tabGroups.onUpdated.addListener((g) => {
  const cached = groupCache.get(g.id);
  if (cached) {
    cached.title = g.title ?? cached.title;
    cached.color = g.color;
  } else {
    groupCache.set(g.id, { title: g.title ?? "(no name)", color: g.color, tabs: new Map() });
  }
  touchGroup(g.id);
});

chrome.tabGroups.onRemoved.addListener((g) => markGroupClosed(g));
