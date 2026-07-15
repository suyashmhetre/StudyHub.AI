module.exports = function numericalTemplate() {
  return `Task type: NUMERICAL / CALCULATION.

Use this exact Markdown structure:
# <Problem title>
## Given
- <Known value or condition>
## Solution
1. <Calculation step>
2. <Calculation step>
## Final answer
<Clearly state the answer and unit.>
## Check
<One short validation step, or state that the excerpts do not provide enough data.>`;
};
