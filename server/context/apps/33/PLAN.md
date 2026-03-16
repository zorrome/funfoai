# test17 Plan

- Publish mode: llm_provider
- Release strategy: Convert the local-first user registry into an API-driven CRUD app with persisted users and persisted theme preference, preserve existing field names and statistics shape, and use migration-safe additive SQLite schema with explicit read/write routes for verifier-friendly contract alignment.

## Entities
- users (id, name, gender, age, created_at, updated_at)
- preferences (id, theme, created_at, updated_at)

## Routes
- GET /api/users — list all users for the main table
- GET /api/users/stats — return aggregated user statistics for summary cards and chart
- POST /api/users — create a new user record
- PUT /api/users/:id — update an existing user record
- DELETE /api/users/:id — delete a user record
- GET /api/preferences/theme — load saved theme preference
- PUT /api/preferences/theme — save theme preference

## Tables
- users (id, name, gender, age, created_at, updated_at)
- preferences (id, theme, created_at, updated_at)

## Notes
- Frontend currently relies on localStorage and computed in-memory stats, so release should move core user data to backend APIs.
- Keep response shapes explicit: /api/users returns a bare array, /api/users/stats returns an object with total,male_count,female_count,other_count,avg_age.
- Register static route /api/users/stats before /api/users/:id to avoid Express param conflicts.
- Theme preference may remain simple but should be API-backed for fully server-driven release consistency.
- Use snake_case fields exactly as shown in the prototype: created_at and updated_at.
