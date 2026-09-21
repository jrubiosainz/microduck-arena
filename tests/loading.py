"""The developer's scripts are not a package: a test loads one by its path."""

import importlib.util
from pathlib import Path


def load_script(name: str):
    path = Path(__file__).parent.parent / "scripts" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
