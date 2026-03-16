# test18 Plan

- Publish mode: llm_provider
- Release strategy: Convert the local-first user registration/login prototype into an API-driven app with persisted users and a single active session contract. Keep frontend field names and snake_case keys unchanged, provide explicit CRUD-plus-session routes, and use migration-safe tables so verifier can pass write-then-read and auth smoke checks.

## Entities
- users (id, name, gender, age, created_at)
- session (user_id)
- stats (total_users, male_count, female_count, average_age)

## Routes
- GET /api/users — list all users for user list and current-user lookup
- POST /api/users — register a new user and return created record
- DELETE /api/users/:id — delete a user
- GET /api/users/stats — return total_users, male_count, female_count, average_age
- POST /api/session/login — log in by user_id and return current session user
- GET /api/session/current — return current logged-in user or null
- POST /api/session/logout — clear current session

## Tables
- users (id, name, gender, age, created_at)
- sessions (id, user_id, token, created_at, logged_out_at)

## Notes
- Frontend currently uses localStorage and mock persistence, so release artifacts should replace it with fetch-based API calls.
- Backend should return bare arrays for /api/users, a single user object for create/login/current, and a stats object for /api/users/stats.
- Register /api/users/stats before /api/users/:id to avoid Express route shadowing.
- Deleting the currently logged-in user should also invalidate the active session for correct current-session behavior.
- Schema should constrain gender to existing prototype values male and female, while staying additive and idempotent.
- Last successful publish: v2
- Preview slug: t9u3vcg4
