#!/usr/bin/env python3
"""Remove a branch from recent-branches.json."""
import json
import sys

def main():
    branches_file = sys.argv[1]
    branch_name = sys.argv[2]
    
    try:
        with open(branches_file) as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        sys.exit(0)
    
    # Remove the deleted branch
    data = [e for e in data if e.get('branch') != branch_name]
    
    # Write back
    with open(branches_file, 'w') as f:
        json.dump(data, f, indent=2)

if __name__ == '__main__':
    main()
