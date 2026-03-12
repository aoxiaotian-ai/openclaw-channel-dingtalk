/**
 * Peer ID Registry
 *
 * Maps lowercased peer/session keys back to their original case-sensitive
 * DingTalk conversationId values. DingTalk conversationIds are base64-encoded
 * and therefore case-sensitive, but the framework may lowercase session keys
 * internally. This registry preserves the original casing so outbound messages
 * can be delivered correctly.
 */

import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import * as os from "os";

const peerIdMap = new Map<string, string>();
let preloaded = false;

/**
 * Register an original peer ID, keyed by its lowercased form.
 */
export function registerPeerId(originalId: string): void {
  if (!originalId) {
    return;
  }
  peerIdMap.set(originalId.toLowerCase(), originalId);
}

/**
 * Resolve a possibly-lowercased peer ID back to its original casing.
 *
 * If the registry has not yet been populated (e.g. the outbound delivery
 * queue fires before the gateway's startAccount has run), a one-time lazy
 * preload from sessions.json is performed automatically. This ensures
 * case-sensitive conversationIds are always restored correctly, even when
 * messages are sent before the first inbound message is received.
 *
 * Returns the original if found, otherwise returns the input as-is.
 */
export function resolveOriginalPeerId(id: string): string {
  if (!id) {
    return id;
  }
  if (!preloaded) {
    preloaded = true;
    preloadPeerIdsFromSessions();
  }
  return peerIdMap.get(id.toLowerCase()) || id;
}

/**
 * Clear the registry (for testing or shutdown).
 */
export function clearPeerIdRegistry(): void {
  peerIdMap.clear();
  preloaded = false;
}

/**
 * Preload peer IDs from all agents' sessions.json files.
 *
 * This ensures case-sensitive conversationIds (e.g. DingTalk group IDs that
 * are base64-encoded) are correctly resolved even before the first inbound
 * message is received. Called explicitly at gateway startup, and also lazily
 * by resolveOriginalPeerId when the registry is still empty.
 *
 * Safe to call multiple times — subsequent calls without an explicit homeDir
 * are no-ops once the preload has already run.
 */
export function preloadPeerIdsFromSessions(homeDir?: string): void {
  // Mark as preloaded unless called with an explicit homeDir (e.g. in tests)
  if (!homeDir) {
    preloaded = true;
  }
  const home = homeDir || os.homedir();
  const agentsDir = join(home, ".openclaw", "agents");
  try {
    const agents = readdirSync(agentsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    for (const agent of agents) {
      const sessionsPath = join(agentsDir, agent, "sessions", "sessions.json");
      try {
        const raw = readFileSync(sessionsPath, "utf-8");
        const data = JSON.parse(raw) as Record<string, unknown>;
        for (const session of Object.values(data)) {
          if (!session || typeof session !== "object") continue;
          const s = session as Record<string, unknown>;
          // Register IDs from both origin and lastTo fields
          for (const field of ["from", "to", "conversationId", "openConversationId"]) {
            const origin = s.origin as Record<string, unknown> | undefined;
            const val = origin?.[field];
            if (val && typeof val === "string" && val.startsWith("cid")) {
              registerPeerId(val);
            }
          }
          // Also register lastTo directly on the session object
          const lastTo = s.lastTo;
          if (lastTo && typeof lastTo === "string" && lastTo.startsWith("cid")) {
            registerPeerId(lastTo);
          }
        }
      } catch {
        // sessions.json may not exist for all agents
      }
    }
  } catch {
    // agentsDir may not exist
  }
}
