/**
 * Notifications module domain events.
 * No events emitted by this module in F2 (notification.delivered is observability only).
 * This file documents consumed event types for documentation purposes.
 */

export interface NotificationDeliveredEvent {
  type: "notification.delivered";
  payload: {
    notificationId: string;
    userId: string;
    type: string;
  };
  occurredAt: Date;
}
