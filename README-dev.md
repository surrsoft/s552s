# README-dev — Tab Group Search (разработчику)

## Структура проекта

```
src/
  background.ts          # Service worker (фоновый процесс расширения)
  popup/
    main.tsx             # Точка входа React-приложения
    App.tsx              # Корневой компонент, логика UI
    useTabs.ts           # React-хук: загрузка открытых и закрытых групп
    types.ts             # Общие TypeScript-интерфейсы
    styles.css           # Все стили (единый файл, без CSS-модулей)
    index.html           # HTML-обёртка попапа
public/
  icons/                 # Иконки расширения (16, 48, 128 px)
manifest.json            # Манифест Chrome Extension MV3
vite.config.ts           # Vite + @crxjs/vite-plugin
tsconfig.json
```

---

## Как собрать и установить

```bash
npm install
npm run build     # собирает в /dist
```

После сборки:
- Открыть `chrome://extensions`
- Включить «Режим разработчика»
- «Загрузить распакованное расширение» → выбрать папку `/dist`

Для разработки:
```bash
npm run dev       # hot-reload через @crxjs/vite-plugin
```

---

## Архитектура: почему два слоя

Chrome API (`chrome.tabGroups.query`) возвращает **только открытые** в данный момент группы.
Закрытых групп в API нет совсем — как только закрываешь окно, группы исчезают.

Решение — двухслойная архитектура:

```
[Service Worker]  ←→  chrome.storage.local
      ↕                       ↕
  [Popup UI]  ←──────────────┘
```

1. **Service worker** (`background.ts`) всегда работает в фоне и отслеживает все события вкладок/групп. Когда группа закрывается — сохраняет её снапшот в `storage.local`.
2. **Попап** (`useTabs.ts`) при открытии читает живые группы из API + закрытые из storage и объединяет их.

---

## Service worker (`src/background.ts`)

### Ключевая проблема с порядком событий

Есть два сценария, когда группа исчезает:

**1. Закрытие окна** — Chrome стреляет события в порядке:
```
tabs.onRemoved (isWindowClosing=true)  ← для каждой вкладки
tabGroups.onRemoved                    ← для каждой группы
```
Решение: при `isWindowClosing=true` не удаляем вкладку из кеша.

**2. Ручное закрытие последней вкладки** — `isWindowClosing=false`, но
`tabGroups.onRemoved` стреляет почти сразу после `tabs.onRemoved`.
Если удалить вкладку из кеша немедленно — к моменту `tabGroups.onRemoved`
кеш пуст и сохранять нечего.

Решение: удаление из кеша откладывается на **600 мс** (`setTimeout`).
`tabGroups.onRemoved` успевает сработать раньше и видит данные.
В `markGroupClosed()` все отложенные таймеры для вкладок этой группы
отменяются, чтобы не было рассинхрона.

### lastSeenAt — сортировка по активности

Background SW ведёт карту `groupLastSeen: Map<groupId, timestamp>`, которая обновляется при любом событии группы или вкладки внутри неё. Значения дебаунсируются (1 с) и сохраняются в `storage.local.groupLastSeen`.

В попапе `lastSeenAt` для открытых групп берётся из этого хранилища, для закрытых равен `closedAt`. Все группы сортируются по `lastSeenAt` убыванием.

### In-memory кеш

```typescript
groupCache: Map<groupId, { title, color, tabs: Map<tabId, SavedTab> }>
tabToGroup: Map<tabId, groupId>   // обратный индекс для быстрого поиска
```

Кеш живёт в памяти SW. При рестарте SW (Chrome может убить его после простоя)
кеш перестраивается через `init()` из текущего состояния Chrome API.

**Следствие**: если SW был убит непосредственно перед закрытием окна с группами,
вкладки в закрытой группе сохранятся пустыми (только название и цвет).
Это приемлемо как крайний случай.

### Хранилище (`storage.local`)

Ключ `closedGroups` — массив объектов `ClosedGroup`, не более 200 записей (FIFO).

```typescript
interface ClosedGroup {
  uid: string;       // уникальный ключ: `${timestamp}_${groupId}`
  id: number;        // оригинальный Chrome groupId (может переиспользоваться!)
  title: string;
  color: string;
  tabs: SavedTab[];  // { title, url, favIconUrl }
  closedAt: number;  // timestamp (ms)
}
```

> **Важно**: Chrome переиспользует `groupId` после закрытия группы.
> Поэтому `uid = timestamp_groupId`, а не просто `groupId`.

---

## Типы (`src/popup/types.ts`)

Единый интерфейс `TabGroup` покрывает оба состояния:

```typescript
interface TabGroup {
  uid: string;              // React key
  id: number;
  title: string;
  color: string | chrome.tabGroups.ColorEnum;
  collapsed: boolean;
  windowId: number;         // -1 для закрытых групп
  tabs: chrome.tabs.Tab[];  // живые вкладки (только открытые группы)
  closed: boolean;
  savedTabs: SavedTab[];    // снапшот вкладок (только закрытые группы)
  closedAt?: number;
}
```

Для открытой группы: `closed=false`, `tabs=[...]`, `savedTabs=[]`
Для закрытой группы: `closed=true`, `tabs=[]`, `savedTabs=[...]`

---

## Хук `useTabs` (`src/popup/useTabs.ts`)

Один `useEffect` при монтировании параллельно запрашивает:
- `chrome.tabGroups.query({})` + `chrome.tabs.query({})` — открытые группы
- `chrome.storage.local.get("closedGroups")` — закрытые из storage

Возвращает:
```typescript
{
  openGroups: TabGroup[],
  closedGroups: TabGroup[],
  loading: boolean,
  clearClosed: () => Promise<void>
}
```

`clearClosed` сбрасывает `storage.local.closedGroups` и очищает state.

---

## UI (`src/popup/App.tsx`)

### Единый список групп
Открытые и закрытые группы отображаются в одном списке, отсортированном по убыванию `lastSeenAt` (время последней активности). Визуально они одинаковы — различаются только бейджем: `opened` (зелёный) у открытых, `Xm ago` (серый) у закрытых.

Клик по вкладке открытой группы — `chrome.tabs.update` + `chrome.windows.update` (фокус).
Клик по вкладке закрытой группы — `chrome.tabs.create({ url })`.

Действия для закрытой группы:
- **↩ Restore group** (кнопка внутри раскрытой карточки) → создаёт все вкладки, группирует их с оригинальным названием и цветом
- **Клик по вкладке** → `chrome.tabs.create({ url })` (открывает URL в новой вкладке)
- **Clear all** → удаляет всю историю закрытых групп

Если `savedTabs` пуст (расширение не было активно когда группа закрылась) — показывается кнопка «Restore from Chrome session history». Она вызывает `chrome.sessions.getRecentlyClosed()`, ищет сессию с временем закрытия в пределах 60 секунд от `closedAt` и восстанавливает её. Если подходящая сессия не найдена — выводится подсказка использовать Ctrl+Shift+T.

### Поиск
Фильтрация одновременно по открытым и закрытым группам (если закрытые показаны).
Совпадения подсвечиваются через компонент `highlight()`.
Поиск идёт по: названию группы, заголовку вкладки, URL.

### Восстановление группы (`restoreGroup`)
```
1. chrome.tabs.create({ url }) × N  — создаём вкладки
2. chrome.tabs.group({ tabIds })    — группируем
3. chrome.tabGroups.update(...)     — задаём название и цвет
4. chrome.tabs.update(first, { active: true })
5. window.close()
```

---

## Разрешения (`manifest.json`)

| Разрешение | Зачем |
|---|---|
| `tabs` | Чтение URL/заголовков вкладок, создание вкладок, перефокусировка |
| `tabGroups` | Чтение/обновление/отслеживание групп |
| `storage` | `storage.local` для хранения истории закрытых групп |
| `sessions` | `chrome.sessions.getRecentlyClosed()` для восстановления групп без сохранённых URL |

---

## Сборочный инструментарий

- **Vite** + **@crxjs/vite-plugin** — плагин читает `manifest.json` как источник истины, сам находит все точки входа (popup HTML, background TS) и упаковывает расширение в `/dist`
- Background script указан в манифесте: `"background": { "service_worker": "src/background.ts" }` — crxjs подхватывает автоматически
- TypeScript strict mode включён; типы Chrome из пакета `@types/chrome`
