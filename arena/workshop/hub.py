"""The three Hugging Face calls the workshop makes itself; everything else is a `uv run` subprocess."""


class Hub:
    def whoami(self) -> str | None:
        from huggingface_hub import whoami

        try:
            return whoami()["name"]
        except Exception:  # noqa: BLE001
            # No token, an expired one, no network: to a novice all three mean
            # "log in", which is what the page then says.
            return None

    def login(self, token: str) -> None:
        from huggingface_hub import login

        login(token=token)

    def cancel_job(self, job_id: str, namespace: str) -> None:
        from huggingface_hub import HfApi

        HfApi().cancel_job(job_id=job_id, namespace=namespace)
