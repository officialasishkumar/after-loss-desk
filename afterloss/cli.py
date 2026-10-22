"""Command line.

    afterloss serve                      web client + MCP endpoint + checkout endpoints on PORT (default 8300)
    afterloss simulate --weeks 8         run the synthetic estate and print the scoreboard (exit 1 if recall < 1 or a forbidden action)
    afterloss policy-check               speak every voice string the demo can produce through the policy checker
    afterloss demo                       create the demo case in the store and print its id and URL
"""

from __future__ import annotations

import os
import sys


def main(argv: list[str] | None = None) -> int:
    a = (argv if argv is not None else sys.argv[1:]) or ["help"]
    cmd = a[0]
    if cmd == "serve":
        import uvicorn
        uvicorn.run("afterloss.web:app", host="0.0.0.0", port=int(os.environ.get("PORT", "8300")), log_level="info")
        return 0
    if cmd == "simulate":
        from .simulate import run
        weeks = int(a[a.index("--weeks") + 1]) if "--weeks" in a else 8
        return run(weeks=weeks, verbose="--quiet" not in a)
    if cmd == "policy-check":
        from .simulate import policy_check
        return policy_check()
    if cmd == "demo":
        from .simulate import demo_case
        case = demo_case()
        print(case["id"], f"{os.environ.get('PUBLIC_URL', 'http://127.0.0.1:8300')}/?case={case['id']}")
        return 0
    print(__doc__)
    return 0


if __name__ == "__main__":
    sys.exit(main())
