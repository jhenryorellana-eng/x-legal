/**
 * LiveKit client — DOC-20 §2 (RTC: calls and video calls).
 *
 * Generates short-lived access tokens for LiveKit Cloud rooms.
 * The token grants the `identity` (userId) a specific set of permissions
 * for the named room.
 *
 * Webhook signature verification is done in the `/api/webhooks/livekit` route
 * using `WebhookReceiver` from `livekit-server-sdk` (DOC-27 §3.1).
 *
 * Usage:
 *   const token = await createRoomToken('conv-uuid', 'user-uuid', {
 *     roomJoin: true,
 *     canPublish: true,
 *     canSubscribe: true,
 *   });
 */

import {
  AccessToken,
  VideoGrant,
  WebhookReceiver,
} from "livekit-server-sdk";
import { providerEnv } from "./env";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RoomGrants {
  /** Allow joining the room */
  roomJoin?: boolean;
  /** Allow publishing audio/video tracks */
  canPublish?: boolean;
  /** Allow subscribing to other participants' tracks */
  canSubscribe?: boolean;
  /** Allow publishing data messages */
  canPublishData?: boolean;
}

// ---------------------------------------------------------------------------
// createRoomToken
// ---------------------------------------------------------------------------

/**
 * Creates a signed LiveKit access token for a participant in a room.
 *
 * Token TTL: 1 hour (standard for calls; reconnection requires a new token).
 *
 * @param roomName - Typically the conversation UUID (`conv-{id}`)
 * @param identity - The participant's userId (used in audit / participant list)
 * @param grants - Capability grants for this participant
 * @returns Signed JWT string to pass to the LiveKit client SDK
 */
export async function createRoomToken(
  roomName: string,
  identity: string,
  grants: RoomGrants = {
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
  },
): Promise<string> {
  const lkenv = providerEnv("livekit");

  const at = new AccessToken(lkenv.LIVEKIT_API_KEY, lkenv.LIVEKIT_API_SECRET, {
    identity,
    // TTL: 1 hour
    ttl: 3600,
  });

  const videoGrant: VideoGrant = {
    room: roomName,
    roomJoin: grants.roomJoin ?? true,
    canPublish: grants.canPublish,
    canSubscribe: grants.canSubscribe,
    canPublishData: grants.canPublishData,
  };

  at.addGrant(videoGrant);

  return await at.toJwt();
}

// ---------------------------------------------------------------------------
// WebhookReceiver factory
// ---------------------------------------------------------------------------

/**
 * Returns a LiveKit WebhookReceiver for verifying incoming webhook signatures.
 *
 * Used in `/api/webhooks/livekit/route.ts`:
 *   const receiver = getLiveKitWebhookReceiver();
 *   const event = await receiver.receive(rawBody, authHeader);
 */
export function getLiveKitWebhookReceiver(): WebhookReceiver {
  const lkenv = providerEnv("livekit");
  return new WebhookReceiver(lkenv.LIVEKIT_API_KEY, lkenv.LIVEKIT_API_SECRET);
}
