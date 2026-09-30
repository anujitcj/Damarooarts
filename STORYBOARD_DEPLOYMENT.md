# Storyboard Simulator deployment

The storyboard simulator is now `storyboard.html` and is loaded by the existing Damaroo Arts iframe.

## Cloudflare Pages
- `functions/api/[[path]].js` dispatches `/api/projects/we-before-me/storyboard`.
- `functions/api/storyboard.js` contains the D1 persistence API.
- Apply `migrations/0003_storyboard.sql` to the same D1 database already bound as `DB`.
- Cloudflare Access remains the authentication layer; editor writes require `admin` or `script_editor`.
- The simulator loads the saved project on startup and the Save button persists to D1 while also downloading a local JSON backup.

## Existing files
The original project files are preserved. The old 2D storyboard implementation is retained as `app.js`/`style.css`, but the active `storyboard.html` now uses the supplied 3D simulator.
