// What the line looks like in CATCH.AI: devices, processes, properties, events and the batch
// period type. Derived from the line config so it can't drift from what the sim reports.
import type { LineConfig, PartType, StationDef } from '../sim/config';
import { feederId, measurementName, processId, rejectProcessId, sourceProcessId, trayProcessId } from '../sim/machine';
import type { StationCode } from '../sim/types';
import { Severity, type Device, type EventDefinition, type ItemView, type Process, type PropertyDefinition } from './types';

export type PropertySpec = Omit<PropertyDefinition, 'Key' | 'Mappings'>;
export type EventSpec = Omit<EventDefinition, 'Key' | 'Mappings'>;

export interface Catalogue {
  /** Line id: the scope, the parent device and the tag in Mappings. */
  line: string;
  devices: Device[];
  processes: Process[];
  properties: PropertySpec[];
  events: EventSpec[];
  batchPeriodType: string;
  /** Genealogy: parts into pens, cartridges out of nests, pens into trays. */
  itemView: ItemView;
}

export const CARRIER_TYPE = 'Mover';

export const PROPERTY = {
  scopedId: 'Item Scoped Id',
  machineState: 'Machine State',
} as const;

export const EVENT = {
  machineState: 'Machine State',
  command: 'Command',
  batchStarted: 'Batch Started',
  batchCompleted: 'Batch Completed',
} as const;

/** CATCH.AI event per station event code. */
export const STATION_EVENTS: Record<StationCode, EventSpec> = {
  axisFault: { Name: 'Robot Axis Fault', Severity: Severity.Error },
  axisFaultCleared: { Name: 'Robot Axis Fault Cleared', Severity: Severity.Info },
  feederJam: { Name: 'Feeder Jam', Severity: Severity.Error },
  feederJamCleared: { Name: 'Feeder Jam Cleared', Severity: Severity.Info },
  rfidNoRead: { Name: 'RFID No Read', Severity: Severity.Warning },
  rfidWriteFailed: { Name: 'RFID Write Failed', Severity: Severity.Error },
  rfidWriteRecovered: { Name: 'RFID Write Recovered', Severity: Severity.Info },
};

const itemType = (part: PartType) => part[0].toUpperCase() + part.slice(1);

const FEEDER_NAMES: Record<string, string> = { body: 'Body', spring: 'Spring', housing: 'Housing + cap' };

export function catalogue(cfg: LineConfig): Catalogue {
  const line = cfg.id;
  const child = (DeviceId: string, Name: string): Device => ({ DeviceId, Name: `${DeviceId} ${Name}`, ParentDeviceId: line });
  const devices: Device[] = [{ DeviceId: line, Name: `${line} Pen injector assembly line`, Description: 'Simulated pen-injector assembly line (three.js line simulator)' }];
  const processes: Process[] = [];
  const process = (DeviceId: string, ItemType: string, extra: Partial<Process> = {}) =>
    processes.push({ Scope: line, DeviceId, ItemType, HasResult: false, HasCarrier: false, CarrierType: null, SourceItemType: null, ...extra });

  // Stations on the mover loop: one pen per cycle, on a mover.
  for (const def of cfg.stations) {
    const id = processId(cfg, def);
    devices.push(child(id, def.name));
    const merges = def.kind === 'assemble' ? itemType(def.parts![0]) : null;
    process(id, 'Pen', { HasCarrier: true, CarrierType: CARRIER_TYPE, HasResult: !!def.inspect, SourceItemType: merges });
    // The unload station's rejects are reported apart from the good pens it packs.
    const reject = rejectProcessId(cfg, def);
    if (reject !== id) {
      devices.push(child(reject, `Reject bin (${def.bin})`));
      process(reject, 'Pen', { HasCarrier: true, CarrierType: CARRIER_TYPE });
    }
  }

  // Part sources. Bodies become the pen itself at ST10, so that feeder reports no items of its own.
  for (const f of cfg.feeders) {
    const id = feederId(cfg, f.id);
    devices.push(child(id, `${FEEDER_NAMES[f.part] ?? itemType(f.part)} bowl feeder`));
    const user = cfg.stations.find((d) => d.source === f.id);
    if (user && f.part !== 'body') process(sourceProcessId(cfg, user), itemType(f.part));
  }
  for (const def of cfg.stations.filter((d) => d.source === 'nest')) {
    const id = sourceProcessId(cfg, def);
    devices.push(child(id, `Cartridge nest (${def.id})`));
    process(id, 'Cartridge', { SourceItemType: 'Nest' });
  }
  devices.push(child(trayProcessId(cfg), 'Tray packing'));
  process(trayProcessId(cfg), 'Tray', { SourceItemType: 'Pen' });

  const properties: PropertySpec[] = [
    { Name: PROPERTY.scopedId, Type: 'Integer', Description: 'Scoped id of the item the data belongs to' },
    { Name: 'Mover Id', Type: 'String', Description: 'Mover (carrier) number' },
    { Name: 'Inspection Value', Type: 'Float', NumberOfDecimals: 3 },
    { Name: 'Inspection Lower Limit', Type: 'Float', NumberOfDecimals: 3 },
    { Name: 'Inspection Upper Limit', Type: 'Float', NumberOfDecimals: 3 },
    { Name: 'Inspection Passed', Type: 'Boolean' },
    { Name: 'Reject Cause', Type: 'String' },
    { Name: 'Code Read', Type: 'String', Description: 'DataMatrix content read by final vision' },
    { Name: 'Tray Position', Type: 'Integer' },
    { Name: 'Tray Count', Type: 'Integer', Description: 'Pens in the tray when it left' },
    { Name: 'Bin', Type: 'String', Description: 'Reject bin' },
    { Name: PROPERTY.machineState, Type: 'String', Description: 'PackML-style machine state' },
    ...cfg.stations
      .filter((d): d is StationDef & { inspect: NonNullable<StationDef['inspect']> } => !!d.inspect)
      .map((d): PropertySpec => ({ Name: measurementName(d.inspect.key), Type: 'Float', Unit: d.inspect.unit, NumberOfDecimals: 3, Description: `Measured at ${d.id}` })),
  ];

  const events: EventSpec[] = [
    { Name: EVENT.machineState, Severity: Severity.Info, Description: 'Machine changed state' },
    { Name: EVENT.command, Severity: Severity.Debug, Description: 'Operator command' },
    { Name: EVENT.batchStarted, Severity: Severity.Info },
    { Name: EVENT.batchCompleted, Severity: Severity.Info },
    ...Object.values(STATION_EVENTS),
  ];

  // The server allows one relation per type pair, so twin stations share one without a process.
  const pairs = new Map<string, ItemView['Relations'][number] & { processes: Set<string> }>();
  const relate = (SourceItemType: string, TargetItemType: string, process: string) => {
    const k = `${SourceItemType}>${TargetItemType}`;
    if (!pairs.has(k)) pairs.set(k, { SourceItemType, TargetItemType, processes: new Set() });
    pairs.get(k)!.processes.add(process);
  };
  for (const def of cfg.stations.filter((d) => d.kind === 'assemble')) {
    for (const part of def.parts!) relate(itemType(part), 'Pen', processId(cfg, def));
    if (def.source === 'nest') relate('Nest', 'Cartridge', sourceProcessId(cfg, def));
  }
  relate('Pen', 'Tray', trayProcessId(cfg));
  const relations: ItemView['Relations'] = [...pairs.values()].map(({ processes, ...r }) =>
    processes.size === 1 ? { ...r, ProcessDeviceId: [...processes][0] } : r,
  );

  return { line, devices, processes, properties, events, batchPeriodType: 'Assembly Batch', itemView: { Name: `${line} Pen genealogy`, Relations: relations } };
}
