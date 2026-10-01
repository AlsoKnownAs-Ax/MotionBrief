# PROTOTYPE (throwaway): Preview UX

Answers [Prototype: Preview UX](https://github.com/AlsoKnownAs-Ax/MotionBrief/issues/19): how the app looks and behaves around the preview, from first-run setup through Home and New Project to the Project screen while a video generates and is revised. Not production code.

## Run

```
node prototypes/preview-ux/serve.mjs   # http://localhost:5179/
```

It reads the CDN spike run from `prototypes/voiceover-to-video/runs/cdn/` (and two stills from `runs/code-better/`), which is not committed; regenerate it with the spike on `prototype/voiceover-to-video-spike`. The bottom strip switches screen, layout (A Editor / B Chat-first), connection type, placeholder style and the simulation clock. Useful URLs: `?screen=setup`, `?screen=new`, `?variant=A`, `?variant=B`, `&auth=apikey`, `&clock=<sim seconds>`, `&t=<playhead>`.

## Verdict

- **Layout: Variant A, Editor.** Player in the centre; right panel with Chat / Style / Versions tabs; Scene timeline below (ruler, Canvas brackets, Transition markers, Scene cards sized to their length, word lane); job status with Stop, usage and Export MP4 in the toolbar. All three panes resize with dividers (drag, arrow keys, double-click resets). B (Chat-first) is kept for comparison only; C (Script-first) was dropped.
- **Placeholder while a Scene generates: Storyboard animatic.** The Scene's planned elements appear as boxes on their spoken words.
- **Screens accepted as prototyped:** first-run setup, Home (setup checklist, recent Projects, row menu, drop-anywhere), New Project (Voiceover drop → name, Format, Style Preset, language → live Transcript with word fixes → estimate + Generate), and the open-Project prompts (stale lock "Open anyway" → paused queue with "Resume queue"; Scene-frame update notice with "Retry"; newer-Project refusal).
