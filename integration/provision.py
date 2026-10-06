"""Root-only idempotent provisioning; secret values never leave the server."""

import base64
import grp
import os
import pwd
import secrets
import shlex
import tempfile
from pathlib import Path

from cryptography.hazmat.primitives.kdf.argon2 import Argon2id


def read_env(path):
    result = {}
    for line in path.read_text().splitlines():
        if not line or line.startswith("#"):
            continue
        key, value = line.split("=", 1)
        values = shlex.split(value)
        result[key] = values[0] if values else ""
    return result


def write_env(path, contents, mode, group=0):
    fd, temporary = tempfile.mkstemp(prefix=path.name + ".", dir=path.parent)
    try:
        os.fchmod(fd, mode)
        os.fchown(fd, 0, group)
        with os.fdopen(fd, "w") as stream:
            stream.write(contents)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    if os.geteuid() != 0:
        raise SystemExit("Root is required")
    collector = Path("/etc/mobiquant-assets.env")
    if not collector.is_file():
        raise SystemExit("Existing collector configuration is required")
    original = read_env(collector)
    if (
        original.get("MOBIQUANT_ASSETS_ENABLED") != "1"
        or original.get("MOBIQUANT_DEPLOYMENT_ZONE") != "crypto-allowed"
    ):
        raise SystemExit("Crypto deployment policy is required")
    ledger = Path("/etc/mobiquant-wealthfolio.env")
    identity = pwd.getpwnam("mq-ledger")
    if ledger.exists():
        configured = read_env(ledger)
        password = configured["WF_GATEWAY_PASSWORD"]
        if not configured.get("WF_SECRET_KEY") or not configured.get(
            "WF_AUTH_PASSWORD_HASH"
        ):
            raise SystemExit("Existing ledger configuration is incomplete")
    else:
        password = secrets.token_urlsafe(48)
        key = base64.b64encode(secrets.token_bytes(32)).decode()
        password_hash = Argon2id(
            salt=secrets.token_bytes(16),
            length=32,
            iterations=3,
            lanes=2,
            memory_cost=65536,
        ).derive_phc_encoded(password.encode())
        contents = (
            "\n".join(
                f"{name}={shlex.quote(value)}"
                for name, value in {
                    "WF_SECRET_KEY": key,
                    "WF_AUTH_PASSWORD_HASH": password_hash,
                    "WF_GATEWAY_PASSWORD": password,
                    "WF_RUNTIME_UID": str(identity.pw_uid),
                    "WF_RUNTIME_GID": str(identity.pw_gid),
                }.items()
            )
            + "\n"
        )
        write_env(ledger, contents, 0o600)
    backup = Path("/etc/mobiquant-assets.env.before-wealthfolio")
    if not backup.exists():
        write_env(backup, collector.read_text(), 0o600)
    prefix = "MOBIQUANT_WEALTHFOLIO_"
    preserved = [
        line
        for line in collector.read_text().splitlines()
        if not line.startswith(prefix)
        and not line.startswith("MOBIQUANT_PORTFOLIO_DIST=")
    ]
    new = {
        prefix + "URL": "http://127.0.0.1:8793",
        prefix + "ORIGIN": "https://hetzner-cax11.tail6fee71.ts.net",
        prefix + "PASSWORD": password,
        "MOBIQUANT_PORTFOLIO_DIST": "/opt/mobiquant-wealthfolio/dist-mobiquant",
    }
    contents = (
        "\n".join(preserved + [f"{k}={shlex.quote(v)}" for k, v in new.items()]) + "\n"
    )
    write_env(collector, contents, 0o640, grp.getgrnam("mq-assets").gr_gid)
    data = Path("/var/lib/mobiquant-wealthfolio")
    data.mkdir(exist_ok=True, mode=0o700)
    os.chown(data, identity.pw_uid, identity.pw_gid)
    os.chmod(data, 0o700)
    print("Private ledger configuration prepared; no secrets printed")


if __name__ == "__main__":
    main()
