import os
import shlex

from helper_fixtures import fo_home, root  # noqa: F401 (fixtures)
import fo_open as fo

U1 = "8c1f0e2a-1111-4222-8333-444455556666"
CL = "/Users/p/.flowobserve/bin/cl"


def test_open_and_restore_use_cl_when_given(root):
    d = os.path.realpath(os.path.join(root, "app"))
    [a] = fo.plan(*fo.parse("flowobserve://open?path=app"), root, None, CL)
    assert a[2].endswith(f"cd {shlex.quote(d)} && {CL}")
    [a] = fo.plan(*fo.parse(f"flowobserve://open?path=app&resume={U1}"), root, None, CL)
    assert a[2].endswith(f"cd {shlex.quote(d)} && {CL} --resume {U1}")
    os.makedirs(os.path.join(root, "app", ".git"), exist_ok=True)
    [a] = fo.plan(*fo.parse("flowobserve://open?path=app&wt=1"), root, None, CL)
    assert a[2].endswith(f"&& {CL} --worktree")


def test_without_cl_it_is_plain_claude(root):
    [a] = fo.plan(*fo.parse(f"flowobserve://open?path=app&resume={U1}"), root)
    assert a[2].endswith(f"&& claude --resume {U1}")


def test_cl_path_needs_an_executable_file(fo_home):
    p = os.path.join(os.environ["FO_HOME"], "bin", "cl")
    assert fo.cl_path() is None
    os.makedirs(os.path.dirname(p))
    with open(p, "w") as f:
        f.write("#!/bin/sh\n")
    os.chmod(p, 0o644)
    assert fo.cl_path() is None
    os.chmod(p, 0o755)
    assert fo.cl_path() == p
