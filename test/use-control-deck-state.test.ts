import { describe, expect, it } from "vitest";

import {
  eventRefreshResourcesForTab,
  liveRefreshResourcesForTab,
  panelResourcesForTab,
} from "../packages/web/src/control-deck-model.js";

describe("simplified reader resource planning", () => {
  it("does not load secondary panel resources", () => {
    expect(panelResourcesForTab("sessions")).toEqual([]);
  });

  it("keeps live refresh focused on sessions", () => {
    expect(liveRefreshResourcesForTab("sessions")).toEqual(["sessions"]);
  });

  it("refreshes sessions only for session-impacting events", () => {
    expect(eventRefreshResourcesForTab("sessions", [{ type: "session.renamed" }])).toEqual([
      "sessions",
    ]);
    expect(eventRefreshResourcesForTab("sessions", [{ type: "session.deleted" }])).toEqual([
      "sessions",
    ]);
    expect(eventRefreshResourcesForTab("sessions", [{ type: "scan.completed" }])).toEqual([
      "sessions",
    ]);
    expect(eventRefreshResourcesForTab("sessions", [{ type: "session.turn.completed" }])).toEqual([
      "sessions",
    ]);
  });
});
