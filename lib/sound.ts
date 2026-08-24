// Semantic SFX layer over cuelume — sounds are synthesized live via Web
// Audio, so there are no /public assets to load. cuelume's play() is
// SSR-safe and silently no-ops when the browser blocks audio, so callers
// can fire-and-forget. To add a global mute later, wire cuelume's
// setEnabled() to a user setting.

import { play } from "cuelume";

export const sfx = {
  completed: () => play("chime"),
  deleted: () => play("bloom"),
  allTasksComplete: () => play("sparkle"),
  taskCreated: () => play("success"),
  stepAdded: () => play("tick"),
  dropdownOpen: () => play("whisper"),
  dropdownClose: () => play("press"),
  archived: () => play("droplet"),
  restored: () => play("whisper"),
  undo: () => play("droplet"),
  redo: () => play("release"),
  copied: () => play("tick"),
  pasted: () => play("success"),
};
