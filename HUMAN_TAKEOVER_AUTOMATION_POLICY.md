# Human Takeover Automation Policy

## Purpose

Protect manually assigned Respond conversations from automated replies while allowing
Maria to resume after a human has finished handling the conversation.

## Lifecycle

1. Unassigned conversations remain eligible for automation.
2. When a Respond conversation is assigned to a human, an `assigned` takeover lock is
   stored. Automation remains paused without a fixed expiry while the conversation is
   assigned and open.
3. When the human closes or resolves the conversation, the lock moves to `cooldown`.
4. The default cooldown is 24 hours after closure. Configure it with
   `RESPOND_HUMAN_TAKEOVER_GRACE_MINUTES`.
5. Inbound messages during the assigned or cooldown phases are acknowledged by the
   webhook but receive no automated reply.
6. On the first inbound message after cooldown expiry, the lock expires, the previous
   assignee is removed, the prior in-memory conversation is cleared, and automation
   restarts from that message.
7. If a Respond workflow unassigns the conversation while the takeover lock is active,
   the recorded human owner is restored and automation remains paused. This applies
   during both the assigned and cooldown phases.
8. Routine automated replies never clear a live assignee. A takeover lock is released
   only through its explicit lifecycle, including cooldown expiration.

## Booking Interaction

Assignments made after a confirmed booking continue to use the separate post-booking
lock. Booking assignments are excluded from human-takeover lock creation. An active
post-booking lock takes precedence.

## Persistence

Human takeover locks are stored in `respond_human_takeover_locks`. Apply the matching
Supabase migration in every deployed environment.

## Respond Webhook Events

Configure Respond to send inbound-message, assignee-changed/unassigned, and
conversation-closed/resolved events to `/api/respond/webhook`.
