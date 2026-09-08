#!/bin/zsh
set -eu
repo="${0:A:h:h}"
workspace="${repo:h}"
python_candidates=("${workspace}"/.toolchain/tools/python_env/idf5.5_py*_env/bin/python(N))
if (( ${#python_candidates} == 0 )); then
    print -u2 'ESP-IDF Python environment not found. Configure ESP-IDF 5.5.3 first.'
    exit 1
fi
print 'Open http://127.0.0.1:8768 and click Download & start.'
exec "${python_candidates[1]}" "${repo}/tools/fly_bridge/bridge.py" --web "${workspace}/fly-host/dist" "$@"
