import type { ConfigDocument, UiLanguage } from "@codex-keeper/shared";
import * as TOML from "@iarna/toml";

import { ensureTrailingNewline } from "../util.js";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function getUiLanguage(record: Record<string, unknown>): UiLanguage | undefined {
  const value = getString(record, "ui_language") ?? getString(record, "uiLanguage");
  if (value === "en-US" || value === "zh-CN") {
    return value;
  }
  return undefined;
}

export function normalizeConfigDocumentInput(raw: Record<string, unknown>): ConfigDocument {
  const general = asRecord(raw.general);
  return {
    general: {
      codexHome: getString(general, "codex_home") ?? getString(general, "codexHome"),
      stateDir: getString(general, "state_dir") ?? getString(general, "stateDir"),
      uiLanguage: getUiLanguage(general),
    },
  };
}

export function mergeConfigDocuments(base: ConfigDocument, patch: ConfigDocument): ConfigDocument {
  return {
    general: {
      ...(base.general ?? {}),
      ...(patch.general ?? {}),
    },
  };
}

export function redactConfigDocument(document: ConfigDocument): ConfigDocument {
  return document;
}

export function serializeConfigDocument(document: ConfigDocument): string {
  const payload = {
    general: {
      codex_home: document.general?.codexHome,
      state_dir: document.general?.stateDir,
      ui_language: document.general?.uiLanguage,
    },
  };
  return ensureTrailingNewline(TOML.stringify(payload as TOML.JsonMap));
}
