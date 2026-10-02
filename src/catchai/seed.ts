import type { CatchAiClient } from './client';
import type { EventDefinition, PropertyDefinition } from './types';

/** Creates the device, properties and events that don't exist yet; resolves once all creates are done. */
export async function seed(
  client: CatchAiClient,
  deviceId: string,
  properties: readonly PropertyDefinition[],
  events: readonly EventDefinition[],
): Promise<number> {
  const [existingDevices, existingProps, existingEvents] = await Promise.all([
    client.getDevices(),
    client.getProperties(),
    client.getEvents(),
  ]);

  const creates: Promise<unknown>[] = [];
  if (!existingDevices.some((d) => d.DeviceId === deviceId)) {
    creates.push(client.createDevice({ DeviceId: deviceId, Name: deviceId }));
  }
  for (const p of properties) {
    if (!existingProps.some((x) => x.Key === p.Key)) creates.push(client.createProperty({ ...p }));
  }
  for (const e of events) {
    if (!existingEvents.some((x) => x.Key === e.Key)) {
      creates.push(
        client.createEvent({ Description: '', Severity: 2, IsDisabled: false, PredefinedFeedbacks: [], ...e }),
      );
    }
  }
  await Promise.all(creates);
  return creates.length;
}
