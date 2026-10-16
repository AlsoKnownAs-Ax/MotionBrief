# A Project is a user-visible folder that references the frame by app version

A Project is a plain folder the user can see, defaulting to `Documents/MotionBrief/<name>/`, and the folder name is the Project name. Inside are JSON documents and content-addressed Scene-code units (`units/<sha256>.json`). Each Version is a JSON manifest that holds its Storyboard and Preset snapshot and maps each unit to a hash, so Versions share unchanged units for free. The Voiceover is copied in byte for byte. Everything that can be regenerated (resampled audio, raw Whisper output, previews, review stills) lives in the app's cache, keyed by content hash. Exports go wherever the user saves them. The frame, HyperFrames, GSAP, fonts, icons and brand logos are never copied into a Project. They ship with the app, and each Version records the frame contract version its units were written against. A Project stays a few MB plus its Voiceover, and it can be moved, synced or shared by copying the folder.

## Considered Options

- **App-managed library (SQLite or files in app data) with Import/Export**: rejected. It's opaque, doesn't sync or back up well, and SQLite adds a native module to Electron.
- **Single-file package (zip)**: rejected. Every autosave rewrites the archive, and the user can't see inside it.
- **Vendoring the frame into each Project**, or shipping every past frame major so old units always render with their own frame: rejected. One video can mix old units with regenerated ones, so a single assembled page can't run two frames. Vendoring would also copy MBs of fonts into every Project.
- **Referencing user Assets in the Library by path or id**: rejected. A shared Project would stop rendering without the sender's Library, and removing an Asset from the Library would break every Project that used it.
- **Copying bundled Assets into every Project**: rejected for the same reason as vendoring the frame. They ship with the app, and an append-only set makes a reference safe.

## Consequences

- Frame minor and patch releases must keep old units passing lint, `check` and the contract. The tier-2 replay fixtures enforce this. A frame major bump re-validates units when a Project is opened (no agent, zero cost). Failing units become flagged fallbacks that **Retry all flagged** can regenerate. Nothing regenerates automatically.
- `project.json` carries a schema version. A newer app migrates forward on open, after backing up the old files. An older app refuses a newer Project and asks the user to update.
- The Project autosaves and has no Save button; Versions are the only undo. Units are written as they finish, so after a crash the next open applies Stop's rules: a first generation keeps its finished units, and a Revision is discarded. Queued messages reopen paused.
- The Transcript is Project-level and not versioned. Restoring a Version keeps the current word fixes.
- Bundled Assets are referenced as `bundled:<slug>`, like the frame. The bundled set is append-only: no id is ever removed and no file changed. Each Version records the bundled-set version; an older app flags the uses it lacks and asks the user to update, and nothing regenerates silently.
- When a Version uses a user Asset from the Library, the Asset is copied into the Project with its sidecar (`assets/<sha256>.<ext>`) and becomes a Project Asset. Removing an Asset from the Library leaves every Project's copy alone. Decided in [Grilling: Library and Project portability](https://github.com/AlsoKnownAs-Ax/MotionBrief/issues/67).
- Concurrent access is prevented, not merged: a single app instance plus a `.lock` file (host and pid), with "Open anyway" when the lock is stale.
