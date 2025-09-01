# monoserve

When I go to school:

- There are so many good static hosting sites, but they don't allow for server logic.
- There are a few serverless sites, but they all either have bad latency or are blocked.
- There are a number of container/VM hosters, but they usually restrict you to one container.

When you have as many projects as me, none of these solutions work on their own. Monoserve lets you run all your backends on one efficient "monoserver" so you can host your frontend wherever you want. This version is built for Vitelike projects and Fly deployment, but you could fork it and make it work differently.

## Action: Bundle

TODO

## Action: Deploy

### Prep

Monoserve would be a lot more annoying to use if you had to reconfigure everything for every repo. That's why you deploy a config broker to... broker the config.

You can write your own as long as it accepts a `github_token` and, if it's for the expected owner, returns a `github_repo`, a `github_token`, and a `fly_token`, or deploy [worker.js](https://github.com/KTibow/monoserve/blob/main/worker.js) to Cloudflare Workers (set up `EXPECTED_OWNER`, `GITHUB_MONOSERVER_REPO`, `GITHUB_MONOSERVER_TOKEN`, and `FLY_TOKEN`).

### Usage

Add something like this to your GitHub workflow. It'll use `functions` from bundling and config from your broker.
```yaml
- name: Monoserver
  uses: KTibow/monoserve/deploy@main
  with:
    config-broker-url: "https://change-this-config-broker.username.workers.dev"
```
