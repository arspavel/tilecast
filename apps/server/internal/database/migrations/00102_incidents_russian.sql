-- +goose Up

-- Incident titles, descriptions and recovery notes were written in English and
-- stored with each incident, so the Russian interface showed them untranslated.
-- New incidents are created in Russian; this rewrites the stored ones. Only the
-- exact texts the server itself produced are replaced: a player's own failure
-- message kept as a description stays as reported.
CREATE TEMPORARY TABLE incident_text_ru(en TEXT PRIMARY KEY, ru TEXT NOT NULL) ON COMMIT DROP;
INSERT INTO incident_text_ru(en, ru) VALUES
    ('Screen stopped reporting', 'Экран перестал выходить на связь'),
    ('The Player stopped reporting within the expected heartbeat window.', 'Плеер не вышел на связь в ожидаемое время.'),
    ('Connection restored.', 'Связь восстановлена.'),
    ('Playback is failing', 'Сбой воспроизведения'),
    ('The renderer reported a failure.', 'Модуль показа сообщил об ошибке.'),
    ('Renderer failure reported by the Player.', 'Плеер сообщил об ошибке модуля показа.'),
    ('Media decoding failed.', 'Не удалось декодировать медиафайл.'),
    ('Decoder failure reported by the Player.', 'Плеер сообщил об ошибке декодера.'),
    ('Playback is not on screen', 'Показ не на экране'),
    ('The Player is running in the background.', 'Плеер работает в фоне.'),
    ('Another application took the foreground.', 'На экране открыто другое приложение.'),
    ('Playback resumed.', 'Показ возобновился.'),
    ('Storage is nearly full', 'Заканчивается место на устройстве'),
    ('Cache use crossed the configured pressure threshold.', 'Кэш превысил заданный порог заполнения.'),
    ('Cached media exceeds the configured cache limit.', 'Медиафайлы в кэше превышают заданный лимит.'),
    ('Storage use fell below the recovery threshold.', 'Заполнение хранилища вернулось к норме.'),
    ('Player is in safe mode', 'Плеер в безопасном режиме'),
    ('The Player entered safe mode and is not playing assigned content.', 'Плеер перешёл в безопасный режим и не показывает назначенный контент.'),
    ('Repeated playback failures escalated to safe mode.', 'Повторяющиеся сбои показа перевели плеер в безопасный режим.'),
    ('Safe mode exited.', 'Безопасный режим выключен.'),
    ('Player update failed', 'Не удалось обновить плеер'),
    ('An update did not install.', 'Обновление не установилось.'),
    ('The expected Player version reconnected.', 'Плеер вышел на связь с ожидаемой версией.'),
    ('Condition reported again.', 'Проблема повторилась.'),
    ('Screen is reporting again.', 'Экран снова на связи.'),
    ('Player stopped reporting within the expected heartbeat window.', 'Плеер не вышел на связь в ожидаемое время.'),
    ('The Player has not reported within the heartbeat grace period.', 'Плеер не выходит на связь дольше допустимого интервала.');

UPDATE incidents i SET title = t.ru FROM incident_text_ru t WHERE i.title = t.en;
UPDATE incidents i SET description = t.ru FROM incident_text_ru t WHERE i.description = t.en;
UPDATE incidents i SET probable_cause = t.ru FROM incident_text_ru t WHERE i.probable_cause = t.en;
UPDATE incidents i SET resolution_reason = t.ru FROM incident_text_ru t WHERE i.resolution_reason = t.en;
UPDATE incident_events e SET summary = t.ru FROM incident_text_ru t WHERE e.summary = t.en;

-- A screen that was archived, deleted or unpaired never reports again, so its
-- open incidents could never recover. The server now closes them on every
-- sweep; this closes the ones that accumulated before.
UPDATE incidents i SET status = 'resolved', resolved_at = now(),
    resolution_reason = COALESCE(NULLIF(i.resolution_reason, ''), 'Экран удалён, отправлен в архив или отвязан.'),
    updated_at = now()
FROM screens s
WHERE s.id = i.primary_screen_id AND i.status IN ('open', 'acknowledged')
  AND (s.archived_at IS NOT NULL OR s.deleted_at IS NOT NULL
       OR NOT EXISTS (SELECT 1 FROM device_credentials c WHERE c.screen_id = s.id AND c.revoked_at IS NULL));

-- +goose Down

-- The translation is a data change; the English texts are not restored.
SELECT 1;
