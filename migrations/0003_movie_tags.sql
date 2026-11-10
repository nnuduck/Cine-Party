-- Add tags column for movie hashtags and categorization
ALTER TABLE movies ADD COLUMN tags TEXT DEFAULT '';
