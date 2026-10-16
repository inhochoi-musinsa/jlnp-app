// Sheet tab/header contract (plan.md §6.3; `lamport` removed per execution_plan §2).
export const SHEET_NAMESPACE = "_JLPT_";
export const SHEET_SCHEMA_VERSION = 1;
export const EVENT_SCHEMA_VERSION = 1;

export const SHEET_TABS = {
  META: "_JLPT_META",
  PACKS: "_JLPT_PACKS",
  CONTENT: "_JLPT_CONTENT",
  SOURCES: "_JLPT_SOURCES",
  EVENTS: "_JLPT_EVENTS",
} as const;

export const SHEET_HEADERS: Record<keyof typeof SHEET_TABS, readonly string[]> = {
  META: ["key", "valueJson", "updatedAt", "checksum"],
  PACKS: ["packId", "packVersion", "targetLevels", "reviewStatus", "active", "publishedAt", "manifestJson", "packHash"],
  CONTENT: ["contentId", "contentVersion", "packId", "packVersion", "kind", "level", "reviewStatus", "licenseId", "payloadJson", "contentHash", "updatedAt"],
  SOURCES: ["sourceId", "rightsHolder", "originUrl", "licenseTerms", "redistributionAllowed", "recordingAllowed", "reviewer", "reviewedAt", "approvalStatus"],
  EVENTS: ["eventId", "profileId", "deviceId", "deviceSeq", "occurredAt", "type", "entityId", "eventSchemaVersion", "payloadJson", "checksum"],
};

export const EVENT_TYPES = [
  "PROFILE_CREATED", "SETTINGS_UPDATED", "SHEET_BOUND", "EXAM_TARGET_SELECTED", "EXAM_NOTICE_VERIFIED",
  "DIAGNOSTIC_STARTED", "DIAGNOSTIC_COMPLETED", "ROUTE_CHANGED", "QUESTION_PRESENTED", "QUESTION_SUBMITTED",
  "ANSWER_REVEALED", "CARD_REVIEWED", "STUDY_INTERVAL_COMPLETED", "DAILY_PLAN_CREATED", "DAILY_PLAN_REVISED",
  "ASSESSMENT_STARTED", "ASSESSMENT_COMPLETED", "CONTENT_PACK_INSTALLED", "CONTENT_PACK_ACTIVATED",
  "PACK_IMPORT_STARTED", "PACK_IMPORT_COMPLETED", "CONTENT_FLAGGED", "USER_NOTE_UPDATED",
  "OFFICIAL_RESULT_REPORTED", "ENTITY_TOMBSTONED",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];
