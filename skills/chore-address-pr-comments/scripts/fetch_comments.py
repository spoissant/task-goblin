#!/usr/bin/env python3
"""
Fetch everything still open on a PR: unresolved review threads and PR-level comments.

Usage:
    python3 fetch_comments.py <PR_URL>
    python3 fetch_comments.py --owner <owner> --repo <repo> --pr <number>

Output (JSON object):
    pr              {owner, repo, number, title, url}
    unresolvedCount number of unresolved review threads
    threads         unresolved inline review threads, each with
                      id            GraphQL node id (PRRT_...) -> resolveReviewThread
                      restId        numeric id of the first comment -> REST reply endpoint
                      path, line, originalLine, startLine, originalStartLine, diffSide, isOutdated
                      body, author, url, createdAt   (first comment)
                      comments[]    {id, restId, body, author, createdAt, isReply}
    issueComments   PR-level comments (cannot be resolved; reply by posting a new issue comment),
                    each {id, body, author, url, createdAt}; automated noise bots are excluded
"""

import argparse
import json
import re
import subprocess
import sys
from typing import Optional


def parse_pr_url(url: str) -> Optional[tuple[str, str, int]]:
    """Parse a GitHub PR URL into (owner, repo, number)."""
    # Handle both full URLs and short references
    patterns = [
        r"github\.com/([^/]+)/([^/]+)/pull/(\d+)",  # Full URL
        r"^([^/]+)/([^/]+)#(\d+)$",  # owner/repo#123
    ]

    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1), match.group(2), int(match.group(3))

    return None


# Bots whose comments are automated noise and should be excluded
NOISE_BOTS = {"github-actions[bot]", "dependabot[bot]", "codecov[bot]"}


def fetch_issue_comments(owner: str, repo: str, pr_number: int) -> list:
    """Fetch PR-level issue comments (not review thread comments), excluding noise bots."""
    cmd = [
        "gh", "api",
        f"repos/{owner}/{repo}/issues/{pr_number}/comments",
        "--paginate",
        "--jq", "[.[] | {id: .id, body: .body, author: .user.login, url: .html_url, createdAt: .created_at}]",
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        # --paginate outputs one JSON array per page; merge them
        comments = []
        for line in result.stdout.strip().splitlines():
            line = line.strip()
            if line:
                comments.extend(json.loads(line))
    except subprocess.CalledProcessError as e:
        print(f"Error fetching issue comments: {e.stderr}", file=sys.stderr)
        return []
    except json.JSONDecodeError as e:
        print(f"Error parsing issue comments: {e}", file=sys.stderr)
        return []

    return [c for c in comments if c["author"] not in NOISE_BOTS]


def fetch_unresolved_threads(owner: str, repo: str, pr_number: int) -> dict:
    """Fetch unresolved review threads using gh CLI and GraphQL."""

    # GraphQL query to fetch review threads with unresolved comments
    query = """
    query($owner: String!, $repo: String!, $pr: Int!, $cursor: String) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $pr) {
          title
          url
          reviewThreads(first: 100, after: $cursor) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              id
              isResolved
              isOutdated
              path
              line
              originalLine
              startLine
              originalStartLine
              diffSide
              comments(first: 50) {
                nodes {
                  id
                  databaseId
                  body
                  author {
                    login
                  }
                  createdAt
                  url
                  replyTo {
                    id
                  }
                }
              }
            }
          }
        }
      }
    }
    """

    all_threads = []
    cursor = None
    pr_title = ""
    pr_url = ""

    while True:
        # Build gh api command
        cmd = [
            "gh", "api", "graphql",
            "-F", f"owner={owner}",
            "-F", f"repo={repo}",
            "-F", f"pr={pr_number}",
            "-f", f"query={query}",
        ]

        if cursor:
            cmd.extend(["-F", f"cursor={cursor}"])

        try:
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            data = json.loads(result.stdout)
        except subprocess.CalledProcessError as e:
            print(f"Error calling gh api: {e.stderr}", file=sys.stderr)
            sys.exit(1)
        except json.JSONDecodeError as e:
            print(f"Error parsing response: {e}", file=sys.stderr)
            sys.exit(1)

        pr_data = data.get("data", {}).get("repository", {}).get("pullRequest", {})
        if not pr_data:
            print("Error: Could not fetch PR data. Check if the PR URL is correct.", file=sys.stderr)
            sys.exit(1)

        pr_title = pr_data.get("title", "")
        pr_url = pr_data.get("url", "")

        threads_data = pr_data.get("reviewThreads", {})
        nodes = threads_data.get("nodes", [])
        all_threads.extend(nodes)

        page_info = threads_data.get("pageInfo", {})
        if page_info.get("hasNextPage"):
            cursor = page_info.get("endCursor")
        else:
            break

    # Filter to only unresolved threads and format output
    unresolved = []
    for thread in all_threads:
        if thread.get("isResolved"):
            continue

        comments = thread.get("comments", {}).get("nodes", [])
        if not comments:
            continue

        # Get the first (original) comment
        first_comment = comments[0]

        unresolved.append({
            "id": thread.get("id"),
            "path": thread.get("path"),
            "line": thread.get("line"),
            "originalLine": thread.get("originalLine"),
            "startLine": thread.get("startLine"),
            "originalStartLine": thread.get("originalStartLine"),
            "diffSide": thread.get("diffSide"),
            "isOutdated": thread.get("isOutdated", False),
            "body": first_comment.get("body", ""),
            "author": first_comment.get("author", {}).get("login", "unknown"),
            "url": first_comment.get("url", ""),
            "createdAt": first_comment.get("createdAt", ""),
            "restId": first_comment.get("databaseId"),  # REST API numeric ID for posting replies
            "comments": [
                {
                    "id": c.get("id"),
                    "restId": c.get("databaseId"),  # REST API numeric ID
                    "body": c.get("body", ""),
                    "author": c.get("author", {}).get("login", "unknown"),
                    "createdAt": c.get("createdAt", ""),
                    "isReply": c.get("replyTo") is not None,
                }
                for c in comments
            ],
        })

    issue_comments = fetch_issue_comments(owner, repo, pr_number)

    return {
        "pr": {
            "owner": owner,
            "repo": repo,
            "number": pr_number,
            "title": pr_title,
            "url": pr_url,
        },
        "unresolvedCount": len(unresolved),
        "threads": unresolved,
        "issueComments": issue_comments,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("url", nargs="?", help="PR URL (e.g., https://github.com/owner/repo/pull/123)")
    parser.add_argument("--owner", help="Repository owner")
    parser.add_argument("--repo", help="Repository name")
    parser.add_argument("--pr", type=int, help="PR number")

    args = parser.parse_args()

    # Determine owner, repo, pr_number from arguments
    if args.owner and args.repo and args.pr:
        # Direct arguments provided
        owner, repo, pr_number = args.owner, args.repo, args.pr
    elif args.url:
        # Parse from URL
        parsed = parse_pr_url(args.url)
        if not parsed:
            print(f"Error: Could not parse PR URL: {args.url}", file=sys.stderr)
            print("Expected format: https://github.com/owner/repo/pull/123", file=sys.stderr)
            sys.exit(1)
        owner, repo, pr_number = parsed
    else:
        print("Error: Provide either a PR URL or --owner, --repo, and --pr arguments", file=sys.stderr)
        print("Usage: python3 fetch_comments.py <PR_URL>", file=sys.stderr)
        print("   or: python3 fetch_comments.py --owner <owner> --repo <repo> --pr <number>", file=sys.stderr)
        sys.exit(1)

    result = fetch_unresolved_threads(owner, repo, pr_number)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
