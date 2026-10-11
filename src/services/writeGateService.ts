










import { eq } from "drizzle-orm";
import { systemState } from "../models/index.ts";
import { DrizzleDB } from "../drizzle/index.ts";

export const ENQUEUE_WRITE_GATE_KEY = "enqueue_write_gate";
export const ENQUEUE_WRITE_GATE_PAUSED = "paused";


export async function isEnqueueWritePaused(drizzle: DrizzleDB): Promise<boolean> {
  try {
    const row = await drizzle
      .select({ value: systemState.value })
      .from(systemState)
      .where(eq(systemState.key, ENQUEUE_WRITE_GATE_KEY))
      .get();
    return (row?.value ?? "").startsWith(ENQUEUE_WRITE_GATE_PAUSED);
  } catch {
    return false;
  }
}
