#!/bin/bash
#
# Detect user information for onboarding
# Outputs JSON with all detected info
#

# System info
USERNAME=$(whoami)
FULLNAME=$(id -F 2>/dev/null || getent passwd "$USERNAME" 2>/dev/null | cut -d: -f5 | cut -d, -f1 || echo "")

# Timezone
if [ -f /etc/timezone ]; then
    TIMEZONE=$(cat /etc/timezone)
elif [ -L /etc/localtime ]; then
    TIMEZONE=$(readlink /etc/localtime | sed 's|.*/zoneinfo/||')
else
    TIMEZONE=""
fi

# Git config
GIT_NAME=$(git config --global user.name 2>/dev/null || echo "")
GIT_EMAIL=$(git config --global user.email 2>/dev/null || echo "")

# GitHub CLI (if authenticated)
if command -v gh &>/dev/null; then
    GH_INFO=$(gh api user --jq '{login: .login, name: .name, blog: .blog, bio: .bio}' 2>/dev/null || echo "{}")
else
    GH_INFO="{}"
fi

# Code directories that exist
CODE_DIRS=""
for dir in ~/Repos ~/repos ~/Code ~/code ~/Projects ~/projects ~/Developer ~/dev ~/src; do
    if [ -d "$dir" ]; then
        CODE_DIRS="$CODE_DIRS\"$dir\","
    fi
done
CODE_DIRS="[${CODE_DIRS%,}]"

# Output as JSON
cat <<EOF
{
  "username": "$USERNAME",
  "fullName": "$FULLNAME",
  "timezone": "$TIMEZONE",
  "git": {
    "name": "$GIT_NAME",
    "email": "$GIT_EMAIL"
  },
  "github": $GH_INFO,
  "codeDirs": $CODE_DIRS
}
EOF
