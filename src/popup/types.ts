export interface SavedTab {
  title: string;
  url: string;
  favIconUrl?: string;
}

export interface TabGroup {
  /** Unique stable key for React (open: groupId, closed: "ts_groupId") */
  uid: string;
  id: number;
  title: string;
  color: chrome.tabGroups.ColorEnum | string;
  collapsed: boolean;
  windowId: number;
  /** Live tabs — populated only for open groups */
  tabs: chrome.tabs.Tab[];
  closed: boolean;
  /** Tab snapshots — populated only for closed groups */
  savedTabs: SavedTab[];
  closedAt?: number;
}
