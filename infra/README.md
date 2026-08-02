# Local infrastructure notes

- Compose file: `infra/docker-compose.yml`
- Postgres 16 on host port **5433** (avoids conflicts with other local Postgres)
- Redis 7 on host port **6399** (avoids Windows Redis 3.x on 6379)
- TimescaleDB is optional; bootstrap works on plain Postgres. To enable hypertables, swap the image to `timescale/timescaledb:latest-pg16` when pull bandwidth allows.
