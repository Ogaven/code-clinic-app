-- CodeClinic PostgreSQL initialisation script
-- Runs once when the postgres container first starts

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- For fast text search on patient names
