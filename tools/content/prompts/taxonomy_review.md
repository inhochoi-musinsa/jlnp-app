version: 1
---
You review a proposed list of Japanese grammar patterns for a JLPT {{band}} study list ({{bandNote}}).
List:
{{list}}

Return JSON only: {"remove":[{"pattern":"...","why":"duplicate|wrong level|not a grammar pattern|other"}],"missing":["important patterns of this level that are absent (max 10)"]}
Only list patterns that clearly should be removed.
