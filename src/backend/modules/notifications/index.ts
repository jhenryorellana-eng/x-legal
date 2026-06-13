/**
 * Notifications module — public API (module-pub boundary).
 */

export { notifyFromEvent, getNotifications, markRead } from "./service";
export {
  findNotificationById,
  // Exported for jobs/appointment-reminders (DOC-26 §2.7 / rule R3)
  insertNotificationIdempotent,
  findUserById,
  findLeadAssignedStaff,
} from "./repository";
export type { NotificationsPage, NotificationRow } from "./repository";
