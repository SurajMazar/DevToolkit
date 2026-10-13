/** A GitHub-style API response: nested objects, arrays of objects with optional keys, nulls, a 64-bit id. */
export const TS_SAMPLE = `{
  "total_count": 2,
  "incomplete_results": false,
  "items": [
    {
      "id": 1296269,
      "node_id": "MDEwOlJlcG9zaXRvcnkxMjk2MjY5",
      "full_name": "octocat/hello-world",
      "private": false,
      "owner": {
        "login": "octocat",
        "id": 1,
        "avatar_url": "https://github.com/images/error/octocat_happy.gif",
        "site_admin": false
      },
      "description": "My first repository on GitHub!",
      "topics": ["octocat", "atom", "electron"],
      "stargazers_count": 80,
      "license": { "key": "mit", "name": "MIT License", "spdx_id": "MIT" },
      "created_at": "2011-01-26T19:01:12Z",
      "pushed_at": "2011-01-26T19:06:43Z",
      "default-branch": "main",
      "permissions": { "admin": false, "push": false, "pull": true }
    },
    {
      "id": 9223372036854775807,
      "node_id": "R_kgDOJm7QpQ",
      "full_name": "mona/lisa-ui",
      "private": true,
      "owner": {
        "login": "mona",
        "id": 583231,
        "avatar_url": "https://avatars.githubusercontent.com/u/583231",
        "site_admin": true
      },
      "description": null,
      "topics": [],
      "stargazers_count": 3,
      "license": null,
      "created_at": "2023-06-02T08:15:40Z",
      "pushed_at": null,
      "default-branch": "trunk",
      "archived": true
    }
  ]
}
`
