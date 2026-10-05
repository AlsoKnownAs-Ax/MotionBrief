import { useState, type DragEvent } from "react";

/** Common audio and video files; anything else FFmpeg reads works too, through "All files". */
const VOICEOVER_EXTENSIONS = ["wav", "mp3", "m4a", "aac", "flac", "ogg", "opus", "aiff", "aif", "caf", "wma", "mp4", "mov", "m4v", "mkv", "webm", "avi"];

/** The native open-file dialog, for a Voiceover. Resolves to its path, or null when cancelled. */
export function chooseVoiceover() {
  return window.motionbrief.chooseFile({
    title: "Choose a Voiceover",
    filters: [
      { name: "Audio or video", extensions: VOICEOVER_EXTENSIONS },
      { name: "All files", extensions: ["*"] },
    ],
  });
}

/** Handlers that take a file dropped from the OS, and whether one is being dragged over right now. */
export function useFileDrop(onFile: (path: string) => void) {
  const [isOver, setIsOver] = useState(false);

  function hasFiles(event: DragEvent) {
    return event.dataTransfer.types.includes("Files");
  }

  return {
    isOver,
    handlers: {
      onDragOver: (event: DragEvent) => {
        if (!hasFiles(event)) {
          return;
        }

        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setIsOver(true);
      },
      onDragLeave: (event: DragEvent) => {
        // Leaving for a child element isn't leaving.
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
          return;
        }

        setIsOver(false);
      },
      onDrop: (event: DragEvent) => {
        event.preventDefault();
        setIsOver(false);
        const path = droppedPath(event);

        if (path) {
          onFile(path);
        }
      },
    },
  };
}

/** The first dropped file's path; empty when nothing on disk was dropped. */
function droppedPath(event: DragEvent) {
  const [file] = event.dataTransfer.files;

  if (!file) {
    return "";
  }

  return window.motionbrief.pathForFile(file);
}
