import type { HyperframesPlayer } from "@hyperframes/player";
import type { DetailedHTMLProps, HTMLAttributes } from "react";

declare module "react" {
  // JSX intrinsic elements are declared by merging into this namespace's interface.
  namespace JSX {
    interface IntrinsicElements {
      "hyperframes-player": DetailedHTMLProps<HTMLAttributes<HyperframesPlayer>, HyperframesPlayer> & {
        src?: string;
        width?: number;
        height?: number;
        "assets-loading-ui"?: "player" | "none";
      };
    }
  }
}
