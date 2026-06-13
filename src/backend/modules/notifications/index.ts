/**
 * Notifications module — public API (module-pub boundary).
 */

export { notifyFromEvent, getNotifications, markRead } from "./service";
export { findNotificationById } from "./repository";
export type { NotificationsPage, NotificationRow } from "./repository";
