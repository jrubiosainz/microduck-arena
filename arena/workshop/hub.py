"""The Hugging Face calls the workshop makes itself; everything else is a `uv run` subprocess."""

import os
import threading
from dataclasses import dataclass
from pathlib import Path

# The Hub names the account, or cancels a job, in well under a second. huggingface_hub's own calls
# have no time limit: with the Hub unreachable they wait for the system's connect timeout, over a
# minute on macOS — and a Stop waits holding the workshop's lock.
HUB_TIMEOUT_S = 5.0


class HubUnreachable(RuntimeError):
    """huggingface.co did not answer."""


def _in_time(call):
    """`call()`, given HUB_TIMEOUT_S in all; HubUnreachable when the Hub cannot be reached or does not
    answer in time. Whatever else `call` raises is raised as it is.

    The limit is on the whole call: httpx's applies to each address in turn — huggingface.co has
    several — and to each step. Past it the thread is left to give up on its own.
    """
    import httpx
    import httpx2
    from huggingface_hub import constants

    asked = {}

    def ask() -> None:
        try:
            asked["answer"] = call()
        # No route, no name resolution, a refused connection. whoami asks with httpx;
        # huggingface_hub's own calls raise httpx2's errors, which are not httpx's.
        except (httpx.TransportError, httpx2.TransportError):
            pass
        except Exception as exc:  # noqa: BLE001 — raised again below, on the caller's thread
            asked["error"] = exc

    thread = threading.Thread(target=ask, daemon=True)
    thread.start()
    thread.join(HUB_TIMEOUT_S)
    if "error" in asked:
        raise asked["error"]
    if "answer" not in asked:
        raise HubUnreachable(f"{constants.ENDPOINT} did not answer within {HUB_TIMEOUT_S:g} s")
    return asked["answer"]


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
        try:
            answer = _in_time(lambda: httpx.get(f"{constants.ENDPOINT}/api/whoami-v2",
                                                headers=build_hf_headers(token=token), timeout=HUB_TIMEOUT_S))
        except HubUnreachable:
            raise
        except Exception as exc:  # noqa: BLE001 — by its kind only: its message may carry the token
            raise HubUnreachable(f"{constants.ENDPOINT} could not be asked: {type(exc).__name__}") from None
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
        """HubUnreachable when the Hub does not answer in time; a refusal is raised as the Hub says it."""
        from huggingface_hub import HfApi

        _in_time(lambda: HfApi().cancel_job(job_id=job_id, namespace=namespace))


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
