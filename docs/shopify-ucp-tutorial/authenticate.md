---
title: Authenticate your agent
description: >-
  Learn how to generate API credentials and fetch bearer tokens dynamically to
  authenticate your agent with Shopify's MCP servers.
source_url:
  html: "https://shopify.dev/docs/agents/get-started/authentication"
  md: "https://shopify.dev/docs/agents/get-started/authentication.md"
---

# Authenticate your agent

This guide is the first part of a six-part tutorial series that describes how to build an agentic commerce application with the Universal Commerce Protocol (UCP) using Shopify's MCP servers. It demonstrates how to generate API credentials and write an authentication module that fetches bearer tokens at runtime.

By the end of the series, you'll have a working demo that defines an agent profile, searches the Shopify Catalog, walks a buyer through selecting a product variant, builds a cart, and refers them to a merchant storefront to finish checkout.

**Note:**

This series of tutorials defines a set of scripts that take you from authentication through to checkout. Using JavaScript is not required, and it's only used here to give you something tangible to learn with. Example scripts also display raw MCP inputs and responses alongside them, so be sure to leverage what you need for your own project.

---

## What you'll learn

In this tutorial, you'll learn:

- How to define and retrieve API keys
- To set up a helper function to reauthenticate requests

---

## Requirements

- Access to [Shopify's Dev Dashboard](https://dev.shopify.com/dashboard)
- [Node.js](https://nodejs.org/) 18 or higher installed on your machine

---

## Step 1: Generate API credentials

1. In [Dev Dashboard](https://dev.shopify.com/dashboard/) click **Catalogs** from the sidebar.

2. Click **Get an API key**. Name your key, then click **Create**.

   ![Dev Dashboard Default API key page for the Catalogs API](https://shopify.dev/assets/assets/images/agents/dev-dash-default-key-Dmsv4XAC.png)

3. Copy your client ID and client secret and export them to your terminal:

   ## Terminal

   ```bash
   export CLIENT_ID={your_client_id} && export CLIENT_SECRET={your_client_secret}
   ```

---

## Step 2: Set up the project

Create a `ucp-demo` directory that you'll use throughout the tutorial.

1. Create the directory and initialize a Node.js project:

   ## Terminal

   ```bash
   mkdir demo && cd demo
   npm init -y
   ```

2. Set `"type": "module"` in `package.json` to use ES module imports, which will make setting up individual steps of the tutorial simpler:

   ## package.json

   ```json
   {
     "type": "module"
   }
   ```

---

## Step 3: Set up authentication

Create `auth.js`, which fetches a fresh bearer token from the token endpoint using your client credentials. The token expires after 60 minutes, so fetching it at runtime on each run ensures requests never fail due to an expired token.

##### auth.js

```javascript
export async function getAccessToken() {
  const clientId = process.env.CLIENT_ID;
  const clientSecret = process.env.CLIENT_SECRET;
  const res = await fetch("https://api.shopify.com/auth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
  });
  const { access_token } = await res.json();
  const [, payload] = access_token.split(".");
  const { scopes, exp, limits } = JSON.parse(
    Buffer.from(payload, "base64").toString("utf8"),
  );
  console.log("\n── 1. Authentication ─────────────────────────\n");
  console.log(`  Scopes:  ${scopes}`);
  console.log(`  Expires: ${new Date(exp * 1000).toLocaleTimeString()}`);
  return access_token;
}
```

##### cURL

```bash
curl --request POST \
  --url https://api.shopify.com/auth/access_token \
  --header 'Content-Type: application/json' \
  --data '{
    "client_id": "{your_client_id}",
    "client_secret": "{your_client_secret}",
    "grant_type": "client_credentials"
  }'
```

##### {} Response

```json
{
  "access_token": "{your_bearer_token}"
}
```

---

## Step 4: Create the main tutorial script

Create `ucp_demo.js` as the main entry point. You'll update this file in each tutorial to add the next step.

## ucp_demo.js

```javascript
import { getAccessToken } from "./auth.js";

async function main() {
  // 1. Authentication
  const token = await getAccessToken();
}

main().catch((err) => console.error("Request failed:", err));
```

Run the script to verify your credentials work:

## Terminal

```bash
node ucp_demo.js
```

You should see output like:

## Output

── 1. Authentication ─────────────────────────

Scopes: read_global_api_catalog_search

Expires: 6:02:46 PM

---

## Next steps

[Define a profile\
\
](https://shopify.dev/docs/agents/get-started/profile)

[Define and host an agent profile.](https://shopify.dev/docs/agents/get-started/profile)

---
