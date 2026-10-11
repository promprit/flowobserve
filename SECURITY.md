# Security

## Reporting a vulnerability
Please report it privately through GitHub private vulnerability reporting: open the **Security** tab of [promprit/flowobserve](https://github.com/promprit/flowobserve) and choose **Report a vulnerability**. Do not open a public issue for a security problem.

## What the design guarantees
- The server binds to `127.0.0.1` only. It is not reachable from other machines.
- The hook redacts secrets before it writes anything to disk.
- There is no telemetry. flowobserve makes no network calls of its own.
- The hook never blocks or fails Claude Code: no network, fails silent, exits 0.

A report that breaks any of these is in scope.
