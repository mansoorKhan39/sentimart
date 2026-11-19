import re
from collections import Counter

STOPWORDS = frozenset(
    """a about above after again all also am an and any are aren't as at be because been before being
    below between both but by can can't cannot could couldn't did didn't do does doesn't doing don't
    down during each few for from further get got had hadn't has hasn't have haven't having he her
    here hers him his how i i'd i'll i'm i've if in into is isn't it it's its just like me more most
    my myself of off on once one only or other our ours out over own really same she should
    shouldn't so some such than that that's the their theirs them then there these they this those
    through to too under until up us very was wasn't we were weren't what when where which while who
    whom why will with won't would wouldn't you you'd you'll you're you've your yours bought buy
    product item thing things""".split()
)
NEGATIONS = frozenset({"not", "never", "no", "isn't", "wasn't", "doesn't", "didn't", "won't", "can't"})
TOKEN = re.compile(r"[a-z][a-z']{2,}|not|no")


def extract_keywords(text: str, limit: int = 5) -> list[str]:
    """Most frequent content words plus short negations such as 'not working'.

    Negated phrases are what sellers need for the "top complaints" view.
    """
    tokens = TOKEN.findall(text.lower())
    counts: Counter[str] = Counter()
    first_seen: dict[str, int] = {}

    def add(term: str, position: int) -> None:
        counts[term] += 1
        first_seen.setdefault(term, position)

    for i, token in enumerate(tokens):
        if token in NEGATIONS:
            nxt = tokens[i + 1] if i + 1 < len(tokens) else None
            if nxt and nxt not in STOPWORDS and nxt not in NEGATIONS:
                add(f"{token} {nxt}", i)
        elif token not in STOPWORDS:
            add(token, i)

    ranked = sorted(counts, key=lambda term: (-counts[term], first_seen[term]))
    return ranked[:limit]
