-- migrations/0005_english_tags.sql
-- Заменяет русские жанровые теги на английские. Не трогает
-- кастомные теги пользователей (#hdrezka, #with_kolya и т.п.).
-- Порядок важен: длинные теги первыми.

UPDATE movies SET tags = REPLACE(tags, '#боевик-приключения', '#action-adventure');
UPDATE movies SET tags = REPLACE(tags, '#фантастика-фэнтези', '#sci-fi-fantasy');
UPDATE movies SET tags = REPLACE(tags, '#документальный', '#documentary');
UPDATE movies SET tags = REPLACE(tags, '#мультфильм', '#animation');
UPDATE movies SET tags = REPLACE(tags, '#приключения', '#adventure');
UPDATE movies SET tags = REPLACE(tags, '#мелодрама', '#romance');
UPDATE movies SET tags = REPLACE(tags, '#фантастика', '#sci-fi');
UPDATE movies SET tags = REPLACE(tags, '#боевик', '#action');
UPDATE movies SET tags = REPLACE(tags, '#комедия', '#comedy');
UPDATE movies SET tags = REPLACE(tags, '#криминал', '#crime');
UPDATE movies SET tags = REPLACE(tags, '#семейный', '#family');
UPDATE movies SET tags = REPLACE(tags, '#фэнтези', '#fantasy');
UPDATE movies SET tags = REPLACE(tags, '#история', '#history');
UPDATE movies SET tags = REPLACE(tags, '#детектив', '#mystery');
UPDATE movies SET tags = REPLACE(tags, '#телефильм', '#tv-movie');
UPDATE movies SET tags = REPLACE(tags, '#триллер', '#thriller');
UPDATE movies SET tags = REPLACE(tags, '#военный', '#war');
UPDATE movies SET tags = REPLACE(tags, '#вестерн', '#western');
UPDATE movies SET tags = REPLACE(tags, '#детский', '#kids');
UPDATE movies SET tags = REPLACE(tags, '#ужасы', '#horror');
UPDATE movies SET tags = REPLACE(tags, '#драма', '#drama');
UPDATE movies SET tags = REPLACE(tags, '#музыка', '#music');
