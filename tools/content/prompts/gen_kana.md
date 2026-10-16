version: 1
---
{{common}}

Task: write {{count}} pairs of kana (hiragana or katakana) that Korean-speaking beginners confuse, either because the shapes look alike (シ/ツ, ソ/ン, ぬ/め, ね/れ/わ-type pairs, は/ほ, き/さ, る/ろ ...) or because the sounds are easy to mix up for Korean speakers (ざ/じゃ-type, つ/す, ず/づ ...).
{{extra}}

Rules:
- "chars": exactly 2 DIFFERENT single kana characters (one character each, no digraphs).
- "readings": an object mapping each of the two characters to its pronunciation written in Hangul as a Korean learner would read it (e.g. シ -> "시", ツ -> "츠"). The two readings must differ.
- "confusionNoteKo": one or two Korean sentences telling how to tell the two apart (stroke direction, shape, or sound). Concrete and correct.
- No two pairs may contain the same two characters. Do not output pairs of identical-looking characters from different scripts.

Output a JSON array:
[{"chars":["シ","ツ"],"readings":{"シ":"시","ツ":"츠"},"confusionNoteKo":"...","tags":["SOKUON_YOON"]}]
