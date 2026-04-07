# Tab Group Search — Chrome Extension

Мгновенный поиск по группам вкладок Chrome.

## Стек

- React 18 + TypeScript
- Vite + `@crxjs/vite-plugin` (собирает расширение напрямую)
- Chrome Extension Manifest V3

## Установка и запуск

```bash
npm install
npm run build
```

После сборки появится папка `dist/`.

## Загрузка в Chrome

1. Открыть `chrome://extensions`
2. Включить **Developer mode** (правый верхний угол)
3. Нажать **Load unpacked**
4. Выбрать папку `dist/`

Расширение появится на панели инструментов.

## Горячая клавиша (опционально)

В `chrome://extensions/shortcuts` можно назначить сочетание клавиш для открытия попапа (например `Ctrl+Shift+F`).

## Что умеет

- Поиск по названиям групп
- Поиск по заголовкам и URL вкладок
- Подсветка совпадений
- Клик по вкладке — фокус + переключение окна
- Разворачивание/сворачивание групп прямо в попапе
- Счётчик групп и вкладок

## Структура

```
src/popup/
  App.tsx        — UI (группы, вкладки, поиск)
  useTabs.ts     — chrome.tabGroups / chrome.tabs API
  types.ts       — типы
  styles.css     — стили
  main.tsx       — точка входа
  index.html
manifest.json
vite.config.ts
```

## Кастомизация

- Цвета — CSS-переменные в `styles.css` (`:root`)
- Размер попапа — `default_width` / `default_height` в `manifest.json`
- Логика поиска — функция `filtered` в `App.tsx`
