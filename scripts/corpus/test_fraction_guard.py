# -*- coding: utf-8 -*-
"""Checks that a fraction is never spliced into an existing formula."""
import importlib.util
import re

spec = importlib.util.spec_from_file_location("fb", "scripts/corpus/fraction-bars.py")
fb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fb)

failures = []


def check(name, condition, detail=""):
    print("  %-34s %s" % (name, "ok" if condition else "FAIL " + detail))
    if not condition:
        failures.append(name)


# 1. A numerator that appears ONLY inside an existing formula is left alone.
inside = r"already: $\frac{9}{56}$ and nothing else" + "\n"
out = fb.splice(inside, "9", "56")
check("skips a match inside a formula", out == inside, repr(out))

# 2. The same numerator outside a formula is still spliced.
outside = "P = 9\n56\nand " + r"$\frac{1}{2}$" + " stays\n"
out2 = fb.splice(outside, "9", "56")
check("still splices outside one", r"\frac{9}{56}" in out2, repr(out2))
check("leaves the existing formula intact", r"$\frac{1}{2}$" in out2, repr(out2))

# 3. Nothing it writes is ever nested.
for label, s in (("case 1", out), ("case 2", out2)):
    nested = re.search(r"\$[^$]*\$[^$]*\$[^$]*\$", s) is not None and "frac{" in s
    inner = re.search(r"\\frac\{[^{}]*\$", s) is not None
    check("no nested delimiters in %s" % label, not inner, repr(s))

# 4. Balanced delimiters, which is what KaTeX needs.
for label, s in (("case 1", out), ("case 2", out2)):
    check("balanced $ in %s" % label, s.count("$") % 2 == 0, repr(s))

print("\n  PASS" if not failures else "\n  FAILED: " + ", ".join(failures))
