# Eval Voiceovers (placeholder)

The paid eval (`npm run eval`) generates its videos from two Voiceovers the maintainer records and commits here,
released under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/):

| File | Length | Format | What it is |
| --- | --- | --- | --- |
| `explainer.<ext>` | about 60 s | 16:9 (horizontal) | A tech explainer: one software topic with a diagram, a flow, some code and a number |
| `short.<ext>` | about 30 s | 9:16 (vertical) | A Short: one hook, one idea, one takeaway |

Any audio file FFmpeg reads works (`explainer.wav`, `short.m4a`, ...); the eval finds each by its name.

**Not recorded yet.** Until both files are here, `npm run eval` lists what is missing and stops before any agent
turn. `npm run eval -- --dry-run` shows the release set and checks the Claude login without spending anything.

When you commit them, add a line here saying you recorded them and dedicate them to the public domain under CC0.
