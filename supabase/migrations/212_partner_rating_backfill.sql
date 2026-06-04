-- Partners default to 5 stars until complaint jobs reduce the score.
-- Legacy rows were stored as 0 before complaint-based rating was implemented.
UPDATE partners
SET rating = 5
WHERE rating IS NULL OR rating = 0;
