/**
 * nftables Metric Publisher
 *
 * Flattens NatRule[] into individual PlcDataMessage publishes on
 * nftables.data.{variableId}. Only publishes when a metric value changes
 * (change detection via previous value map).
 *
 * This allows tentacle-mqtt to pick up nftables metrics automatically
 * via its existing *.data.> subscription and bridge them to Sparkplug B.
 */

import type { NatsConnection } from "@nats-io/transport-deno";
import type {
  NatRule,
  NftablesConfig,
  PlcDataMessage,
} from "@tentacle/nats-schema";
import { log } from "../utils/logger.ts";

const logger = {
  get info() { return log.service.info.bind(log.service); },
  get debug() { return log.service.debug.bind(log.service); },
  get warn() { return log.service.warn.bind(log.service); },
};

type MetricValue = number | boolean | string;

interface MetricDef {
  variableId: string;
  value: MetricValue;
  datatype: "number" | "boolean" | "string";
  description: string;
}

/** Previous metric values for change detection (variableId → serialized value) */
const previousValues = new Map<string, string>();

const encoder = new TextEncoder();

/**
 * Slugify a device name for use as a NATS topic segment.
 * Lowercase, replace non-alphanumeric with dashes, collapse consecutive dashes.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Get the rule key used for NATS topic segments.
 * Uses slugified deviceName if non-empty, falls back to rule id.
 */
export function getRuleKey(rule: NatRule): string {
  const slug = rule.deviceName ? slugify(rule.deviceName) : "";
  return slug || rule.id;
}

/**
 * Extract metrics from a single NatRule.
 */
function extractRuleMetrics(rule: NatRule): MetricDef[] {
  const key = getRuleKey(rule);
  const name = rule.deviceName || key;
  return [
    { variableId: `${key}/enabled`, value: rule.enabled, datatype: "boolean", description: `${name} - Enabled` },
    { variableId: `${key}/protocol`, value: rule.protocol, datatype: "string", description: `${name} - Protocol` },
    { variableId: `${key}/connectingDevices`, value: rule.connectingDevices, datatype: "string", description: `${name} - Connecting Devices` },
    { variableId: `${key}/incomingInterface`, value: rule.incomingInterface, datatype: "string", description: `${name} - Incoming Interface` },
    { variableId: `${key}/outgoingInterface`, value: rule.outgoingInterface, datatype: "string", description: `${name} - Outgoing Interface` },
    { variableId: `${key}/natAddr`, value: rule.natAddr, datatype: "string", description: `${name} - NAT Address` },
    { variableId: `${key}/originalPort`, value: rule.originalPort, datatype: "string", description: `${name} - Original Port` },
    { variableId: `${key}/translatedPort`, value: rule.translatedPort, datatype: "string", description: `${name} - Translated Port` },
    { variableId: `${key}/deviceAddr`, value: rule.deviceAddr, datatype: "string", description: `${name} - Device Address` },
    { variableId: `${key}/deviceName`, value: rule.deviceName, datatype: "string", description: `${name} - Device Name` },
    { variableId: `${key}/doubleNat`, value: rule.doubleNat, datatype: "boolean", description: `${name} - Double NAT` },
    { variableId: `${key}/doubleNatAddr`, value: rule.doubleNatAddr, datatype: "string", description: `${name} - Double NAT Address` },
    { variableId: `${key}/comment`, value: rule.comment, datatype: "string", description: `${name} - Comment` },
  ];
}

/**
 * Serialize a value for comparison.
 */
function serialize(value: MetricValue): string {
  return JSON.stringify(value);
}

/**
 * Publish changed nftables metrics as individual PlcDataMessage to NATS.
 *
 * Called after each config read / apply. Compares current values to
 * previous and only publishes metrics that have changed.
 *
 * @returns Number of metrics published
 */
export function publishNftablesMetrics(
  nc: NatsConnection,
  config: NftablesConfig,
): number {
  const allMetrics: MetricDef[] = [];

  for (const rule of config.natRules) {
    allMetrics.push(...extractRuleMetrics(rule));
  }

  let publishCount = 0;

  for (const metric of allMetrics) {
    const serialized = serialize(metric.value);
    const prev = previousValues.get(metric.variableId);

    if (prev === serialized) continue;

    previousValues.set(metric.variableId, serialized);

    const msg: PlcDataMessage = {
      moduleId: "nftables",
      deviceId: "nftables",
      variableId: metric.variableId,
      value: metric.value,
      timestamp: Date.now(),
      datatype: metric.datatype,
      description: metric.description,
    };

    const subject = `nftables.data.${metric.variableId}`;
    nc.publish(subject, encoder.encode(JSON.stringify(msg)));
    publishCount++;
  }

  if (publishCount > 0) {
    logger.debug(`Published ${publishCount} changed nftables metric(s)`);
  }

  return publishCount;
}
