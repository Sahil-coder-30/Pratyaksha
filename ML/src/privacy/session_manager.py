#             $env:USE_TF = "0"
#             python -m ML.src.privacy.session_manager

from uuid import uuid4


class SessionManager:
    """
    Manages session-local entity IDs.

    IDs are unique within this manager's lifetime. A stable key may
    reuse an ID only when an upstream component has established that
    two detections refer to the same entity.
    """

    def __init__(self, session_id: str | None = None):
        self.session_id = session_id or f"session_{uuid4().hex}"
        self._counter = 0
        self._ids_by_stable_key: dict[str, str] = {}

    def assign_entity_id(
        self,
        stable_key: str | None = None,
    ) -> str:
        """
        Return an entity ID.

        If stable_key is supplied, reuse its existing ID.
        Otherwise, allocate a new unique ID.
        """
        if stable_key is not None:
            existing_id = self._ids_by_stable_key.get(stable_key)
            if existing_id is not None:
                return existing_id

        self._counter += 1
        entity_id = f"ENTITY_{self._counter:04d}"

        if stable_key is not None:
            self._ids_by_stable_key[stable_key] = entity_id

        return entity_id

    def reset(self, session_id: str | None = None) -> None:
        """Start a fresh session and discard the previous ID mapping."""
        self.session_id = session_id or f"session_{uuid4().hex}"
        self._counter = 0
        self._ids_by_stable_key.clear()
