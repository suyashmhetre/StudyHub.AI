module.exports = function comparisonTemplate() {
  return `Task type: COMPARISON.

Use this exact Markdown structure:
# <Items being compared>
## Quick answer
<One-sentence difference.>
## Comparison
| Aspect | First item | Second item |
| --- | --- | --- |
| Definition | <fact> | <fact> |
| Key characteristic | <fact> | <fact> |
| Best use | <fact> | <fact> |
## Choose which when
- <Clear context-supported recommendation>
## Revision takeaway
<One line that helps a student remember the distinction.>`;
};
