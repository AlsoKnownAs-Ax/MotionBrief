# MotionBrief

An agentic video editor: it turns a spoken recording into a motion-graphics YouTube video, generated and revised by an AI agent rather than edited by hand.

## Language

### Input

**Voiceover**:
The audio recording a video is built from; it is also the finished video's audio track.
_Avoid_: Audio, voice, recording

**Transcript**:
The words of a Voiceover with the time each word is spoken, derived from the Voiceover.
_Avoid_: Script, captions, subtitles

### Look

**Style Preset**:
A named combination of tone, color palette, and style that steers how a video looks and moves.
_Avoid_: Theme, template, settings

**Format**:
The aspect ratio of a video: vertical (9:16) or horizontal (16:9).
_Avoid_: Orientation, resolution, layout

### Structure

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
