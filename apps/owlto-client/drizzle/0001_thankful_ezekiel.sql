CREATE TABLE `usage_daily_stats` (
	`date` text PRIMARY KEY NOT NULL,
	`token_count` integer DEFAULT 0 NOT NULL,
	`message_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `usage_model_stats` (
	`model_id` text PRIMARY KEY NOT NULL,
	`token_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
INSERT INTO `usage_daily_stats` (`date`, `token_count`, `message_count`)
SELECT
	substr(`created_at`, 1, 10),
	sum(
		CASE
			WHEN `role` = 'assistant' AND json_valid(`model_usage_json`) THEN max(
				0,
				CASE
					WHEN cast(coalesce(json_extract(`model_usage_json`, '$.totalTokens'), 0) AS integer) > 0
						THEN cast(json_extract(`model_usage_json`, '$.totalTokens') AS integer)
					ELSE
						cast(coalesce(json_extract(`model_usage_json`, '$.input'), 0) AS integer) +
						cast(coalesce(json_extract(`model_usage_json`, '$.output'), 0) AS integer) +
						cast(coalesce(json_extract(`model_usage_json`, '$.cacheRead'), 0) AS integer) +
						cast(coalesce(json_extract(`model_usage_json`, '$.cacheWrite'), 0) AS integer)
				END
			)
			ELSE 0
		END
	),
	sum(CASE WHEN `role` = 'user' THEN 1 ELSE 0 END)
FROM `messages`
WHERE `role` IN ('user', 'assistant')
GROUP BY substr(`created_at`, 1, 10);
--> statement-breakpoint
DELETE FROM `usage_daily_stats` WHERE `token_count` = 0 AND `message_count` = 0;
--> statement-breakpoint
INSERT INTO `usage_model_stats` (`model_id`, `token_count`)
SELECT
	coalesce(nullif(trim(`model_id`), ''), 'unknown'),
	sum(
		CASE
			WHEN json_valid(`model_usage_json`) THEN max(
				0,
				CASE
					WHEN cast(coalesce(json_extract(`model_usage_json`, '$.totalTokens'), 0) AS integer) > 0
						THEN cast(json_extract(`model_usage_json`, '$.totalTokens') AS integer)
					ELSE
						cast(coalesce(json_extract(`model_usage_json`, '$.input'), 0) AS integer) +
						cast(coalesce(json_extract(`model_usage_json`, '$.output'), 0) AS integer) +
						cast(coalesce(json_extract(`model_usage_json`, '$.cacheRead'), 0) AS integer) +
						cast(coalesce(json_extract(`model_usage_json`, '$.cacheWrite'), 0) AS integer)
				END
			)
			ELSE 0
		END
	)
FROM `messages`
WHERE `role` = 'assistant'
GROUP BY coalesce(nullif(trim(`model_id`), ''), 'unknown');
--> statement-breakpoint
DELETE FROM `usage_model_stats` WHERE `token_count` = 0;
--> statement-breakpoint
CREATE TRIGGER `usage_stats_messages_ai` AFTER INSERT ON `messages` BEGIN
	INSERT INTO `usage_daily_stats` (`date`, `token_count`, `message_count`)
	SELECT
		substr(new.`created_at`, 1, 10),
		CASE
			WHEN new.`role` = 'assistant' AND json_valid(new.`model_usage_json`) THEN max(
				0,
				CASE
					WHEN cast(coalesce(json_extract(new.`model_usage_json`, '$.totalTokens'), 0) AS integer) > 0
						THEN cast(json_extract(new.`model_usage_json`, '$.totalTokens') AS integer)
					ELSE
						cast(coalesce(json_extract(new.`model_usage_json`, '$.input'), 0) AS integer) +
						cast(coalesce(json_extract(new.`model_usage_json`, '$.output'), 0) AS integer) +
						cast(coalesce(json_extract(new.`model_usage_json`, '$.cacheRead'), 0) AS integer) +
						cast(coalesce(json_extract(new.`model_usage_json`, '$.cacheWrite'), 0) AS integer)
				END
			)
			ELSE 0
		END,
		CASE WHEN new.`role` = 'user' THEN 1 ELSE 0 END
	WHERE new.`role` IN ('user', 'assistant')
	ON CONFLICT (`date`) DO UPDATE SET
		`token_count` = `token_count` + excluded.`token_count`,
		`message_count` = `message_count` + excluded.`message_count`;

	INSERT INTO `usage_model_stats` (`model_id`, `token_count`)
	SELECT
		coalesce(nullif(trim(new.`model_id`), ''), 'unknown'),
		CASE
			WHEN json_valid(new.`model_usage_json`) THEN max(
				0,
				CASE
					WHEN cast(coalesce(json_extract(new.`model_usage_json`, '$.totalTokens'), 0) AS integer) > 0
						THEN cast(json_extract(new.`model_usage_json`, '$.totalTokens') AS integer)
					ELSE
						cast(coalesce(json_extract(new.`model_usage_json`, '$.input'), 0) AS integer) +
						cast(coalesce(json_extract(new.`model_usage_json`, '$.output'), 0) AS integer) +
						cast(coalesce(json_extract(new.`model_usage_json`, '$.cacheRead'), 0) AS integer) +
						cast(coalesce(json_extract(new.`model_usage_json`, '$.cacheWrite'), 0) AS integer)
				END
			)
			ELSE 0
		END
	WHERE new.`role` = 'assistant'
	ON CONFLICT (`model_id`) DO UPDATE SET
		`token_count` = `token_count` + excluded.`token_count`;

	DELETE FROM `usage_daily_stats` WHERE `token_count` = 0 AND `message_count` = 0;
	DELETE FROM `usage_model_stats` WHERE `token_count` = 0;
END;
--> statement-breakpoint
CREATE TRIGGER `usage_stats_messages_ad` AFTER DELETE ON `messages` BEGIN
	UPDATE `usage_daily_stats`
	SET
		`token_count` = max(
			0,
			`token_count` - CASE
				WHEN old.`role` = 'assistant' AND json_valid(old.`model_usage_json`) THEN max(
					0,
					CASE
						WHEN cast(coalesce(json_extract(old.`model_usage_json`, '$.totalTokens'), 0) AS integer) > 0
							THEN cast(json_extract(old.`model_usage_json`, '$.totalTokens') AS integer)
						ELSE
							cast(coalesce(json_extract(old.`model_usage_json`, '$.input'), 0) AS integer) +
							cast(coalesce(json_extract(old.`model_usage_json`, '$.output'), 0) AS integer) +
							cast(coalesce(json_extract(old.`model_usage_json`, '$.cacheRead'), 0) AS integer) +
							cast(coalesce(json_extract(old.`model_usage_json`, '$.cacheWrite'), 0) AS integer)
					END
				)
				ELSE 0
			END
		),
		`message_count` = max(0, `message_count` - CASE WHEN old.`role` = 'user' THEN 1 ELSE 0 END)
	WHERE `date` = substr(old.`created_at`, 1, 10);

	UPDATE `usage_model_stats`
	SET `token_count` = max(
		0,
		`token_count` - CASE
			WHEN json_valid(old.`model_usage_json`) THEN max(
				0,
				CASE
					WHEN cast(coalesce(json_extract(old.`model_usage_json`, '$.totalTokens'), 0) AS integer) > 0
						THEN cast(json_extract(old.`model_usage_json`, '$.totalTokens') AS integer)
					ELSE
						cast(coalesce(json_extract(old.`model_usage_json`, '$.input'), 0) AS integer) +
						cast(coalesce(json_extract(old.`model_usage_json`, '$.output'), 0) AS integer) +
						cast(coalesce(json_extract(old.`model_usage_json`, '$.cacheRead'), 0) AS integer) +
						cast(coalesce(json_extract(old.`model_usage_json`, '$.cacheWrite'), 0) AS integer)
				END
			)
			ELSE 0
		END
	)
	WHERE old.`role` = 'assistant'
		AND `model_id` = coalesce(nullif(trim(old.`model_id`), ''), 'unknown');

	DELETE FROM `usage_daily_stats` WHERE `token_count` = 0 AND `message_count` = 0;
	DELETE FROM `usage_model_stats` WHERE `token_count` = 0;
END;
--> statement-breakpoint
CREATE TRIGGER `usage_stats_messages_au`
AFTER UPDATE OF `role`, `created_at`, `model_id`, `model_usage_json` ON `messages` BEGIN
	UPDATE `usage_daily_stats`
	SET
		`token_count` = max(
			0,
			`token_count` - CASE
				WHEN old.`role` = 'assistant' AND json_valid(old.`model_usage_json`) THEN max(
					0,
					CASE
						WHEN cast(coalesce(json_extract(old.`model_usage_json`, '$.totalTokens'), 0) AS integer) > 0
							THEN cast(json_extract(old.`model_usage_json`, '$.totalTokens') AS integer)
						ELSE
							cast(coalesce(json_extract(old.`model_usage_json`, '$.input'), 0) AS integer) +
							cast(coalesce(json_extract(old.`model_usage_json`, '$.output'), 0) AS integer) +
							cast(coalesce(json_extract(old.`model_usage_json`, '$.cacheRead'), 0) AS integer) +
							cast(coalesce(json_extract(old.`model_usage_json`, '$.cacheWrite'), 0) AS integer)
					END
				)
				ELSE 0
			END
		),
		`message_count` = max(0, `message_count` - CASE WHEN old.`role` = 'user' THEN 1 ELSE 0 END)
	WHERE `date` = substr(old.`created_at`, 1, 10);

	UPDATE `usage_model_stats`
	SET `token_count` = max(
		0,
		`token_count` - CASE
			WHEN json_valid(old.`model_usage_json`) THEN max(
				0,
				CASE
					WHEN cast(coalesce(json_extract(old.`model_usage_json`, '$.totalTokens'), 0) AS integer) > 0
						THEN cast(json_extract(old.`model_usage_json`, '$.totalTokens') AS integer)
					ELSE
						cast(coalesce(json_extract(old.`model_usage_json`, '$.input'), 0) AS integer) +
						cast(coalesce(json_extract(old.`model_usage_json`, '$.output'), 0) AS integer) +
						cast(coalesce(json_extract(old.`model_usage_json`, '$.cacheRead'), 0) AS integer) +
						cast(coalesce(json_extract(old.`model_usage_json`, '$.cacheWrite'), 0) AS integer)
				END
			)
			ELSE 0
		END
	)
	WHERE old.`role` = 'assistant'
		AND `model_id` = coalesce(nullif(trim(old.`model_id`), ''), 'unknown');

	INSERT INTO `usage_daily_stats` (`date`, `token_count`, `message_count`)
	SELECT
		substr(new.`created_at`, 1, 10),
		CASE
			WHEN new.`role` = 'assistant' AND json_valid(new.`model_usage_json`) THEN max(
				0,
				CASE
					WHEN cast(coalesce(json_extract(new.`model_usage_json`, '$.totalTokens'), 0) AS integer) > 0
						THEN cast(json_extract(new.`model_usage_json`, '$.totalTokens') AS integer)
					ELSE
						cast(coalesce(json_extract(new.`model_usage_json`, '$.input'), 0) AS integer) +
						cast(coalesce(json_extract(new.`model_usage_json`, '$.output'), 0) AS integer) +
						cast(coalesce(json_extract(new.`model_usage_json`, '$.cacheRead'), 0) AS integer) +
						cast(coalesce(json_extract(new.`model_usage_json`, '$.cacheWrite'), 0) AS integer)
				END
			)
			ELSE 0
		END,
		CASE WHEN new.`role` = 'user' THEN 1 ELSE 0 END
	WHERE new.`role` IN ('user', 'assistant')
	ON CONFLICT (`date`) DO UPDATE SET
		`token_count` = `token_count` + excluded.`token_count`,
		`message_count` = `message_count` + excluded.`message_count`;

	INSERT INTO `usage_model_stats` (`model_id`, `token_count`)
	SELECT
		coalesce(nullif(trim(new.`model_id`), ''), 'unknown'),
		CASE
			WHEN json_valid(new.`model_usage_json`) THEN max(
				0,
				CASE
					WHEN cast(coalesce(json_extract(new.`model_usage_json`, '$.totalTokens'), 0) AS integer) > 0
						THEN cast(json_extract(new.`model_usage_json`, '$.totalTokens') AS integer)
					ELSE
						cast(coalesce(json_extract(new.`model_usage_json`, '$.input'), 0) AS integer) +
						cast(coalesce(json_extract(new.`model_usage_json`, '$.output'), 0) AS integer) +
						cast(coalesce(json_extract(new.`model_usage_json`, '$.cacheRead'), 0) AS integer) +
						cast(coalesce(json_extract(new.`model_usage_json`, '$.cacheWrite'), 0) AS integer)
				END
			)
			ELSE 0
		END
	WHERE new.`role` = 'assistant'
	ON CONFLICT (`model_id`) DO UPDATE SET
		`token_count` = `token_count` + excluded.`token_count`;

	DELETE FROM `usage_daily_stats` WHERE `token_count` = 0 AND `message_count` = 0;
	DELETE FROM `usage_model_stats` WHERE `token_count` = 0;
END;
