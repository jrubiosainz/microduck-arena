"""`gh`, as the workshop calls it. `gh auth token` fails when FAKE_GH_LOGGED_OUT is set; there is
no `gh auth status`, which asks GitHub and hangs while it is unreachable.
`gh repo fork --remote` does to the checkout what the real one does: creates alice's fork
(a bare repo under $FAKE_GITHUB), renames origin to upstream and adds the fork as origin."""

import os
import subprocess
import sys
from pathlib import Path


def main():
    argv = sys.argv[1:]
    if argv[:2] == ["auth", "token"]:
        if os.environ.get("FAKE_GH_LOGGED_OUT"):
            print("no oauth token found for github.com", file=sys.stderr)
            return 1
        print("gho_fake")
        return 0
    if argv[:3] == ["repo", "fork", "--remote"]:
        fork = Path(os.environ["FAKE_GITHUB"]) / "alice" / "microduck-challenges"
        fork.mkdir(parents=True)
        subprocess.run(["git", "init", "-q", "--bare", str(fork)], check=True)
        subprocess.run(["git", "remote", "rename", "origin", "upstream"], check=True)
        subprocess.run(["git", "remote", "add", "origin", "https://github.com/alice/microduck-challenges"], check=True)
        print("✓ Created fork alice/microduck-challenges")
        return 0
    print(f"fake gh: unexpected {argv}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
