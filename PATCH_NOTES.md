# Patch notes

## 2026-08-03 — Offered-time confirmation

- Fixed active appointment confirmations such as “Está bien a las 2” being misread as requests to search for a different nearby time.
- When a positive reply repeats the hour of the currently offered slot, the booking flow now accepts that slot and continues to the next required booking detail.
- Negative replies and replies naming a different time continue through the availability-search flow.