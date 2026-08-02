import { METRICS } from './referenceRanges'

/** Shared extraction instructions used by every provider. */
export function extractionPrompt(): string {
  const catalog = METRICS.map(
    (m) => `- ${m.key} (${m.label}; units: ${Object.keys(m.acceptedUnits).join(', ')})`,
  ).join('\n')

  return `You are extracting laboratory values from a personal medical report (the user's own document).

Extract ONLY values that are actually printed in the document — never infer, estimate, or fill in typical values. Return strict JSON matching this shape:
{"testDate": "YYYY-MM-DD or null", "labName": "string or null", "metrics": [{"key": "...", "label": "...", "value": 123, "unit": "...", "refLow": 0 or null, "refHigh": 0 or null, "note": "optional"}]}

Rules:
- Use one of these canonical keys when the test matches; otherwise use key "other":
${catalog}
- "label": the test name as printed in the document.
- "value": the numeric result exactly as printed (no unit conversion — report the printed unit in "unit").
- "refLow"/"refHigh": the reference range PRINTED IN THE DOCUMENT for that test, if any. Do not invent ranges.
- Blood pressure "120/80" becomes two metrics: bp_systolic 120 and bp_diastolic 80 (unit mmHg).
- Skip qualitative results (e.g. "negative", "normal") — numbers only.
- "testDate": the sample collection or report date if printed.
Respond with the JSON object only.`
}
