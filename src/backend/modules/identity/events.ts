/**
 * Identity module domain events.
 * These are emitted by service.ts and consumed by event bus subscribers.
 */

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

export type IdentityEvent =
  | OtpRequestedEvent
  | ClientSessionEstablishedEvent
  | StaffPasswordChangedEvent;
