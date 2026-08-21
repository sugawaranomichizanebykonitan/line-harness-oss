-- Career consulting booking: menus can complete immediately without staff approval.
ALTER TABLE menus ADD COLUMN auto_confirm INTEGER NOT NULL DEFAULT 0;

