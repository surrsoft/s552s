export interface TabGroup {
  id: number;
  title: string;
  color: chrome.tabGroups.ColorEnum;
  collapsed: boolean;
  windowId: number;
  tabs: chrome.tabs.Tab[];
}
