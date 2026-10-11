import os
import sys

HOOK_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, HOOK_DIR)
HOOK = os.path.join(HOOK_DIR, "fo_hook.py")
PY = sys.executable
