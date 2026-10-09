#!/usr/bin/env bash
set -euo pipefail

# This installer targets the fixed ubuntu-24.04/x64 GitHub-hosted runner.
tool_dir="${RUNNER_TEMP:?GitHub runner temporary directory is required}/glh-tools"
mkdir -p "$tool_dir"
cd "$tool_dir"
curl --fail --location --retry 2 --max-time 60 --output gitleaks.tar.gz \
  https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz
printf '%s  %s\n' 551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb gitleaks.tar.gz | sha256sum --check --strict
tar -xzf gitleaks.tar.gz gitleaks
curl --fail --location --retry 2 --max-time 60 --output actionlint.tar.gz \
  https://github.com/rhysd/actionlint/releases/download/v1.7.11/actionlint_1.7.11_linux_amd64.tar.gz
printf '%s  %s\n' 900919a84f2229bac68ca9cd4103ea297abc35e9689ebb842c6e34a3d1b01b0a actionlint.tar.gz | sha256sum --check --strict
tar -xzf actionlint.tar.gz actionlint
