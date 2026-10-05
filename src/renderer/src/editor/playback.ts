import type { HyperframesPlayer } from "@hyperframes/player";
import { create } from "zustand";

type Playback = {
  /** The playhead, in seconds. */
  time: number;
  duration: number;
  isPlaying: boolean;
  isReady: boolean;
  /** The player was playing when its page was swapped for a newer one, so the new one plays on. */
  resumes: boolean;
  player?: HyperframesPlayer;
  attach: (player: HyperframesPlayer) => () => void;
  seek: (time: number) => void;
  togglePlay: () => void;
};

/**
 * The player's transport, shared by the player, the scrubber and the Scene timeline. While it
 * plays, the playhead follows the player every animation frame.
 */
export const usePlayback = create<Playback>((set, get) => ({
  time: 0,
  duration: 0,
  isPlaying: false,
  isReady: false,
  resumes: false,
  attach: (player) => {
    let frame = 0;

    const follow = () => {
      set({ time: player.currentTime });
      frame = requestAnimationFrame(follow);
    };
    const onReady = () => {
      set({ isReady: true, duration: player.duration });
      // A reloaded page starts where the playhead was, and plays on if the old one was playing.
      player.seek(Math.min(get().time, player.duration));

      if (get().resumes) {
        set({ resumes: false });
        player.play();
      }
    };
    const onDuration = () => set({ duration: player.duration });
    const onPlay = () => {
      set({ isPlaying: true });
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(follow);
    };
    const onPause = () => {
      // A page swapped out pauses as it leaves; that isn't the creator pausing.
      if (!player.isConnected) {
        return;
      }

      cancelAnimationFrame(frame);
      set({ isPlaying: false, time: player.currentTime });
    };
    const events = { ready: onReady, durationchange: onDuration, play: onPlay, pause: onPause, ended: onPause };

    Object.entries(events).forEach(([name, listener]) => player.addEventListener(name, listener));
    set({ player, isReady: player.ready, isPlaying: false });

    if (player.ready) {
      onReady();
    }

    return () => {
      cancelAnimationFrame(frame);
      Object.entries(events).forEach(([name, listener]) => player.removeEventListener(name, listener));
      set({ player: undefined, isReady: false, isPlaying: false, resumes: get().isPlaying });
    };
  },
  seek: (time) => {
    const { player, duration } = get();
    const clamped = Math.max(0, Math.min(time, duration || time));

    set({ time: clamped });
    player?.seek(clamped);
  },
  togglePlay: () => {
    const { player, isReady } = get();

    if (!player || !isReady) {
      return;
    }

    if (player.paused) {
      player.play();
      return;
    }

    player.pause();
  },
}));

/** `m:ss`, or `h:mm:ss` from an hour. */
export function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, "0");

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${rest}`;
  }

  return `${minutes}:${rest}`;
}
