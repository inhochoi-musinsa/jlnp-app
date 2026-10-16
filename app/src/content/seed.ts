import seedPack from "../../seed/seed.jlptpack.json";
import type { Pack } from "../../../shared/pack";
import type { ContentRecord } from "../../../shared/schema";

/** Built-in bootstrap pack (diagnostic + a few study items). Everything else arrives through pack import. */
export const SEED_PACK = seedPack as unknown as Pack;
export const seedRecords = (): ContentRecord[] => SEED_PACK.items;
