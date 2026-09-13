#!/usr/bin/env python3
"""Update recent-branches.json with new branch deployment."""
import json
import sys

def main():
    branches_file = sys.argv[1]
    branch_name = sys.argv[2]
    safe_name = sys.argv[3]
    commit = sys.argv[4]
    
    # Load existing or start fresh
    try:
        with open(branches_file) as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        data = []
    
    # Remove any existing entry for this branch
    data = [e for e in data if e.get('branch') != branch_name]
    
    # Add new entry
    import datetime
    data.append({
        'branch': branch_name,
        'safeName': safe_name,
        'timestamp': datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ'),
        'commit': commit
    })
    
    # Keep last 10
    data = data[-10:]
    
    # Write back
    with open(branches_file, 'w') as f:
        json.dump(data, f, indent=2)

if __name__ == '__main__':
    main()
