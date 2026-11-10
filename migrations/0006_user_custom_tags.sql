-- migrations/0006_user_custom_tags.sql
-- Custom user-defined hashtags, stored as JSON array
ALTER TABLE users ADD COLUMN custom_tags TEXT DEFAULT '[]';
