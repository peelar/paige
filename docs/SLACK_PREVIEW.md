# Slack preview

Paige has a dedicated **Paige (Preview)** Slack app for exercising the local agent with
real Slack requests. The app sends signed webhooks to the stable public HTTPS
proxy for the `paige` exe.dev VM; code still runs under `eve dev`, so edits do
not require a Vercel deployment.

Production remains the default runtime profile. Preview mode uses a separate
bot token and signing secret and starts only through
`pnpm dev:slack-preview`.

## One-time exe.dev setup

Run these commands from a machine authenticated to exe.dev:

```sh
ssh exe.dev share port paige 3000
ssh exe.dev share set-public paige
```

Slack cannot use exe.dev's interactive private-proxy login, so this port must
be public. The Eve session routes keep their own authentication, and the Slack
route verifies every request with the preview app's signing secret. Keep port
3000 dedicated to Paige while the proxy is public.

The resulting Slack request URL is:

```text
https://paige.exe.xyz/eve/v1/slack
```

## Create the preview Slack app

Create a single-workspace app named **Paige (Preview)** from this bootstrap
manifest. It intentionally has no request URL so the app can be installed
before the local server is running.

```yaml
display_information:
  name: Paige (Preview)
  description: Local preview of the Paige documentation agent
features:
  bot_user:
    display_name: Paige (Preview)
    always_online: false
oauth_config:
  scopes:
    bot:
      - app_mentions:read
      - channels:history
      - channels:read
      - chat:write
      - groups:history
      - groups:read
      - im:history
      - im:read
      - mpim:history
      - mpim:read
      - reactions:read
      - reactions:write
      - users:read
settings:
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
```

Install the app to the development workspace. Copy its **Bot User OAuth
Token** from **OAuth & Permissions** and its **Signing Secret** from **Basic
Information** into an ignored preview environment:

```sh
cp apps/agent/.env.preview.example apps/agent/.env.preview.local
```

Start the local preview agent:

```sh
pnpm dev:slack-preview
```

With the server running, finish the Slack app configuration:

1. Enable **Event Subscriptions** and set the request URL to
   `https://paige.exe.xyz/eve/v1/slack`.
2. Subscribe to `app_mention`, `message.channels`, `message.groups`,
   `message.im`, and `message.mpim` bot events.
3. Enable **Interactivity & Shortcuts** with the same request URL.
4. Invite only **Paige (Preview)** to a dedicated private preview channel.

Use a direct message to verify private authorization prompts, then mention the
bot in the preview channel and reply without another mention to verify thread
continuation. Reactions, long-running progress, and interactive approvals use
the same webhook and should be included in relevant smoke tests.

The preview runtime deliberately uses the checkout's normal agent environment,
including its shared database and integrations. The separate Slack app and
channel prevent duplicate event consumption; they do not turn real agent tools
into a sandbox.
