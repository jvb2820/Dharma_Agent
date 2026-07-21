# Post-Booking Automation Policy

## Purpose

After an appointment is confirmed and the Respond conversation is successfully assigned to the booked specialist, the automated agent must not respond until the meeting has ended.

## Lock rule

- The lock starts only after both HubSpot booking confirmation and Respond assignment succeed.
- `locked_until` is the confirmed meeting end in UTC plus the configured grace period.
- The default grace period is 60 minutes and can be changed with `RESPOND_POST_BOOKING_GRACE_MINUTES`.
- While locked, inbound messages are acknowledged by the webhook but no automated reply, classification, RAG lookup, transfer, or booking flow is run.
- The assigned specialist remains responsible for the conversation during the lock.

## Expiration and restart

- Expiration is evaluated when the next inbound customer message arrives; the bot does not send a proactive message.
- On the first inbound message after `locked_until`, the system expires the lock, unassigns the prior specialist, clears the prior in-memory booking conversation, and handles that inbound message from the beginning of the flow.
- Language is detected from the new inbound message. The initial greeting and state question are sent again.

## Failure and lifecycle rules

- A failed booking or failed Respond assignment must not create a lock.
- Meeting timestamps are stored and compared as UTC instants; customer timezone affects display only.
- Rescheduling must replace the active lock with the newly confirmed meeting timestamps.
- Cancellation must expire the active lock when cancellation integration is available.
- This policy is independent of the Customer Service transfer/handoff timeout.

## Persistence

Locks are stored in `respond_post_booking_locks`. The database migration must be applied in every deployed environment. The server also keeps the current lock in memory as a short-term runtime fallback.
