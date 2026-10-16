version: 1
---
{{common}}

Task: write {{count}} grammar points. For each point also write {{questionsPerPoint}} multiple-choice questions that test it in real sentence context.
Topic hint: {{topic}}
{{extra}}

Grammar point fields:
- "pattern": the form (e.g. 〜ことにする), "attachment": how it attaches (Korean), "meaningKo", "nuanceKo" (nuance and typical use), "contrastPatterns": 1-3 similar patterns learners confuse (strings), "examples": at least 2 {ja, ko}.

Question rules (apply to every question):
- Exactly 4 choices with ids "a","b","c","d"; exactly one correct. Vary which id is correct.
- Double-check that "correctChoiceId" is the id of the ONE choice without whyWrong/howToCorrect; the other three each have both.
- Every WRONG choice has "whyWrong" and "howToCorrect" (Korean; different per choice). The correct choice has neither.
- The stem is a real sentence whose context (particles, tense, subject/actor, situation, conjunction) holds at least two cues needed to choose. Never allow solving by the ending alone.
- Choices short (<= 20 characters where possible), distinct, plausible. "explanationKo": 1-3 Korean sentences.
- domain is "GRAMMAR_FORM" (choose the form) or "TEXT_GRAMMAR" (choose what fits a short text with a blank).

Output a JSON array:
[{"point":{"pattern":"...","attachment":"...","meaningKo":"...","nuanceKo":"...","contrastPatterns":["..."],"examples":[{"ja":"...","ko":"..."},{"ja":"...","ko":"..."}]},"tags":["..."],"questions":[{"domain":"GRAMMAR_FORM","stem":"...","choices":[...],"correctChoiceId":"a","explanationKo":"...","tags":["..."]}]}]
