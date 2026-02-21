/**
 * Read live nftables state directly from the kernel.
 * Always returns fresh data — never cached.
 */

import { log } from "../utils/logger.ts";

// Access logger dynamically so it picks up the wrapped logger after enableNatsLogging
const logger = {
  get info() { return log.service.info.bind(log.service); },
  get debug() { return log.service.debug.bind(log.service); },
  get warn() { return log.service.warn.bind(log.service); },
  get error() { return log.service.error.bind(log.service); },
};

/**
 * Read the current nftables ruleset as JSON.
 * Runs `nft -j list ruleset` and returns the raw JSON string.
 *
 * @returns Raw JSON string from nft, or throws on error
 */
export async function getNftablesRuleset(): Promise<string> {
  const cmd = new Deno.Command("nft", {
    args: ["-j", "list", "ruleset"],
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout, stderr } = await cmd.output();
  const stderrText = new TextDecoder().decode(stderr);

  if (code !== 0) {
    const errMsg = `nft list ruleset failed (exit ${code}): ${stderrText}`;
    logger.error(errMsg);
    throw new Error(errMsg);
  }

  const result = new TextDecoder().decode(stdout);
  logger.debug(`Read nftables ruleset (${result.length} bytes)`);
  return result;
}
