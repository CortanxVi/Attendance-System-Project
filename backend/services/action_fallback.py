"""Server-side liveness action fallback: blink -> move_closer after repeated blink failures.

Owner decision 2026-11-15: some students (for example very narrow eyes on a slow Android camera)
cannot pass the blink action even when they are genuine. After BLINK_FAILURES_BEFORE_FALLBACK
consecutive failures of the blink action itself (the eye-closure check or the blink head-pose
check; NOT PAD, identity, framing or timing), the next challenges issued to that student are
move_closer for FALLBACK_SECONDS or until the student completes one check-in / enrollment, after
which the action is random again.

"Consecutive" means: a blink attempt whose blink check itself PASSES resets the failure count,
even if a later check (PAD, identity, framing) then refuses the attempt
(``record_blink_pass``). Failures of other checks neither count nor reset.

Because the action is fixed when a challenge is signed, the attendance endpoint also hands the
student a replacement move_closer challenge for the SAME QR claim (same challenge id, same expiry)
in the 422 response once the fallback is active, and refuses a still-valid blink token presented
while the fallback is active (main.py ``RetryChallengeError``).

Security
--------
* The client cannot choose: the decision is taken when the signed challenge is issued, from this
  server-side state keyed by the AUTHENTICATED user id. The token format and signature are
  unchanged; the browser only sees an ordinary move_closer challenge.
* move_closer is an existing, equally verified action (PAD, identity and frame checks all still
  run), so the fallback never skips a check. A student can at most make their own next actions
  move_closer for a while by failing blinks on purpose, which they could already get from the
  random choice half the time.

Storage
-------
In memory only (production has no attempt table): thread-safe, LRU-bounded to MAX_ENTRIES, every
entry expires after FALLBACK_SECONDS. With several Backend workers each process counts on its own,
so the fallback may need a few more failures to kick in when requests land on different workers;
a restart forgets it. Both are acceptable degradations (the random action still works). Only
opaque user ids and counters are kept; no names, images or scores.
"""

from __future__ import annotations

import threading
import time
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass

BLINK_FAILURES_BEFORE_FALLBACK = 2
FALLBACK_SECONDS = 30 * 60
MAX_ENTRIES = 10_000
FALLBACK_ACTION = "move_closer"


@dataclass
class _Entry:
    failures: int = 0
    last_failure: float = 0.0
    forced_until: float = 0.0


class ActionFallbackStore:
    def __init__(
        self,
        *,
        threshold: int = BLINK_FAILURES_BEFORE_FALLBACK,
        ttl_seconds: float = FALLBACK_SECONDS,
        max_entries: int = MAX_ENTRIES,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._threshold = threshold
        self._ttl = ttl_seconds
        self._max = max_entries
        self._clock = clock
        self._entries: OrderedDict[str, _Entry] = OrderedDict()
        self._lock = threading.Lock()

    def _live_entry(self, key: str, now: float) -> _Entry | None:
        entry = self._entries.get(key)
        if entry is None:
            return None
        if entry.forced_until <= now and now - entry.last_failure >= self._ttl:
            del self._entries[key]  # nothing active and the failure streak is too old
            return None
        return entry

    def forced_action(self, user_id: str) -> str | None:
        """The action the next challenge must use for this user, or None for the random choice."""

        if not user_id:
            return None
        with self._lock:
            now = self._clock()
            entry = self._live_entry(user_id, now)
            if entry is not None and entry.forced_until > now:
                self._entries.move_to_end(user_id)
                return FALLBACK_ACTION
            return None

    def record_blink_failure(self, user_id: str) -> None:
        """Count one failure of the blink action itself."""

        if not user_id:
            return
        with self._lock:
            now = self._clock()
            entry = self._live_entry(user_id, now) or _Entry()
            entry.failures += 1
            entry.last_failure = now
            if entry.failures >= self._threshold:
                entry.forced_until = now + self._ttl
                entry.failures = 0
            self._entries[user_id] = entry
            self._entries.move_to_end(user_id)
            while len(self._entries) > self._max:
                self._entries.popitem(last=False)

    def record_blink_pass(self, user_id: str) -> None:
        """The blink check itself passed: the failure streak is broken (an active fallback stays)."""

        if not user_id:
            return
        with self._lock:
            entry = self._entries.get(user_id)
            if entry is None:
                return
            entry.failures = 0
            if entry.forced_until <= self._clock():
                del self._entries[user_id]

    def record_success(self, user_id: str) -> None:
        """A completed check-in or enrollment ends the fallback and the failure streak."""

        if not user_id:
            return
        with self._lock:
            self._entries.pop(user_id, None)

    def __len__(self) -> int:
        with self._lock:
            return len(self._entries)


action_fallback = ActionFallbackStore()
