#How to run : Open new terminal
#             cd BigFish
#             python -m ML.src.workers.pii_regex

"""
Pattern-based PII detection on OCR text.

BERT-NER only finds names, places and organizations. Emails, phone numbers
and ID numbers have fixed formats, so they are found with patterns here.
The patterns and checksums match apps/extension/safety/privacy.ts, so the
screenshot and the DOM text pipeline mask the same values.
"""

import re

from ML.src.schema import Detection

EMAIL = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
# Separated groups like +91 98765 43210, (415) 555-0134, 415-555-0134, or a bare Indian mobile.
PHONE = re.compile(
    r"(?<![\w/=?&#.:%-])(?:\+\d{1,3}[\s.-]?)?"
    r"(?:\(\d{3}\)\s?\d{3}[\s.-]\d{4}|\d{3}[\s.-]\d{3}[\s.-]\d{4}|\d{5}\s\d{5}|[6-9]\d{9})"
    r"(?![\w/=&#-])"
)
PAN = re.compile(r"\b[A-Z]{5}[0-9]{4}[A-Z]\b")
AADHAAR = re.compile(r"(?<![\d-])[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}(?![\d-])")
# 15-16 digits (Visa, Mastercard, Amex, RuPay), not inside a URL or a longer number.
CARD = re.compile(r"(?<![\w/=?&#.:%-])\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{3,4}(?![\w-])")
SSN = re.compile(r"(?<![\d-])\d{3}-\d{2}-\d{4}(?![\d-])")
URL = re.compile(r"\bhttps?://[^\s<>\"'{}|\\^`]+|\bwww\.[^\s<>\"'{}|\\^`]+", re.IGNORECASE)


def luhn_valid(value: str) -> bool:
    digits = re.sub(r"\D", "", value)
    if not 13 <= len(digits) <= 19:
        return False
    total = 0
    for i, ch in enumerate(reversed(digits)):
        d = int(ch)
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


_VERHOEFF_D = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
]
_VERHOEFF_P = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
]


def verhoeff_valid(value: str) -> bool:
    """Aadhaar numbers end in a Verhoeff check digit."""
    digits = re.sub(r"\D", "", value)
    if len(digits) != 12:
        return False
    c = 0
    for i, ch in enumerate(reversed(digits)):
        c = _VERHOEFF_D[c][_VERHOEFF_P[i % 8][int(ch)]]
    return c == 0


# Checked in this order. A span taken by an earlier type is not reused, so a
# card number is never also reported as a phone number.
_RULES = [
    ("EMAIL", EMAIL, None),
    ("PAN", PAN, None),
    ("CREDIT_CARD", CARD, luhn_valid),
    ("AADHAAR", AADHAAR, verhoeff_valid),
    ("SSN", SSN, None),
    ("PHONE", PHONE, None),
]


class PIIRegexDetector:
    """Finds fixed-format PII in text and returns span-only detections."""

    def detect(self, text: str) -> list[Detection]:
        if not text or not text.strip():
            return []

        # URLs are never masked: the agent must read and open them.
        taken = [(m.start(), m.end()) for m in URL.finditer(text)]
        detections = []

        for entity_type, pattern, check in _RULES:
            for match in pattern.finditer(text):
                start, end = match.span()
                if any(start < t_end and t_start < end for t_start, t_end in taken):
                    continue
                if check is not None and not check(match.group()):
                    continue
                taken.append((start, end))
                detections.append(
                    Detection(
                        type=entity_type,
                        source="regex",
                        confidence=1.0,
                        text=match.group(),
                        text_span={"start": start, "end": end},
                    )
                )

        return detections


if __name__ == "__main__":
    sample = "Mail priya@example.test or call +91 98765 43210. PAN ABCDE1234F."
    for detection in PIIRegexDetector().detect(sample):
        print(detection.to_dict())
