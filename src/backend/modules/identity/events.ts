/**
 * Identity module domain events.
 * These are emitted by service.ts and consumed by event bus subscribers.
 *
 * F1 additions (EV-03 per DOC-20 §5):
 * - StaffCreatedEvent      ("staff.created")       — emitted by inviteEmployee
 * - PermissionsChangedEvent ("permissions.changed") — emitted by inviteEmployee + updateEmployeePermissions
 *
 * EV-03 consumer: registered at the bottom of this file.
 * On staff.created → send staff-invite email via Resend (password passed
 * directly to inviteEmployee; it is NOT in the event payload).
 *
 * SECURITY: The temporary password NEVER travels in the event payload.
 * It is rendered directly in service.ts:buildStaffInviteEmail() and
 * sent by the service layer before the event is emitted.
 */

// ---------------------------------------------------------------------------
// Event types — F0
// ---------------------------------------------------------------------------

export interface OtpRequestedEvent {
  type: "identity.otp_requested";
  /** Always present; whether the OTP was actually sent depends on gate result (anti-enum) */
  phoneE164Masked: string;
  occurredAt: Date;
}

export interface ClientSessionEstablishedEvent {
  type: "identity.client_session_established";
  userId: string;
  occurredAt: Date;
}

export interface StaffPasswordChangedEvent {
  type: "identity.staff_password_changed";
  userId: string;
  occurredAt: Date;
}

// ---------------------------------------------------------------------------
// Event types — F1 (EV-03)
// ---------------------------------------------------------------------------

/** Emitted when a new staff member is created via inviteEmployee. */
export interface StaffCreatedEvent {
  type: "staff.created";
  payload: {
    userId: string;
    orgId: string;
    email: string;
    displayName: string;
    role: string;
    invitedBy: string;
    // NOTE: tempPassword is NOT in this payload — it travels only via email.
  };
  occurredAt: Date;
}

/** Emitted when a staff member's permission matrix is set/updated. */
export interface PermissionsChangedEvent {
  type: "permissions.changed";
  payload: {
    staffId: string;
    orgId: string;
    changedBy: string;
    permissions: Array<{
      module_key: string;
      can_view: boolean;
      can_edit: boolean;
    }>;
  };
  occurredAt: Date;
}

// ---------------------------------------------------------------------------
// Union type
// ---------------------------------------------------------------------------

export type IdentityEvent =
  | OtpRequestedEvent
  | ClientSessionEstablishedEvent
  | StaffPasswordChangedEvent
  | StaffCreatedEvent
  | PermissionsChangedEvent;
