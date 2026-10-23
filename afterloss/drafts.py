"""Notice drafting: a template per channel with every fact filled in by code. An optional language model may re-phrase the
template (set LLM_BASE_URL, LLM_MODEL and LLM_API_KEY for any OpenAI-compatible endpoint); the result is kept only if every
fact that was in the template is still in the draft, otherwise the template stands. The model proposes, code verifies.
"""

from __future__ import annotations

import json
import os
import re
import urllib.request
from typing import Any

PHONE_SCRIPTS = {
    "ssa_report": ["Call Social Security. Say: 'I am calling to report a death.'",
                   "They will ask for: the deceased's Social Security number (have the card), full name, date of birth, date of death, your name and relationship.",
                   "Ask them to confirm the date of death they recorded and whether a payment was issued after it.",
                   "Write down the representative's name and the time of the call."],
    "ssa_survivor": ["Call Social Security to book a survivor-benefits appointment; it cannot be done online.",
                     "Have ready: your own Social Security number, the marriage certificate (spouse) or birth certificate (child), the death certificate."],
    "employer_notify": ["Call the HR or benefits line. Ask for: final pay, accrued leave, any group life insurance, 401(k) or pension contact, and health-cover end date.",
                        "Ask what document they need: usually a certified copy of the death certificate."],
    "utilities_notify": ["Call the account line. Ask to move the account to your name or close it, and for the final bill to be sent to you."],
    "phone_internet_notify": ["Call the carrier. Ask to close or transfer the line; ask for the early-termination fee to be waived on death (most carriers do)."],
    "credit_card_notify": ["Call the issuer. Say the cardholder has died, ask for the account to be frozen and a final statement sent to the executor."],
}


BUREAUS = {"bureau_equifax": "Equifax", "bureau_experian": "Experian", "bureau_transunion": "TransUnion"}


def bureau_letter(case: dict[str, Any], task: dict[str, Any]) -> str:
    """A credit bureau wants a deceased alert on the file and a copy of the report, not a balance statement; the executor fills the bracketed items."""
    return (f"To: {BUREAUS.get(task['rule'], 'the credit bureau')}, deceased reports\n"
            f"[mailing address from the source on this card]\n"
            f"Re: Deceased alert for [full legal name], date of birth [date of birth], Social Security number [number]\n\n"
            f"I am writing as the {case['relationship']} and representative of the estate. The person named above died on {case['date_of_death']}.\n\n"
            f"Please: (1) place a deceased alert on the credit file; (2) do not open or approve new credit in this name; and (3) send me a "
            f"copy of the credit report.\n\n"
            f"Enclosed: a copy of the death certificate; a copy of my photo ID; and proof that I am the representative of the estate "
            f"(letters testamentary or a copy of the will).\n\n"
            f"Please reply in writing to the address above. Thank you.\n\n"
            f"Signed, the executor")


def letter(case: dict[str, Any], task: dict[str, Any]) -> str:
    if task.get("category") == "credit" and task.get("rule") in BUREAUS:
        return bureau_letter(case, task)
    label = task.get("label") or "the institution"
    enclosure = "a certified original of the death certificate" if task.get("action") == "send_original" else "a copy of the death certificate"
    return (f"To: {label}\n"
            f"Re: Notice of death of your account holder\n\n"
            f"I am writing as the {case['relationship']} and representative of the estate to inform you that your account holder died on "
            f"{case['date_of_death']}. Enclosed is {enclosure}.\n\n"
            f"Please: (1) note the date of death on the account; (2) stop any automatic charges; (3) send me a statement of the balance as of "
            f"that date; and (4) tell me what you require to release, transfer or close the account.\n\n"
            f"Please reply in writing to the address above. Thank you.\n\n"
            f"Signed, the executor")


def phone_script(task: dict[str, Any]) -> str:
    steps = PHONE_SCRIPTS.get(task["rule"], ["Call the institution and say the account holder has died; ask what they need from the executor."])
    return "\n".join(f"{i}. {s}" for i, s in enumerate(steps, 1))


def draft(case: dict[str, Any], task: dict[str, Any]) -> dict[str, Any]:
    """Return {channel, text, facts} for the task's next action."""
    if task["channel"] == "phone":
        text = phone_script(task)
    elif task["channel"] == "mail":
        text = letter(case, task)
    elif task["channel"] == "in_person":
        text = f"{('Take the original will to the clerk in person, or send it by registered or certified mail.' if task['rule'] == 'will_deliver' else 'Take the signed form and a certified copy in person.')} Keep the stamped receipt.\nRule: {task['source']['quote']}\nSource: {task['source']['url']}"
    elif task["channel"] == "checkout":
        text = "Order certified copies through Alexa+ checkout; the county mails them."
    else:
        text = f"Arrange: {task['title']}."
    facts = sorted(set(re.findall(r"\d{4}-\d{2}-\d{2}|\$\d[\d,.]*", text)) | ({task["label"]} if task.get("label") else set()))
    polished = _polish(text, facts)
    return {"channel": task["channel"], "text": polished or text, "facts": facts, "polished_by_model": bool(polished)}


def _polish(text: str, facts: list[str]) -> str | None:
    base = os.environ.get("LLM_BASE_URL")
    if not base:
        return None
    try:
        req = urllib.request.Request(base.rstrip("/") + "/chat/completions", method="POST",
                                     headers={"Content-Type": "application/json", "Authorization": f"Bearer {os.environ.get('LLM_API_KEY', 'none')}"},
                                     data=json.dumps({"model": os.environ.get("LLM_MODEL", "gpt-4o-mini"), "temperature": 0.2,
                                                      "messages": [{"role": "system", "content": "Rewrite this notice in plain, warm English. Keep every date, amount and name exactly. Do not add facts."},
                                                                   {"role": "user", "content": text}]}).encode())
        out = json.loads(urllib.request.urlopen(req, timeout=20).read())["choices"][0]["message"]["content"].strip()
    except Exception:
        return None
    return out if all(f in out for f in facts) else None
