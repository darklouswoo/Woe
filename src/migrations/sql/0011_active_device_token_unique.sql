UPDATE clients
SET token_status = 'inactive', device_token = NULL
WHERE token_status = 'active'
  AND device_token IS NOT NULL
  AND device_token != ''
  AND id NOT IN (SELECT MAX(id) FROM clients WHERE token_status = 'active' AND device_token IS NOT NULL AND device_token != '' GROUP BY device_token);
--> statement-breakpoint
CREATE UNIQUE INDEX `clients_active_device_token_unique` ON `clients` (`device_token`) WHERE device_token IS NOT NULL AND device_token != '' AND token_status = 'active';
