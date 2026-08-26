-- 講義の「第◯回」と「テーマ」を開催枠に持たせる。
--
-- WAHMSの講義をイベント予約機能に載せるため。学校=events、各回の開催日時=
-- event_slots に対応させると、回とテーマの置き場所が無い。イベント名は
-- 学校名なので、回ごとに変わる情報は枠側に置く必要がある。
--
-- 汎用のイベント予約でも「第2部」「Aコース」のような枠名は要るので、
-- WAHMS専用の列にはしない。
ALTER TABLE event_slots ADD COLUMN title TEXT;
ALTER TABLE event_slots ADD COLUMN sequence_label TEXT;
