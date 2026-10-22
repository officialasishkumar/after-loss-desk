"""What may be spoken. Alexa+ add-on policy s.3 rejects an add-on that 'collects or recites private personal information via
voice'; s.9 rejects legal information presented as advice; s.13 wants a crisis redirect. These checks run on every spoken
string in tests and in the simulation, so the rule is enforced by code, not by remembering.

Spoken strings may contain: task names from the rule table, counts, day counts, dollar amounts, the 988 Lifeline number and
dates in words. They may not contain institution labels the executor typed, reference numbers, or any run of three or more
digits that is not a dollar amount, a year, or 988.
"""

from __future__ import annotations

import re
from typing import Any

CRISIS_LINE = "If any of this feels like too much, the 988 Lifeline is there, day or night."
LEGAL_LINE = "That is the court's own rule, not legal advice."
ADVICE_WORDS = ("you should sue", "this is legal advice", "my legal advice", "life-saving", "emergency intervention", "i guarantee")


def violations(text: str, case: dict[str, Any] | None = None) -> list[str]:
    out = []
    for m in re.finditer(r"(?<![$\d.])\d{3,}(?![\d.]*%)", text):
        tok = m.group(0)
        if tok == "988" or (len(tok) == 4 and tok.startswith("20")):
            continue
        out.append(f"digits spoken: {tok}")
    low = text.lower()
    for w in ADVICE_WORDS:
        if w in low:
            out.append(f"banned phrase: {w}")
    if case:
        for t in case["tasks"]:
            label = (t.get("label") or "").strip()
            if label and label.lower() not in ("bank", "pension plan", "employer", "life insurer", "power company", "phone and internet",
                                               "gym or subscription", "credit card", "vehicle") and label.lower() in low:
                out.append(f"institution label spoken: {label}")
    return out


def assert_speakable(text: str, case: dict[str, Any] | None = None) -> str:
    v = violations(text, case)
    if v:
        raise ValueError("unspeakable: " + "; ".join(v))
    return text
