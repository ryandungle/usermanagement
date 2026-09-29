import type { PmsType } from "@usermanagement/shared";
import { denticonAdapter } from "./denticon.js";
import { opendentalAdapter } from "./opendental.js";
import type { PmsAdapter } from "./types.js";

export type { PmsAdapter, PmsConfig, PatientListQuery, SortSpec } from "./types.js";

export function getAdapter(type: PmsType): PmsAdapter {
  switch (type) {
    case "opendental":
      return opendentalAdapter;
    case "denticon":
    default:
      return denticonAdapter;
  }
}
