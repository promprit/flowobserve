"""One place that points a test's home dir at tmp_path on every OS (Windows reads USERPROFILE, not HOME)."""
import os


def home_vars(home):
    return {"HOME": str(home), "USERPROFILE": str(home)}


def set_home(monkeypatch, home):
    for k, v in home_vars(home).items():
        monkeypatch.setenv(k, v)


def env_home(home, **extra):
    return dict(os.environ, **home_vars(home), **extra)
