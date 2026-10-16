version: 1
---
{{common}}

Task: write {{count}} vocabulary entries.
Topic hint: {{topic}}
{{extra}}

Rules:
- "surface" is the written form (kanji if normally written with kanji). "reading" is hiragana or katakana only (long-vowel mark allowed), no kanji, no romaji, no spaces.
- "pos" is one of: noun, verb, i-adjective, na-adjective, adverb, expression, counter, other.
- "meaningKo": concise Korean meaning. "example": one natural Japanese sentence using the word plus its Korean translation.
- "levelEstimate": the JLPT level label you estimate for the word, as a string.
- "miscTags": zero or more misconception tags from the allowed list.
- No duplicates and no rare or archaic words.

Output a JSON array:
[{"surface":"...","reading":"...","pos":"noun","meaningKo":"...","example":{"ja":"...","ko":"..."},"levelEstimate":"...","miscTags":[]}]
