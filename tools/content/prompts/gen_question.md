version: 1
---
{{common}}

Task: write {{count}} multiple-choice questions.
Domain: {{domain}}
Domain guide: {{domainGuide}}
Topic hint: {{topic}}
{{extra}}

Question rules:
- Exactly 4 choices with ids "a","b","c","d" and exactly one correct choice. Vary which id is correct.
- Choices must be short (at most 20 characters each where possible), mutually distinct, and plausible.
- Before answering, double-check that "correctChoiceId" is the id of the ONE choice that has no whyWrong/howToCorrect, and that the other three each have both.
- Every WRONG choice has "whyWrong" (one Korean sentence: why it is wrong HERE) and "howToCorrect" (one Korean sentence or a corrected example showing how to fix it). The two texts must differ between wrong choices. The correct choice has neither field.
- For grammar or word-choice questions the stem must be a real sentence whose context (particles, tense, subject/actor, situation, conjunction) contains at least two cues needed to decide the answer. A stem that can be solved by looking only at the ending of the choices is not allowed.
- "explanationKo": 1-3 Korean sentences explaining the correct answer.
- Exactly one choice must be defensibly correct. Avoid answers that depend on dialect or rare usage.

Output a JSON array of objects:
[{"stem":"...","choices":[{"id":"a","text":"..."},{"id":"b","text":"...","whyWrong":"...","howToCorrect":"..."},{"id":"c","text":"...","whyWrong":"...","howToCorrect":"..."},{"id":"d","text":"...","whyWrong":"...","howToCorrect":"..."}],"correctChoiceId":"a","explanationKo":"...","tags":["..."]}]
(The correct choice may be any id; the example only shows the shape.)
