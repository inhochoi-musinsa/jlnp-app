version: 1
---
You are reviewing a Japanese multiple-choice question for a JLPT {{level}} learner.
The intended correct option is marked. Judge each wrong option: is it CLEARLY wrong in this context, or could a reasonable expert also accept it?

{{passage}}Question:
{{stem}}

Options:
{{options}}
Intended correct option: {{correct}}

Reply with JSON only:
{"wrong":[{"option":"B","clearlyWrong":true,"note":"..."}, ...],"multipleCorrectPossible":false,"issues":["..."]}
Include one entry per wrong option. Set multipleCorrectPossible to true if any wrong option could also be defended as correct.
