# monoserve

When I go to school:

- There are so many good static hosting sites, but they don't allow for server logic.
- There are a few serverless sites, but they all either have bad latency or are blocked.
- There are a number of container/VM hosters, but they usually restrict you to one container.

When you have as many projects as me, none of these solutions work on their own. Monoserve lets you run all your backends on one efficient "monoserver" so you can host your frontend wherever you want. This version is built for Vite projects and Fly deployment, but you could fork it and make it work differently.

## Bundle

### Prep

Install both of `monoserve devalue` with your favorite package manager.

Update your `vite.config.js` to `import monoserve from "monoserve/plugin"`, and make sure your `plugins` has something like `monoserve({ monoserverURL: "https://REPLACETHIS.fly.dev" })`.

Take your `.gitignore` and add `functions`.

### Usage

It's a lot like SvelteKit [Remote Functions](https://github.com/sveltejs/kit/discussions/13897) - you write `.remote.ts` files that use `fn`. For example, this is an echo function:
```js
import fn from "monoserve/fn";
import { type } from "arktype";

export default fn(type("string"), (text) => text);
```
And this is a getter function:
```js
import fn from "monoserve/fn";

export default fn(() => "resource");
```

Under the hood, Monoserve's plugin is stubbing the `.remote.ts` file and either hosting a backend for it or bundling the functions to be later deployed.

## Deploy

### Prep: Config Broker

Monoserve would be a lot more annoying to use if you had to reconfigure everything for every repo. That's why you deploy a config broker to... broker the config.

You can write your own as long as it accepts a `github_token` and, if it's for the expected owner, returns a `github_repo`, a `github_token`, and a `fly_token`, or deploy [worker.js](https://github.com/KTibow/monoserve/blob/main/example-worker.js) to Cloudflare Workers (set up `EXPECTED_OWNER`, `GITHUB_MONOSERVER_REPO`, `GITHUB_MONOSERVER_TOKEN`, and `FLY_TOKEN`).

### Prep: Monoserver

You also should create the monoserver ahead of time. This means (in most cases) making a folder, setting up Fly within that folder, setting up Git within that folder, setting up a server (see [Dockerfile](https://github.com/KTibow/monoserve/blob/main/example-Dockerfile), [deno.json](https://github.com/KTibow/monoserve/blob/main/example-deno.json), and [server.ts](https://github.com/KTibow/monoserve/blob/main/example-server.ts)) within that folder, and sending it to GitHub. Don't forget to configure your config broker and modify the server to allow for CORS.

### Usage

Add something like this to your GitHub workflow. It'll use `functions` from bundling and config from your broker.
```yaml
- name: Monoserve
  uses: KTibow/monoserve/deploy@main
  with:
    config-broker-url: "https://REPLACETHIS.username.workers.dev"
```
