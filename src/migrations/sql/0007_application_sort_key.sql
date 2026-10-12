ALTER TABLE applications ADD COLUMN sort_key TEXT NOT NULL DEFAULT '';
--> statement-breakpoint

UPDATE applications
SET sort_key = printf('%012d', id)
WHERE sort_key IS NULL OR sort_key = '';
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_applications_user_sort_key
ON applications(user_id, sort_key, id);
