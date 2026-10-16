version: 1
---
{{common}}

Task: write {{count}} listening-comprehension items of type {{taskType}} (the audio will be synthesised from your script, so write natural spoken Japanese).
Type guide: {{typeGuide}}
Topic hint: {{topic}}
{{extra}}

Script rules:
- "segments": array of {"speaker":"M"|"F"|"N","text":"..."} where M = male voice, F = female voice, N = narrator. Use the narrator only for a short situation line when needed.
- Spoken style only (no stage directions, no names of real people or brands). Keep the whole script under 600 characters, each line under 120.
- Add "pauseMs" (300-1200) on a segment only where a natural pause belongs (e.g. after the narrator's setup).
- If a word's reading would be ambiguous for a speech engine (rare readings, numbers, dates), add "reading": the line written in hiragana/katakana only.

Question rules:
- ONE question per script, exactly 4 choices with ids "a".."d", one correct, vary which id is correct. Choices are short written lines (<= 25 characters).
- The question stem is written in Japanese and is NOT part of the audio.
- Every WRONG choice has "whyWrong" and "howToCorrect" (Korean; different per choice); the correct choice has neither. "explanationKo": 1-3 Korean sentences pointing to the evidence in the script.
- The answer must depend on listening to the script (not guessable from the choices alone).

Output a JSON array:
[{"segments":[{"speaker":"F","text":"..."},{"speaker":"M","text":"...","pauseMs":500}],"question":{"stem":"...","choices":[{"id":"a","text":"..."},{"id":"b","text":"...","whyWrong":"...","howToCorrect":"..."},{"id":"c","text":"...","whyWrong":"...","howToCorrect":"..."},{"id":"d","text":"...","whyWrong":"...","howToCorrect":"..."}],"correctChoiceId":"a","explanationKo":"..."},"tags":["..."]}]
