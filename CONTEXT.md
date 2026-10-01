# MotionBrief

An agentic video editor: it turns a spoken recording into a motion-graphics YouTube video, generated and revised by an AI agent rather than edited by hand.

## Language

### Project

**Project**:
One Voiceover, its Transcript, and at most one video in each Format.
_Avoid_: Workspace, document, file

### Input

**Voiceover**:
The audio recording a video is built from; it is also the finished video's audio track.
_Avoid_: Audio, voice, recording

**Transcript**:
The words of a Voiceover with the time each word is spoken, derived from the Voiceover.
_Avoid_: Script, captions, subtitles

### Look

**Style Preset**:
A named set of choices that steers how a video looks and moves, the same in either Format: a Palette, typography and other visual treatments, a Motion, a written direction, the Transitions a video may use, how readily it uses a Canvas, and how Captions look.
_Avoid_: Theme, template, settings, tone

**Palette**:
The colors of a Style Preset, each with a fixed role (background, surface, text, accents, positive and negative).
_Avoid_: Color scheme, colors

**Motion**:
How energetically and in what manner the elements of a video move, as set by its Style Preset.
_Avoid_: Tone, animation style, energy

**Format**:
The aspect ratio of a video: vertical (9:16) or horizontal (16:9).
_Avoid_: Orientation, resolution, layout

### Structure

**Storyboard**:
The ordered Scenes of one video in one Format, with each Scene's Transcript span, Scene Type, content, and the words its elements appear on, plus the Transitions and Canvas groupings between them; written by the agent before any Scene is animated.
_Avoid_: Plan, outline, script, timeline

**Scene**:
A contiguous span of the Transcript shown as one visual composition; a video is a sequence of Scenes.
_Avoid_: Shot, slide, frame, segment, clip

**Scene Type**:
The kind of visual a Scene is, such as a diagram, a flow, or code.
_Avoid_: Template, block, layout

**Canvas**:
A layout larger than the frame, shared by consecutive Scenes, with the camera moving across it between them.
_Avoid_: Board, world, stage

**Transition**:
The change from one Scene to the next, which may carry elements of the outgoing Scene into the incoming one.
_Avoid_: Cut, effect

**Captions**:
The Transcript's words shown on screen in sync with the Voiceover, as a layer over the Scenes rather than part of any Scene.
_Avoid_: Subtitles, kinetic text

### Editing

**Revision**:
A change to a generated video made by prompting the agent, not by manual editing.
_Avoid_: Edit, regeneration, iteration

**Version**:
A saved state of a video, produced by its first generation, by a Revision, or by a style change; earlier Versions can be restored.
_Avoid_: Snapshot, revision, history entry, checkpoint
