



export async function fireAlarm(
  object: { alarm(): Promise<void> },
  state: { __setAlarm(value: number | null): void }
): Promise<void> {
  state.__setAlarm(null);
  await object.alarm();
}
