import { useState } from "react";

import { deleteSession, renameSession } from "../api.js";
import type { UiNotice } from "../control-deck-model.js";
import type {
  RenameApplyResponse,
  SessionDeleteResult,
  SessionDetail,
  SessionSummary,
} from "../types.js";

type ControlDeckActionResources = {
  detail: SessionDetail | null;
  patchSelectedSession: (threadId: string, patch: Partial<SessionSummary & SessionDetail>) => void;
  removeSession: (threadId: string) => void;
};

type ControlDeckActionUi = {
  setError: (value: string | null) => void;
  setNotice: (notice: UiNotice | null) => void;
};

export function useControlDeckActions(params: {
  resources: ControlDeckActionResources;
  ui: ControlDeckActionUi;
}) {
  const { resources, ui } = params;
  const [actioning, setActioning] = useState(false);
  const [actionLabel, setActionLabel] = useState<string | null>(null);

  const setFailure = (nextError: unknown) => {
    const message = nextError instanceof Error ? nextError.message : "Unknown error";
    ui.setError(message);
    ui.setNotice({
      tone: "error",
      text: message,
    });
  };

  const runAction = async <T>(options: {
    threadId: string;
    actionName: string;
    action: () => Promise<T>;
    onSuccess: (result: T) => {
      message: string;
      patch?: Partial<SessionSummary & SessionDetail>;
    };
  }) => {
    setActioning(true);
    setActionLabel(options.actionName);
    ui.setError(null);
    ui.setNotice({
      tone: "info",
      text: `${options.actionName}...`,
    });
    try {
      const result = await options.action();
      const success = options.onSuccess(result);
      if (success.patch) {
        resources.patchSelectedSession(options.threadId, success.patch);
      }
      ui.setNotice({
        tone: "success",
        text: success.message,
      });
      return true;
    } catch (nextError) {
      setFailure(nextError);
      return false;
    } finally {
      setActioning(false);
      setActionLabel(null);
    }
  };

  return {
    actioning,
    actionLabel,
    actions: {
      rename: (name: string): Promise<boolean> =>
        resources.detail
          ? runAction<RenameApplyResponse>({
              threadId: resources.detail.threadId,
              actionName: "Renaming session",
              action: () => renameSession(resources.detail!.threadId, name),
              onSuccess: (result) => ({
                message: result.written
                  ? `Renamed: ${result.name}`
                  : `Already named: ${result.name}`,
                patch: {
                  officialName: result.name,
                  dirty: false,
                  lastAppliedSource: "manual",
                },
              }),
            })
          : Promise.resolve(false),
      delete: (threadId: string): Promise<boolean> =>
        runAction<SessionDeleteResult>({
          threadId,
          actionName: "Deleting session",
          action: () => deleteSession(threadId),
          onSuccess: (result) => {
            if (result.deleted) {
              resources.removeSession(threadId);
            }
            return {
              message: result.deleted ? "Deleted session." : "Session was already deleted.",
            };
          },
        }),
    },
  };
}
