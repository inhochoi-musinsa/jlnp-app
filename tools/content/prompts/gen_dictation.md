version: 1
---
{{common}}

Task: write {{count}} short Japanese words or sentences for DICTATION practice (the learner listens and writes what they hear in kana).
Topic hint: {{topic}}
{{extra}}

Rules:
- "text": one short word or one short sentence (at most 40 characters), natural and at or below the target level; written the usual way (kanji allowed).
- "reading": the same text written in hiragana/katakana ONLY (no kanji, no romaji, no spaces), exactly how it is pronounced. Long vowels are written the usual kana way (おかあさん, ありがとう), particles as pronounced where convention differs only in speech (は stays は).
- Include a few items that stress what Korean speakers find hard: long vowels, small っ, voiced/unvoiced pairs, particle は/へ/を.
- No duplicates.

Output a JSON array:
[{"text":"...","reading":"...","tags":["VOWEL_LENGTH"]}]
