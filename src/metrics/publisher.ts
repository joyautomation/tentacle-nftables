/**
 * nftables Metric Publisher
 *
 * Publishes one Sparkplug B UDT message per NAT rule on
 * nftables.data.{ruleKey}. The message carries the full rule as a
 * structured value with a NatRuleTemplate definition, so tentacle-mqtt
 * can publish it as a proper Sparkplug B Template Instance.
 *
 * Only publishes when a rule's aggregated value changes
 * (change detection via previous serialized value map).
 */

import type { NatsConnection } from "@nats-io/transport-deno";
import type {
  NatRule,
  NftablesConfig,
  PlcDataMessage,
} from "@tentacle/nats-schema";
import { NatRuleTemplate } from "@tentacle/nats-schema";
import { log } from "../utils/logger.ts";

const logger = {
  get info() { return log.service.info.bind(log.service); },
  get debug() { return log.service.debug.bind(log.service); },
  get warn() { return log.service.warn.bind(log.service); },
};

/** Previous serialized values for change detection (ruleKey → JSON string) */
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
 * Get the rule key used for NATS topic segments and Sparkplug B metric names.
 * Uses slugified deviceName if non-empty, falls back to rule id.
 */
export function getRuleKey(rule: NatRule): string {
  const slug = rule.deviceName ? slugify(rule.deviceName) : "";
  return slug || rule.id;
}

/**
 * Build the UDT value object for a NAT rule.
 */
function buildRuleValue(rule: NatRule): Record<string, unknown> {
  return {
    enabled: rule.enabled,
    protocol: rule.protocol,
    connectingDevices: rule.connectingDevices,
    incomingInterface: rule.incomingInterface,
    outgoingInterface: rule.outgoingInterface,
    natAddr: rule.natAddr,
    originalPort: rule.originalPort,
    translatedPort: rule.translatedPort,
    deviceAddr: rule.deviceAddr,
    deviceName: rule.deviceName,
    doubleNat: rule.doubleNat,
    doubleNatAddr: rule.doubleNatAddr,
    comment: rule.comment,
  };
}

/**
 * Publish changed NAT rules as UDT PlcDataMessages to NATS.
 *
 * Each rule is published as a single message with datatype "udt"
 * and a NatRuleTemplate definition, enabling tentacle-mqtt to create
 * a proper Sparkplug B Template Instance metric.
 *
 * @returns Number of rules published
 */
export function publishNftablesMetrics(
  nc: NatsConnection,
  config: NftablesConfig,
): number {
  let publishCount = 0;

  for (const rule of config.natRules) {
    const key = getRuleKey(rule);
    const value = buildRuleValue(rule);
    const serialized = JSON.stringify(value);

    if (previousValues.get(key) === serialized) continue;
    previousValues.set(key, serialized);

    const msg: PlcDataMessage = {
      moduleId: "nftables",
      deviceId: "nftables",
      variableId: key,
      value,
      datatype: "udt",
      udtTemplate: NatRuleTemplate,
      description: rule.deviceName ? `NAT rule: ${rule.deviceName}` : `NAT rule: ${key}`,
      timestamp: Date.now(),
    };

    nc.publish(
      `nftables.data.${key}`,
      encoder.encode(JSON.stringify(msg)),
    );
    publishCount++;
  }

  if (publishCount > 0) {
    logger.debug(`Published ${publishCount} changed NAT rule(s)`);
  }

  return publishCount;
}
