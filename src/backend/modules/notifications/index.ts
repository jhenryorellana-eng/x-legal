/**
 * Notifications module — public API (module-pub boundary).
 */

export {
  notifyFromEvent,
  getNotifications,
  markRead,
  markAllRead,
  getUnreadCount,
  getPreferences,
  updatePreferences,
  registerPushSubscription,
  removePushSubscription,
  DEFAULT_PREFERENCES,
} from "./service";
export {
  findNotificationById,
  // Exported for jobs/appointment-reminders (DOC-26 §2.7 / rule R3)
  insertNotificationIdempotent,
  findUserById,
  findLeadAssignedStaff,
  // Exported for jobs/deliver-notification (push channel)
  listPushSubscriptions,
  deletePushSubscriptionByEndpoint,
} from "./repository";
export type {
  NotificationsPage,
  NotificationRow,
  NotificationPreferences,
  NotificationCategory,
  PushSubscriptionRecord,
} from "./repository";
export type { PushSubscriptionInput } from "./service";
