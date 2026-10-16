import type { ContentRecord, Kind } from "./schema";
import { KINDS } from "./schema";
import { canonicalJSON } from "./normalize";
import { sha256Hex } from "./hash";
import { computeContentHash } from "./schema";

export const PACK_FORMAT = "jlpt-pack";
export const PACK_FORMAT_VERSION = 1;

export interface AudioManifestEntry { audioKey: string; scriptHash: string; engine: string; voice: string; speed: number; durationMs?: number }
export interface PackManifest {
  packId: string; packVersion: string; createdAt: string;
  generator: { tool: string; toolVersion: string; models: { generate?: string; verify?: string } };
  targetLevels: string[]; kinds: Kind[]; counts: Partial<Record<Kind, number>>;
  license: "ORIGINAL"; hashAlgo: "sha256"; manifestHash: string;
}
export interface Pack { format: typeof PACK_FORMAT; formatVersion: number; manifest: PackManifest; items: ContentRecord[]; audioManifest: AudioManifestEntry[] }

export const countByKind = (items: ContentRecord[]): Partial<Record<Kind, number>> => {
  const c: Partial<Record<Kind, number>> = {};
  for (const i of items) c[i.kind] = (c[i.kind] ?? 0) + 1;
  return c;
};

export function computeManifestHash(m: Omit<PackManifest, "manifestHash">, items: ContentRecord[]): string {
  const hashes = items.map((i) => `${i.contentId}@${i.contentVersion}:${i.contentHash}`).sort();
  return sha256Hex(canonicalJSON(m) + "\n" + hashes.join("\n"));
}

export function buildPack(items: ContentRecord[], o: { packVersion?: string; generator: PackManifest["generator"]; now?: Date; audioManifest?: AudioManifestEntry[] }): Pack {
  const sorted = [...items].sort((a, b) => (a.contentId + a.contentVersion).localeCompare(b.contentId + b.contentVersion));
  const base: Omit<PackManifest, "manifestHash"> = {
    packId: "pack-" + sha256Hex(sorted.map((i) => i.contentHash).join(",")).slice(0, 10),
    packVersion: o.packVersion ?? "1.0.0", createdAt: (o.now ?? new Date()).toISOString(), generator: o.generator,
    targetLevels: [...new Set(sorted.map((i) => i.level))].sort(), kinds: KINDS.filter((k) => sorted.some((i) => i.kind === k)),
    counts: countByKind(sorted), license: "ORIGINAL", hashAlgo: "sha256",
  };
  return { format: PACK_FORMAT, formatVersion: PACK_FORMAT_VERSION, manifest: { ...base, manifestHash: computeManifestHash(base, sorted) }, items: sorted, audioManifest: o.audioManifest ?? [] };
}

export interface PackCheck { fileErrors: string[]; badHashItems: string[] }
/** IMP-03 equivalent: recompute every contentHash, counts and manifestHash. */
export function checkPackIntegrity(pack: Pack): PackCheck {
  const fileErrors: string[] = [];
  const badHashItems: string[] = [];
  if (pack.format !== PACK_FORMAT) fileErrors.push("format");
  if (pack.formatVersion > PACK_FORMAT_VERSION) fileErrors.push("formatVersion");
  for (const i of pack.items) if (computeContentHash(i) !== i.contentHash) badHashItems.push(i.contentId);
  const { manifestHash, ...rest } = pack.manifest;
  if (JSON.stringify(countByKind(pack.items)) !== JSON.stringify(pack.manifest.counts) && canonicalJSON(countByKind(pack.items)) !== canonicalJSON(pack.manifest.counts)) fileErrors.push("counts");
  if (computeManifestHash(rest, pack.items) !== manifestHash) fileErrors.push("manifestHash");
  return { fileErrors, badHashItems };
}
