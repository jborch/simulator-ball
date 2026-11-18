// What the line looks like in CATCH.AI: devices, processes, properties, events and the batch
// period type. Derived from the line config so it can't drift from what the sim reports.
import type { LineConfig, PartType, SubProcessDef } from '../sim/config';
import { deviceName, feederId, measurementName, placers, processId, rejectProcessId, stationById, subProcessId, trayProcessId, unitId } from '../sim/machine';
import { SNAP_START } from '../sim/records';
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
/** Collets carry cartridges from EM00 to EM41 (the original line's 12 collets). */
export const COLLET_TYPE = 'Collet';

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
  pressOverload: { Name: 'Press Overload', Severity: Severity.Error },
  pressOverloadCleared: { Name: 'Press Overload Cleared', Severity: Severity.Info },
  pickMiss: { Name: 'Pick Miss', Severity: Severity.Warning },
  dialJam: { Name: 'Dial Jam', Severity: Severity.Error },
  dialJamCleared: { Name: 'Dial Jam Cleared', Severity: Severity.Info },
  labelRollEmpty: { Name: 'Label Roll Empty', Severity: Severity.Warning },
  labelRollChanged: { Name: 'Label Roll Changed', Severity: Severity.Info },
  orienterFault: { Name: 'Orienter Fault', Severity: Severity.Error },
  orienterFaultCleared: { Name: 'Orienter Fault Cleared', Severity: Severity.Info },
  destackerEmpty: { Name: 'Destacker Empty', Severity: Severity.Warning },
  destackerRefilled: { Name: 'Destacker Refilled', Severity: Severity.Info },
};

const itemType = (part: PartType) => part[0].toUpperCase() + part.slice(1);

const FEEDER_NAMES: Record<string, string> = { body: 'Body', spring: 'Spring', springBase: 'Spring base', housing: 'Housing' };

export function catalogue(cfg: LineConfig): Catalogue {
  const line = cfg.id;
  const devices: Device[] = [{ DeviceId: line, Name: deviceName(line, 'Pen injector assembly line'), Description: 'Simulated pen-injector assembly line (three.js line simulator)' }];
  // Line → units → equipment, as in the original line. Parents come before their children.
  for (const u of cfg.units) devices.push({ DeviceId: unitId(cfg, u.id), Name: deviceName(unitId(cfg, u.id), u.name), ParentDeviceId: line });
  const child = (unit: string, DeviceId: string, Name: string): Device => ({ DeviceId, Name: deviceName(DeviceId, Name), ParentDeviceId: unitId(cfg, unit) });
  const processes: Process[] = [];
  const process = (DeviceId: string, ItemType: string, extra: Partial<Process> = {}) =>
    processes.push({ Scope: line, DeviceId, ItemType, HasResult: false, HasCarrier: false, CarrierType: null, SourceItemType: null, ...extra });

  // Stations on the mover loop: one pen per cycle, on a mover.
  for (const def of cfg.stations) {
    const id = processId(cfg, def);
    devices.push(child(def.unit, id, def.name));
    // The part merged into the pen (a load station's body becomes the pen itself).
    const merged = placers(def).find((r) => r.step !== 'body')?.parts?.[0];
    process(id, 'Pen', { HasCarrier: true, CarrierType: CARRIER_TYPE, HasResult: !!def.inspect, SourceItemType: merged ? itemType(merged) : null });
    // The unload station's rejects are reported apart from the good pens it packs.
    const reject = rejectProcessId(cfg, def);
    if (reject !== id) {
      devices.push(child(def.unit, reject, `Reject bin (${def.bin})`));
      process(reject, 'Pen', { HasCarrier: true, CarrierType: CARRIER_TYPE });
    }
  }

  // Part sources. Bodies become the pen itself at the load station. Springs and spring bases are
  // reported where they are inspected (EM10, EM13), so only the other feeders report their parts.
  const subs: SubProcessDef[] = [...cfg.feeders.flatMap((f) => (f.inline ? [f.inline] : [])), cfg.orienter, cfg.dial.inspect, cfg.trays.check];
  for (const f of cfg.feeders) {
    const id = feederId(cfg, f.id);
    devices.push(child(f.unit, id, `${FEEDER_NAMES[f.part] ?? itemType(f.part)} bowl feeder`));
    // Housings are reported by the dial's EM30 when it loads them.
    const used = cfg.stations.some((d) => d.robots?.some((r) => r.source === f.id));
    if (f.part !== 'body' && used && !f.inline && f.id !== cfg.dial.feeder) process(id, itemType(f.part));
    if (f.inline) {
      devices.push(child(f.inline.unit, subProcessId(cfg, f.inline), f.inline.name));
      process(subProcessId(cfg, f.inline), itemType(f.part), { HasResult: true });
    }
  }
  devices.push(child(cfg.orienter.unit, subProcessId(cfg, cfg.orienter), cfg.orienter.name));
  process(subProcessId(cfg, cfg.orienter), itemType(cfg.feeders.find((f) => f.id === cfg.orienter.feeder)!.part), { HasResult: true });
  // The housing dial: infeed, label (the identifier) and label inspection, all on the housing.
  for (const step of [cfg.dial.load, cfg.dial.label, cfg.dial.inspect]) {
    devices.push(child(step.unit, subProcessId(cfg, step), step.name));
    process(subProcessId(cfg, step), 'Housing', { HasResult: step === cfg.dial.inspect });
  }
  // EM00 unpacks each nest (tub) of 160 into cartridges, each carried in a collet to EM41.
  const denest = cfg.cartridges.denest;
  devices.push(child(denest.unit, subProcessId(cfg, denest), denest.name));
  process(subProcessId(cfg, denest), 'Cartridge', { SourceItemType: 'Nest', HasCarrier: true, CarrierType: COLLET_TYPE });
  const trayStation = stationById(cfg, cfg.layout.tray.station);
  devices.push(child(trayStation.unit, trayProcessId(cfg), 'Tray packing'));
  process(trayProcessId(cfg), 'Tray', { SourceItemType: 'Pen' });
  // EM61 checks each tray: the line's last process, which counts the batch's output.
  const check = cfg.trays.check;
  devices.push(child(check.unit, subProcessId(cfg, check), check.name));
  process(subProcessId(cfg, check), 'Tray', { HasResult: true });

  const properties: PropertySpec[] = [
    { Name: PROPERTY.scopedId, Type: 'Integer', Description: 'Scoped id of the item the data belongs to' },
    { Name: 'Mover Id', Type: 'String', Description: 'Mover (carrier) number' },
    { Name: 'Inspection Value', Type: 'Float', NumberOfDecimals: 3 },
    { Name: 'Inspection Lower Limit', Type: 'Float', NumberOfDecimals: 3 },
    { Name: 'Inspection Upper Limit', Type: 'Float', NumberOfDecimals: 3 },
    { Name: 'Inspection Passed', Type: 'Boolean' },
    { Name: 'Reject Cause', Type: 'String' },
    { Name: 'Code Read', Type: 'String', Description: 'DataMatrix content read by final vision' },
    { Name: 'Peak Force', Type: 'Float', Unit: 'N', NumberOfDecimals: 3, Description: 'Highest force before the housing snapped (EM40)' },
    { Name: 'Snap Position', Type: 'Float', Unit: 'mm', NumberOfDecimals: 3, Description: 'Displacement where the housing snapped (EM40)' },
    { Name: 'Failure Reason', Type: 'String', Description: 'Why the snap was rejected (EM40)' },
    { Name: 'Force', Type: 'Float', Unit: 'N', NumberOfDecimals: 3, Description: 'Snap curve sample (EM40)' },
    { Name: 'Displacement', Type: 'Float', Unit: 'mm', NumberOfDecimals: 4, Description: 'Snap curve sample (EM40)' },
    { Name: 'Tray Position', Type: 'Integer' },
    { Name: 'Tray Count', Type: 'Integer', Description: 'Pens in the tray when it left' },
    { Name: 'Bin', Type: 'String', Description: 'Reject bin' },
    { Name: PROPERTY.machineState, Type: 'String', Description: 'PackML-style machine state' },
    // One property per measurement, however many stations measure it (EM14A–D).
    ...[...cfg.stations.filter((d) => d.inspect), ...subs]
      .map((d) => d.inspect!)
      .filter((lim, i, all) => all.findIndex((x) => x.key === lim.key) === i)
      .map((lim): PropertySpec => {
        const at = [...cfg.stations, ...subs].filter((d) => d.inspect?.key === lim.key).map((d) => d.id);
        return { Name: measurementName(lim.key), Type: 'Float', Unit: lim.unit, NumberOfDecimals: 3, Description: `Measured at ${at.join(', ')}` };
      }),
  ];

  const events: EventSpec[] = [
    { Name: EVENT.machineState, Severity: Severity.Info, Description: 'Machine changed state' },
    { Name: EVENT.command, Severity: Severity.Debug, Description: 'Operator command' },
    { Name: EVENT.batchStarted, Severity: Severity.Info },
    { Name: SNAP_START, Severity: Severity.Debug, Description: 'Start of a snap curve at EM40' },
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
  for (const def of cfg.stations) {
    for (const r of placers(def)) {
      if (r.step === 'body') continue;
      for (const part of r.parts ?? []) relate(itemType(part), 'Pen', processId(cfg, def));
    }
  }
  relate('Nest', 'Cartridge', subProcessId(cfg, denest));
  relate('Pen', 'Tray', trayProcessId(cfg));
  const relations: ItemView['Relations'] = [...pairs.values()].map(({ processes, ...r }) =>
    processes.size === 1 ? { ...r, ProcessDeviceId: [...processes][0] } : r,
  );

  return { line, devices, processes, properties, events, batchPeriodType: 'Assembly Batch', itemView: { Name: `${line} Pen genealogy`, Relations: relations } };
}
