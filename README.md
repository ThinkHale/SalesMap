# SalesMap

SalesMap is a browser-based sales territory mapping application built with Google Maps, Firebase, CSV/Excel import, geocoding, and a lightweight plugin architecture.

## Features

- Import CSV / Excel data as map layers
- Geocode address-based datasets
- Draw points and polygons directly on the map
- Layer visibility, color, opacity, and grouping controls
- Built-in analytics panel for revenue, tier, and account insights
- Real-time workspace sync via Firebase
- Export view-only HTML map files
- Plugin support for toolbar, sidebar, context menu, storage, and events
- Undo / redo command history
- Offline caching via service worker

## Project structure

- `index.html` — main application shell and dependency loading order
- `css/styles.css` — UI styling
- `js/` — core app modules, controllers, services, managers, and utilities
- `plugins/` — example plugins and plugin UI extensions
- `sw.js` — service worker for caching static assets

## Setup

1. Open the project in a web server environment.
2. Replace the Google Maps API key and Firebase configuration in `js/config.js` and `index.html` if needed.
3. Serve the directory using a local server (for example, `npx serve .` or `python3 -m http.server`).
4. Open the app in a browser.

## Development

- All app logic is written in plain JavaScript and loaded in dependency order.
- `AppRegistry` manages shared services and singletons.
- `MapManager` handles map rendering, feature display, drawing, and tool interactions.
- `LayerManager` manages layer state, feature CRUD, groups, and persistence.
- Controllers handle import, sync, profile, drawing, and UI rendering.

## Notes

- The app uses Firebase Realtime Database for workspace persistence and real-time updates.
- The export feature generates standalone HTML using the same map rendering logic.
- The plugin system exposes scoped APIs for UI extensions, events, storage, and custom hooks.

## Known commands

- `Ctrl+O` — open CSV/Excel import
- `Ctrl+Z` / `Cmd+Z` — undo
- `Ctrl+Y` / `Ctrl+Shift+Z` / `Cmd+Shift+Z` — redo
- `Ctrl+K` / `Cmd+K` — open command palette

## License

This repository does not specify a license.
