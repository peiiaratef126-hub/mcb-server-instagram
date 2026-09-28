# Meta App & Instagram Graph API Setup Guide

This guide walks you through setting up a Meta Developer App, connecting your Instagram Professional account, generating your long-lived access token, locating your Instagram Business Account ID, and configuring webhooks.

Follow each step carefully. Once complete, you will populate your local `.env` file before running the server.

---

## 1. Prerequisites: Account Requirements

The official Meta Graph API requires an **Instagram Professional Account** (Business or Creator) connected to a **Facebook Page**. Personal accounts cannot access the Graph API.

### Step 1.1: Convert Instagram Account to Professional
1. Open the Instagram app on mobile.
2. Go to **Settings and privacy** > **Account type and tools** > **Switch to professional account**.
3. Choose either **Business** or **Creator**.

### Step 1.2: Connect Instagram Account to a Facebook Page
1. Go to [Meta Business Suite](https://business.facebook.com/) or open your Facebook Page on desktop.
2. Navigate to **Page Settings** > **Linked Accounts** (or **Settings** > **Instagram**).
3. Click **Connect Account** and log in to your Instagram Professional account.
4. Verify that the connection is active and displays: *"Connected Instagram account"*.

---

## 2. Create a Meta Developer App

1. Go to the [Meta for Developers Portal](https://developers.facebook.com/) and log in.
2. Click **My Apps** in the top navigation bar, then click **Create App**.
3. **App Type Selection:**
   - If prompted for a use case or app type, select **Other** > **Business**, or select **Business** directly.
4. Fill in the app details:
   - **App Name:** e.g., `My MCB Instagram Server`
   - **App Contact Email:** Your email address
   - **Business Account:** Select your Meta Business Account if available, or proceed without one for development.
5. Click **Create App** and complete the security check.

---

## 3. Required Permissions (Scopes)

Depending on which features and run modes you plan to use, your token must include specific scopes:

### Lite Mode / Read Operations (Features 1, 2, 3, 7, 10, 11)
- `instagram_basic`: Read profile info, media list, and permalinks.
- `pages_show_list`: Enumerate Facebook Pages linked to the authenticated user.
- `pages_read_engagement`: Read basic engagement data and verify page ownership.
- `instagram_manage_insights`: Retrieve post-level and account-level metrics/insights.

### Comment Moderation (Features 8, 9, 21)
- `instagram_manage_comments`: Reply to comments, hide comments, and delete comments.

### Full Mode Publishing & Scheduling (Features 4, 5, 6, 15)
- `instagram_content_publish`: Upload media containers and publish single images, videos, Reels, and carousels.

### Realtime Webhooks & Direct Messages (Features 12, 14, 20)
- `instagram_manage_messages`: Read and respond to Instagram Direct Messages.
- `pages_manage_metadata`: Subscribe your Facebook Page and Instagram Account to webhook events.

> [!NOTE]
> During development, while your app is in **Development Mode**, permissions only work for accounts that have an assigned role (Admin, Developer, or Tester) in the Meta App Dashboard (**App Roles** > **Roles**).

---

## 4. Generating Access Tokens & Finding Account IDs

Follow these exact steps using the **Meta Graph API Explorer**.

### Step 4.1: Generate a Short-Lived User Token
1. Open the [Graph API Explorer](https://developers.facebook.com/tools/explorer/).
2. In the right-hand panel:
   - **Meta App:** Select your newly created app.
   - **User or Page:** Select **User Token**.
3. Under **Permissions**, click **Add a Permission** and select:
   - `instagram_basic`
   - `pages_show_list`
   - `pages_read_engagement`
   - `instagram_manage_insights`
   - `instagram_manage_comments`
   - `instagram_content_publish`
   - `instagram_manage_messages`
   - `pages_manage_metadata`
4. Click **Generate Access Token**.
5. Log in through Facebook, grant access to your Facebook Page and the connected Instagram Professional Account, and approve all requested permissions.
6. A short-lived User Access Token (valid for ~1–2 hours) will appear in the **Access Token** field.

---

### Step 4.2: Exchange for a Long-Lived Access Token (60 Days)

To prevent your token from expiring every few hours, exchange it for a long-lived access token.

1. Note your **App ID** and **App Secret**:
   - In the Meta App Dashboard, go to **App settings** > **Basic**.
   - Copy the **App ID**.
   - Click **Show** next to **App Secret** and copy it.
2. In your terminal or browser, execute the following `GET` request (replace placeholders with your real values):

```bash
curl -X GET "https://graph.facebook.com/v21.0/oauth/access_token?\
grant_type=fb_exchange_token&\
client_id=YOUR_META_APP_ID&\
client_secret=YOUR_META_APP_SECRET&\
fb_exchange_token=YOUR_SHORT_LIVED_USER_TOKEN"
```

3. The response will return a 60-day token:
```json
{
  "access_token": "EAA...",
  "token_type": "bearer",
  "expires_in": 5184000
}
```

---

### Step 4.3: Obtain Long-Lived Page Access Token & Instagram Business Account ID

Instagram Graph API operations are performed either with a long-lived User token or a Page Access Token that possesses Instagram permissions.

1. Query `/me/accounts` in the Graph API Explorer (or via `curl`) using the long-lived token:
```bash
curl -X GET "https://graph.facebook.com/v21.0/me/accounts?access_token=YOUR_LONG_LIVED_TOKEN"
```

2. The response lists your Facebook Pages:
```json
{
  "data": [
    {
      "access_token": "EAA...",
      "category": "Business",
      "name": "My Brand Page",
      "id": "100012345678901",
      "tasks": ["ANALYZE", "ADVERTISE", "MODERATE", "CREATE_CONTENT", "MANAGE"]
    }
  ]
}
```
   - Copy the `access_token` for the Page connected to your Instagram account. When generated from a long-lived user token, Page tokens never expire (unless revoked or password is changed).

3. Find the **Instagram Business Account ID**:
   Execute a request on the Facebook Page ID to retrieve the linked Instagram account:
```bash
curl -X GET "https://graph.facebook.com/v21.0/PAGE_ID?fields=instagram_business_account&access_token=PAGE_OR_USER_ACCESS_TOKEN"
```

4. The response will contain:
```json
{
  "instagram_business_account": {
    "id": "17841400000000000"
  },
  "id": "100012345678901"
}
```
   - The value under `"instagram_business_account" -> "id"` (e.g., `17841400000000000`) is your **`INSTAGRAM_ACCOUNT_ID`**.

---

## 5. Webhook Setup (Full Mode)

If you plan to use **Full Mode** for real-time comment/DM notifications:

1. In the Meta App Dashboard left sidebar, click **Add Product** and find **Webhooks**. Click **Set up**.
2. Select **Instagram** from the dropdown menu and click **Subscribe to this object**.
3. In the dialog:
   - **Callback URL:** `https://your-public-domain.com/webhook` (must be public HTTPS; use ngrok or Cloudflare Tunnel during local development).
   - **Verify Token:** Any random high-entropy secret string you choose (e.g. `openssl rand -hex 24`). Set this same value as `WEBHOOK_VERIFY_TOKEN` in your `.env`.
4. Click **Verify and Save**. Meta will send a `GET` request with `hub.challenge` to your gateway; the gateway will respond with the challenge string.
5. In the Webhooks subscriptions table, click **Subscribe** on the fields you need:
   - `comments`
   - `messages`
   - `mentions`
   - `story_insights`
6. Subscribe your Facebook Page to the App by executing:
```bash
curl -X POST "https://graph.facebook.com/v21.0/PAGE_ID/subscribed_apps?\
subscribed_fields=feed,conversations,messages&\
access_token=PAGE_ACCESS_TOKEN"
```

---

## 6. Configuring Your Local `.env`

Copy `.env.example` to `.env` (never commit `.env`!):

```bash
cp .env.example .env
```

Populate the values obtained from the steps above:

```env
# Runtime
APP_ENV=development
RUN_MODE=lite
PORT=3000
LOG_LEVEL=info

# Instagram Graph API
INSTAGRAM_ACCOUNT_ID=17841400000000000
INSTAGRAM_ACCESS_TOKEN=EAAG...
META_APP_ID=123456789012345
META_APP_SECRET=your_app_secret_here

# Webhooks (Full mode)
WEBHOOK_VERIFY_TOKEN=your_custom_webhook_secret_here

# PostgreSQL & Token Encryption (Full mode)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/mcb_instagram
TOKEN_ENCRYPTION_KEY=your_32_byte_hex_key_here

# AI Features (Optional)
ANTHROPIC_API_KEY=your_claude_api_key_here
```

---

## 7. Troubleshooting & Verification

### Inspecting Your Token
Use the [Access Token Debugger](https://developers.facebook.com/tools/debug/accesstoken/) to inspect your token:
- Confirm **App ID** matches your app.
- Confirm **Type** is User or Page.
- Confirm **Expires** shows an expected expiration date (or Never for page tokens).
- Confirm all required scopes are listed under **Scopes**.

### Common Error Codes

| Error Code | Message / Symptom | Root Cause & Resolution |
| :--- | :--- | :--- |
| **190** | `Invalid OAuth access token` | The token expired, was revoked, or the Facebook account password changed. Follow Section 4 to generate a new long-lived token. |
| **100** | `Unsupported get request` / `Invalid parameter` | The `INSTAGRAM_ACCOUNT_ID` is wrong or you queried the Facebook Page ID instead of the Instagram account ID. Verify via Step 4.3. |
| **200 / 10** | `Requires permission ...` | Missing required scope. Re-generate token in Graph API Explorer with all scopes listed in Section 3. |
| **32** | `Page request limit reached` | API rate limit exceeded. Full mode includes automated backoff and rate quota monitoring. |
| **N/A** | `instagram_business_account` is null in Step 4.3 | Your Instagram account is not connected to the Facebook Page, or is still a Personal account. Follow Section 1. |
