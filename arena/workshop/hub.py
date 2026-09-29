"""The three Hugging Face calls the workshop makes itself; everything else is a `uv run` subprocess."""

import threading

# The Hub names the account in well under a second. huggingface_hub's own whoami has no time limit:
# with the Hub unreachable it waits for the system's connect timeout, over a minute on macOS.
WHOAMI_TIMEOUT_S = 5.0


class HubUnreachable(RuntimeError):
    """huggingface.co did not answer."""


class Hub:
    def whoami(self) -> str | None:
        """The account logged in on this machine; None with no token, or one the Hub refuses."""
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

        # The limit is on the whole call: httpx's applies to each address in turn — huggingface.co
        # has several — and to each step. Past it the thread is left to give up on its own.
        thread = threading.Thread(target=ask, daemon=True)
        thread.start()
        thread.join(WHOAMI_TIMEOUT_S)
        answer = asked.get("answer")
        if answer is None:
            raise HubUnreachable(f"{constants.ENDPOINT} did not answer within {WHOAMI_TIMEOUT_S:g} s")
        if answer.status_code == 401:
            return None
        if answer.status_code != 200:
            raise HubUnreachable(f"{constants.ENDPOINT} answered {answer.status_code}")
        return answer.json()["name"]

    def login(self, token: str) -> None:
        from huggingface_hub import login

        login(token=token)

    def cancel_job(self, job_id: str, namespace: str) -> None:
        from huggingface_hub import HfApi

        HfApi().cancel_job(job_id=job_id, namespace=namespace)
