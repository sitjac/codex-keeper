import { z } from "zod";

import type {
  ConfigDocument,
  ConfigUpdateResponse,
  RenameRequest,
  SessionDetailQuery,
  SessionListQuery,
  SessionMessageRequest,
  SessionTranscriptQuery,
} from "./types.js";

const transcriptRoleSchema = z.enum(["all", "user", "assistant", "tool", "system"]);
const sessionSortFieldSchema = z.enum(["updatedAt", "project", "officialName"]);
const sortOrderSchema = z.enum(["asc", "desc"]);

const optionalTrimmedStringSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}, z.string().optional());

const optionalBooleanLikeSchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (value === true || value === "true") {
    return true;
  }
  if (value === false || value === "false") {
    return false;
  }
  return value;
}, z.boolean().optional());

const optionalPositiveIntegerSchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value === "string") {
    return Number(value);
  }
  return value;
}, z.number().int().positive().optional());

const looseConfigDocumentSchema = z.object({}).catchall(z.unknown()) as z.ZodType<ConfigDocument>;

export const sessionIndexEntrySchema = z.object({
  id: z.string().min(1),
  thread_name: z.string().min(1),
  updated_at: z.string().min(1),
});

export const sessionIndexEntryWireSchema = sessionIndexEntrySchema.transform((value) => ({
  id: value.id,
  threadName: value.thread_name,
  updatedAt: value.updated_at,
}));

export const sessionListQuerySchema: z.ZodType<SessionListQuery> = z.object({
  workspace: optionalTrimmedStringSchema,
  search: optionalTrimmedStringSchema,
  sort: z.preprocess(
    (value) => (value === "" ? undefined : value),
    sessionSortFieldSchema.optional(),
  ),
  order: z.preprocess((value) => (value === "" ? undefined : value), sortOrderSchema.optional()),
  limit: optionalPositiveIntegerSchema,
});

export const sessionDetailQuerySchema: z.ZodType<SessionDetailQuery> = z.object({
  includeTranscript: optionalBooleanLikeSchema,
});

export const sessionTranscriptQuerySchema: z.ZodType<SessionTranscriptQuery> = z.object({
  page: optionalPositiveIntegerSchema,
  pageSize: optionalPositiveIntegerSchema,
  includeHidden: optionalBooleanLikeSchema,
  role: z.preprocess(
    (value) => (value === "" ? undefined : value),
    transcriptRoleSchema.optional(),
  ),
  query: optionalTrimmedStringSchema,
});

export const renameRequestSchema: z.ZodType<RenameRequest> = z.object({
  name: z.string().trim().min(1),
});

export const sessionMessageRequestSchema: z.ZodType<SessionMessageRequest> = z.object({
  message: z.string().trim().min(1).max(64_000),
});

export const configUpdateRequestSchema: z.ZodType<ConfigUpdateResponse["config"]> =
  looseConfigDocumentSchema as unknown as z.ZodType<ConfigUpdateResponse["config"]>;
