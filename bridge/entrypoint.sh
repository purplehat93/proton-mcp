#!/bin/sh
set -eu

export HOME="${BRIDGE_HOME:-/data}"
export GNUPGHOME="${GNUPGHOME:-$HOME/.gnupg}"
export PASSWORD_STORE_DIR="${PASSWORD_STORE_DIR:-$HOME/.password-store}"

mkdir -p "$HOME" "$GNUPGHOME" "$PASSWORD_STORE_DIR"
chmod 700 "$GNUPGHOME"

init_pass() {
  if [ -f "$PASSWORD_STORE_DIR/.gpg-id" ]; then
    return 0
  fi

  if ! gpg --list-secret-keys --with-colons 2>/dev/null | grep -q '^sec:'; then
    cat > /tmp/gpg-batch <<'EOF'
Key-Type: RSA
Key-Length: 3072
Name-Real: Proton Bridge Container
Name-Email: bridge@localhost
Expire-Date: 0
%no-protection
%commit
EOF
    gpg --batch --generate-key /tmp/gpg-batch
    rm -f /tmp/gpg-batch
  fi

  key_id="$(gpg --list-secret-keys --with-colons | awk -F: '/^sec:/ { print $5; exit }')"
  [ -n "$key_id" ] || { echo "Unable to determine GPG key id" >&2; exit 1; }
  pass init "$key_id"
}

case "${1:-run}" in
  init)
    init_pass
    exec protonmail-bridge --cli
    ;;
  cli)
    init_pass
    exec protonmail-bridge --cli
    ;;
  run)
    init_pass
    exec protonmail-bridge --noninteractive
    ;;
  version)
    exec protonmail-bridge --version
    ;;
  *)
    exec "$@"
    ;;
esac
