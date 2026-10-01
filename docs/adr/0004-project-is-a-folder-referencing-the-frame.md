# A Project is a user-visible folder that references the frame by app version

A Project is a plain folder the user can see, defaulting to `Documents/MotionBrief/<name>/`, and the folder name is the Project name. Inside are JSON documents and content-addressed Scene-code units (`units/<sha256>.html`). Each Version is a JSON manifest that holds its Storyboard and Preset snapshot and maps each unit to a hash, so Versions share unchanged units for free. The Voiceover is copied in byte for byte. Everything that can be regenerated (resampled audio, raw Whisper output, previews, review stills) lives in the app's cache, keyed by content hash. Exports go wherever the user saves them. The frame, HyperFrames, GSAP, fonts, icons and brand logos are never copied into a Project. They ship with the app, and each Version records the frame contract version its units were written against. A Project stays a few MB plus its Voiceover, and it can be moved, synced or shared by copying the folder.

## Considered Options

- **App-managed library (SQLite or files in app data) with Import/Export**: rejected. It's opaque, doesn't sync or back up well, and SQLite adds a native module to Electron.
- **Single-file package (zip)**: rejected. Every autosave rewrites the archive, and the user can't see inside it.
- **Vendoring the frame into each Project**, or shipping every past frame major so old units always render with their own frame: rejected. One video can mix old units with regenerated ones, so a single assembled page can't run two frames. Vendoring would also copy MBs of fonts into every Project.

## Consequences

- Frame minor and patch releases must keep old units passing lint, `check` and the contract. The tier-2 replay fixtures enforce this. A frame major bump re-validates units when a Project is opened (no agent, zero cost). Failing units become flagged fallbacks that **Retry all flagged** can regenerate. Nothing regenerates automatically.
- `project.json` carries a schema version. A newer app migrates forward on open, after backing up the old files. An older app refuses a newer Project and asks the user to update.
- The Project autosaves and has no Save button; Versions are the only undo. Units are written as they finish, so after a crash the next open applies Stop's rules: a first generation keeps its finished units, and a Revision is discarded. Queued messages reopen paused.
- The Transcript is Project-level and not versioned. Restoring a Version keeps the current word fixes.
- Concurrent access is prevented, not merged: a single app instance plus a `.lock` file (host and pid), with "Open anyway" when the lock is stale.
