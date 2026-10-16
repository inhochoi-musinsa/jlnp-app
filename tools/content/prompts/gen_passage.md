version: 1
---
{{common}}

Task: write {{count}} reading passage(s) of type {{passageType}}, each with {{questionsPerPassage}} questions.
Type guide: {{typeGuide}}
Topic hint: {{topic}}
{{extra}}

Rules:
- "pages": array of strings. Split a long text into pages of at most about 150 Japanese characters each, at sentence boundaries. Short passages use 1 page.
- Questions are about the passage and answerable from it; each has exactly 4 choices (ids "a".."d"), one correct, vary the correct id. Double-check that "correctChoiceId" is the id of the ONE choice without whyWrong/howToCorrect. Wrong choices need "whyWrong" and "howToCorrect" (Korean; different per choice); the correct choice has neither. "explanationKo" cites the evidence in the passage.
- Choices short (<= 25 characters where possible).
- Passage text must be original, self-contained and free of real people, brands and facts that could be wrong.

Output a JSON array:
[{"type":"{{passageType}}","pages":["..."],"tags":["..."],"questions":[{"stem":"...","choices":[...],"correctChoiceId":"a","explanationKo":"...","tags":["..."]}]}]
