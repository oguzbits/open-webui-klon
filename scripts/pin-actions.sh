#!/usr/bin/env bash
# Replaces `uses: owner/repo@tag` with `uses: owner/repo@<commit sha> # tag` in all workflow files.
# Needs the GitHub CLI (`gh`) with network access. Safe to run repeatedly.
set -euo pipefail

for file in .github/workflows/*.yml; do
  grep -oE 'uses: [^ ]+@[^ #]+' "$file" | sort -u | while read -r _ ref; do
    path="${ref%@*}"
    tag="${ref#*@}"
    if [[ "$tag" =~ ^[0-9a-f]{40}$ ]]; then continue; fi
    repo="$(echo "$path" | cut -d/ -f1-2)"
    sha="$(gh api "repos/${repo}/commits/${tag}" --jq .sha)"
    sed -i.bak "s|uses: ${path}@${tag}\$|uses: ${path}@${sha} # ${tag}|" "$file"
    rm -f "${file}.bak"
    echo "pinned ${path}@${tag} -> ${sha}"
  done
done
