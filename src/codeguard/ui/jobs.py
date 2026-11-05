"""Exécution des analyses en arrière-plan, avec suivi et arrêt demandé par l'utilisateur."""

from __future__ import annotations

import threading
import time
import traceback
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from codeguard.service import describe_error


class JobCancelled(Exception):
    pass


class JobBusy(Exception):
    pass


@dataclass
class Job:
    id: str
    kind: str
    label: str
    status: str = "running"  # "running" | "done" | "failed" | "cancelled"
    created: float = field(default_factory=time.time)
    finished: float | None = None
    logs: list[str] = field(default_factory=list)
    error: str | None = None
    prepared: Any = None
    report: Any = None
    root: Any = None
    pushed: bool = False
    pull_request_url: str | None = None
    discarded: bool = False
    cancel_requested: threading.Event = field(default_factory=threading.Event)


class JobManager:
    """Only one analysis runs at a time: each one spends money and may run project commands."""

    def __init__(self):
        self._lock = threading.Lock()
        self._jobs: dict[str, Job] = {}

    def start(
        self,
        kind: str,
        label: str,
        work: Callable[[Job, Callable[[str], None]], Any],
        root: Any = None,
    ) -> Job:
        with self._lock:
            if any(job.status == "running" for job in self._jobs.values()):
                raise JobBusy("une analyse est déjà en cours")
            job = Job(id=uuid.uuid4().hex[:12], kind=kind, label=label, root=root)
            self._jobs[job.id] = job

        def log(message: str) -> None:
            # Raising here unwinds the agent loop; run_clean's cleanup still happens.
            if job.cancel_requested.is_set():
                raise JobCancelled
            job.logs.append(message)

        def runner() -> None:
            try:
                job.report = work(job, log)
                job.status = "done"
            except JobCancelled:
                job.status = "cancelled"
            except Exception as exc:
                message = describe_error(exc)
                if message is None:
                    traceback.print_exc()
                    message = "erreur interne : consulte le terminal de l'interface"
                job.error = message
                job.status = "failed"
            finally:
                job.finished = time.time()

        threading.Thread(target=runner, daemon=True, name=f"job-{job.id}").start()
        return job

    def get(self, job_id: str) -> Job | None:
        return self._jobs.get(job_id)

    def all(self) -> list[Job]:
        return sorted(self._jobs.values(), key=lambda job: job.created, reverse=True)
