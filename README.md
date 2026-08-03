# SalesMap

SalesMap is a browser-based sales territory mapping application built with Google Maps, Firebase, CSV/Excel import, geocoding, and a lightweight plugin architecture.

## Features

- Import CSV / Excel data as map layers, keeping any custom columns as feature properties
- Geocode address-based datasets
- Draw points and polygons directly on the map
- Layer visibility, color, opacity, and grouping controls
- Style pins, clusters, and polygons by any property — one color per category, or automatic
  "smart" numeric ranges (0–100K, 100K–250K, …) with an on-map legend
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

## Production deployment

The repository includes a GitHub Pages workflow at `.github/workflows/deploy-pages.yml`. It validates the JavaScript, stages only the static application files, and deploys whenever `main` is pushed. It can also be run manually from GitHub Actions.

Before the first production test:

1. In the repository's **Settings → Pages**, select **GitHub Actions** as the publishing source.
2. In Google Cloud Console, restrict the browser key in `js/config.js` to **Websites** and add the deployed origins. For the default project Pages URL, allow:
   - `https://thinkhale.github.io/SalesMap/*`
   - `https://thinkhale.github.io/SalesMap/`
3. Ensure **Maps JavaScript API**, **Places API**, and **Geocoding API** are enabled for that key.
4. In Firebase Authentication, add `thinkhale.github.io` (and any future custom domain) to **Authorized domains**.
5. Review Firebase Realtime Database rules before sharing outside the company. The browser Firebase configuration is expected to be public; access control belongs in Authentication and Database Rules.
6. Open both the editor route and a generated share link after deployment, then confirm imports, drawing, plugins, saving, and reload behavior.

The Google Maps message shown on `127.0.0.1` or an unapproved VS Code preview origin means that origin is missing from the API key's website restrictions. It does not indicate a rendering bug in SalesMap.

## Development

- All app logic is written in plain JavaScript and loaded in dependency order.
- `AppRegistry` manages shared services and singletons.
- `MapManager` handles map rendering, feature display, drawing, and tool interactions.
- `LayerManager` manages layer state, feature CRUD, groups, and persistence.
- `PropertyService` (`js/property-service.js`) is dependency-free and shared by the app, the
  share page, and the inlined export: property discovery, numeric range grouping, and the
  style rules that map a property value to a color. A layer's styling lives in
  `layer.styleRule`; `MapManager.featureColor()` is the only place a feature's color is decided.
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
