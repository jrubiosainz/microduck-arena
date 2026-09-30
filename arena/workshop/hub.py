"""The Hugging Face calls the workshop makes itself; everything else is a `uv run` subprocess."""

import os
import threading
from dataclasses import dataclass
from pathlib import Path

# The Hub names the account in well under a second. huggingface_hub's own whoami has no time limit:
# with the Hub unreachable it waits for the system's connect timeout, over a minute on macOS.
WHOAMI_TIMEOUT_S = 5.0


class HubUnreachable(RuntimeError):
    """huggingface.co did not answer."""


@dataclass(frozen=True)
class Account:
    name: str
    # whoami-v2's canPay: a payment method is on the account, so Hugging Face Jobs can bill it.
    can_pay: bool


class Hub:
    def whoami(self) -> Account | None:
        """The account logged in on this machine, and whether it can pay; None with no token, or one the Hub refuses."""
        import httpx
        from huggingface_hub import constants, get_token
        from huggingface_hub.utils import build_hf_headers

        token = get_token()
        if token is None:
            return None
        asked = {}

        def ask() -> None:
            try:
                asked["answer"] = httpx.get(f"{constants.ENDPOINT}/api/whoami-v2",
                                            headers=build_hf_headers(token=token), timeout=WHOAMI_TIMEOUT_S)
            except httpx.TransportError:  # no route, no name resolution, a refused connection
                pass
            except Exception as exc:  # noqa: BLE001 — anything else is said by its kind, below
                asked["error"] = exc

        # The limit is on the whole call: httpx's applies to each address in turn — huggingface.co
        # has several — and to each step. Past it the thread is left to give up on its own.
        thread = threading.Thread(target=ask, daemon=True)
        thread.start()
        thread.join(WHOAMI_TIMEOUT_S)
        if "error" in asked:  # by its kind only: its message may carry the token
            raise HubUnreachable(f"{constants.ENDPOINT} could not be asked: {type(asked['error']).__name__}")
        answer = asked.get("answer")
        if answer is None:
            raise HubUnreachable(f"{constants.ENDPOINT} did not answer within {WHOAMI_TIMEOUT_S:g} s")
        if answer.status_code == 401:
            return None
        if answer.status_code != 200:
            raise HubUnreachable(f"{constants.ENDPOINT} answered {answer.status_code}")
        body = answer.json()
        return Account(body["name"], bool(body.get("canPay")))

    def job_stage(self, job_id: str, namespace: str) -> str:
        """SCHEDULING, RUNNING, COMPLETED, CANCELED, ERROR or DELETED: the Hub's word for the job."""
        from huggingface_hub import HfApi

        stage = HfApi().inspect_job(job_id=job_id, namespace=namespace).status.stage
        return getattr(stage, "value", str(stage))

    def cancel_job(self, job_id: str, namespace: str) -> None:
        from huggingface_hub import HfApi

        HfApi().cancel_job(job_id=job_id, namespace=namespace)


def drop_exported_token() -> None:
    """The launcher exports HF_TOKEN so uv can install the Arena wheel from its private repo.
    huggingface_hub reads HF_TOKEN before the saved login and refreshes only the saved one: kept,
    the exported copy of a browser login would expire under the workshop. Dropped when it is
    that saved login; a token set on purpose, different from it, stays."""
    from huggingface_hub import constants

    exported = os.environ.get("HF_TOKEN")
    saved = Path(constants.HF_TOKEN_PATH)
    if exported and saved.is_file() and saved.read_text().strip() == exported.strip():
        del os.environ["HF_TOKEN"]
