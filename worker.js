export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname != "/") {
      return new Response("Not found", { status: 404 });
    }

    if (request.method != "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const body = await request.json();
    const { github_token } = body;

    if (!github_token) {
      return new Response("Missing github_token", { status: 400 });
    }

    // Use GitHub's installation/repositories endpoint to validate the token
    // This endpoint only returns repos the token has access to - can't be spoofed
    const response = await fetch(
      "https://api.github.com/installation/repositories",
      {
        headers: {
          authorization: `Bearer ${github_token}`,
          accept: "application/vnd.github+json",
          "x-gitHub-api-version": "2022-11-28",
          "user-agent": "monoserver-broker",
        },
      },
    );

    const data = await response.json();

    // Should return exactly one repository (the one the token was issued for)
    if (!response.ok || !data.repositories || data.repositories.length != 1) {
      return new Response("Invalid token", { status: 401 });
    }

    const repo = data.repositories[0];
    const owner = repo.owner.login;

    if (owner != env.EXPECTED_OWNER) {
      return new Response("Repository owner not authorized", { status: 403 });
    }

    return Response.json({
      github_repo: env.GITHUB_MONOSERVER_REPO,
      github_token: env.GITHUB_MONOSERVER_TOKEN,
      fly_token: env.FLY_TOKEN,
    });
  },
};
