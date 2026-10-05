# Paid eval results

One JSON file per run of `npm run eval` (tier 3), named `<date>-<time>-v<app version>.json` and committed with the
release it judged. Each records, per case of the release set: the model per role, fallback rate, contract retries per
unit, first-try token-lint compliance, Storyboard attempts, review notes, cost and plan usage per Voiceover minute,
wall time, each scripted Revision's patch validity and scope violations; then the human verdict with its note, and
whether a stable release is blocked (fallback rate above 5%, a Storyboard failing after its retries, an incomplete
run, or a human no).

The number of results here also picks the next release's rotating Preset and Format (`src/core/eval/release-set.ts`).
