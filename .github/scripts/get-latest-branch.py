#!/usr/bin/env python3
"""Get latest branch info from recent-branches.json."""
import json
import sys

def main():
    branches_file = sys.argv[1]
    
    try:
        with open(branches_file) as f:
            data = json.load(f)
        if data:
            latest = data[-1]
            print(f"{latest['safeName']}|{latest['branch']}|{latest['commit']}")
        else:
            print("||")
    except (FileNotFoundError, json.JSONDecodeError):
        print("||")

if __name__ == '__main__':
    main()
