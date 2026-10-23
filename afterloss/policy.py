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


GENERIC_LABELS = ("bank", "pension plan", "employer", "life insurer", "power company", "phone and internet", "gym or subscription", "credit card", "vehicle")
DESK_WORDING = ("I have made your list: things to tell or do, over the next few months. You will need about certified copies of the certificate. "
                "One has a firm date, within days, overdue. Shall I send the routine notices with copies on your behalf? I will still ask before "
                "money, an original, a signature or a closure; originals, signatures or closures. Nothing is due this week. I am waiting on replies and will tell you when one needs you. "
                "things need your say-so. Also due. This week. past the date I had; I have moved it to the top. Done. I have written it down. Noted. "
                "Understood. I have left that one with you. Say approve, or decline. waiting on you. The link is on your screen. Here is a letter, "
                "phone script or note. The open list will use certified copies at the county's fee. Shall I order them? Alexa will confirm the payment with you.")


def _desk_words(case: dict[str, Any]) -> set[str]:
    """Every word of the desk's own fixed wording: the rule table's spoken names and titles, the gate texts and the fixed sentences."""
    from .governor import GATE_TEXT
    text = " ".join([DESK_WORDING, CRISIS_LINE, LEGAL_LINE, *GATE_TEXT.values()] + [f"{t['spoken']} {t['title']}" for t in case["tasks"]])
    return set(re.findall(r"\w+", text.lower()))


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
        desk = _desk_words(case)
        for t in case["tasks"]:
            label = (t.get("label") or "").strip().lower()
            if not label or label in GENERIC_LABELS or all(w in desk for w in re.findall(r"\w+", label)):
                continue  # a label made only of the desk's own fixed words ("Pension", "Utility") reveals nothing the desk does not always say
            if re.search(r"(?<!\w)" + re.escape(label) + r"(?!\w)", low):
                out.append(f"institution label spoken: {label}")
    return out


def assert_speakable(text: str, case: dict[str, Any] | None = None) -> str:
    v = violations(text, case)
    if v:
        raise ValueError("unspeakable: " + "; ".join(v))
    return text
