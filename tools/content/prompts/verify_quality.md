version: 1
---
You are a strict reviewer of original Japanese study material for Korean-speaking JLPT {{level}} learners.
Review the item below (JSON). Check:
1. Level fit (vocabulary and grammar suitable for {{level}} or lower, as an educational estimate).
2. Japanese is natural and correct; Korean text is accurate and clear.
3. The answer key is correct and the Korean explanations (explanation, whyWrong, howToCorrect) are accurate.
4. For grammar / word-choice questions: the stem has at least two context cues needed to decide (not solvable from the ending alone).
5. No copied official exam material, no unsafe content.
{{readingNote}}
Item:
{{item}}

Reply with JSON only:
{"verdict":"PASS"|"REVISE"|"REJECT","issues":["specific, actionable problems; empty when PASS"],"levelFit":true,"contextCues":2}
Use REVISE for fixable problems and REJECT only when the item is unsalvageable or violates the originality rule.
