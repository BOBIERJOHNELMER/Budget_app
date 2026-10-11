# SalaryWise

SalaryWise is a Cordova Android budgeting app that helps users track monthly salary, buy simulated groceries, scan shelf items, and keep receipt logs offline on the device.

## Features

- Salary dashboard with balance overview and spend summary
- Emergency, savings, and custom funds that separate salary allocations from spending
- Manual expense tracking with reason-based transaction logs
- Simulated shop with product catalog and cart checkout
- Shelf scan flow with photo capture and manual entry fallback
- Offline-first storage using IndexedDB with localStorage fallback
- Receipt generation as PDF with file opener integration
- Transaction logs with revert logic and balance tracking
- Editable extra checkout charges in both carts, included in checkout totals and receipts
- AI budgeting assistant with a local server-side provider proxy, explicit financial-data sharing consent, PHP-formatted recommendations, a provider-specific chat-model picker with custom model IDs, automatic model/provider failover, and review of complete salary plans before applying changes

AI provider requests send selected salary, portion, product, and transaction data through the configured AI proxy to the selected OpenRouter or Groq endpoint. Provider keys are read only by the proxy from its process environment or local `.env` file and are never included in the Cordova app. Do not commit `.env`; rotate any keys that have been exposed.

The AI settings use one provider-specific model textbox with an attached model dropdown: choosing a listed model fills the textbox, and custom model IDs can be typed directly. Audio transcription/generation, prompt-guard, safety-only, and reranking models from the supplied lists are intentionally excluded because they cannot reliably answer budgeting questions. For an AI request, SalaryWise tries the chosen model first, then the other listed chat models for that provider, then the configured other provider. Retries keep the original request and include a short summary of failed attempts; remaining request time is shared across candidates so a slow provider cannot consume the entire window before cross-provider fallback. The response identifies the model that answered. Provider model availability and quotas can still change, and no fallback can guarantee a successful answer when all providers are unavailable.

## Prerequisites

- Node.js and npm
- Java JDK 17+
- Android Studio with Android SDK
- A working Android emulator or physical device

## Install Cordova

```bash
npm i -g cordova
```

## Create the project

```bash
cordova create SalaryWise --id com.salarywise.app --name SalaryWise
cd SalaryWise
```

## Add Android platform

```bash
cordova platform add android
```

## Install required plugins

```bash
cordova plugin add cordova-plugin-camera
cordova plugin add cordova-plugin-file
cordova plugin add cordova-plugin-file-opener2
cordova plugin add cordova-plugin-statusbar
```

## Copy app source into the Cordova project

Copy the files in this workspace into the generated Cordova app's `www/` folder, or place these files directly into the project root once the Cordova scaffold is generated.

## Run on Android

```bash
cordova run android
```

## Configure AI provider access

1. Copy `.env.example` to `.env` and add rotated provider keys you control. `.env` is ignored by Git.
2. Start the proxy in a separate terminal with `npm run ai-proxy`. By default it binds to `127.0.0.1:8002` (to avoid the app preview's common port 8001). The AI provider/model settings can be saved even if the proxy is offline; the app reports connection status separately.
3. For browser development on the same computer, open SalaryWise on port 8000. Its AI proxy URL defaults to `http://127.0.0.1:8002`. Select a provider/model, accept the data-sharing notice, and enable the agent. Failover uses only providers with configured keys.
4. Stop the proxy when finished. Its credentials remain on the computer running it and are not bundled into the browser or Android app.

The loopback proxy is only for browser development on the same computer. An APK cannot reach the development computer through `127.0.0.1`. To use AI on Android or other devices, deploy the proxy behind HTTPS, configure its provider keys, then enter that HTTPS URL and its access token (if configured) under AI privileges on each device. Configure `AI_PROXY_ALLOWED_ORIGINS` as a comma-separated list including your web app origin and `https://localhost` for Cordova Android. Set a strong `AI_PROXY_ACCESS_TOKEN` on the server and enter the same token in the app. Deploy behind a TLS-terminating reverse proxy; do not expose the development proxy or provider keys directly to clients.

For a hosted proxy, set `AI_PROXY_HOST=0.0.0.0` in the server environment and configure `AI_PROXY_ALLOWED_ORIGINS`, `AI_PROXY_ACCESS_TOKEN`, and provider keys in that host's secret settings. Do not commit these values in `.env` or ship them in the APK.

### Deploying the proxy on Render

1. Push the project to a private GitHub repository without `.env` or any provider keys, then create a Render Blueprint from that repository. Render reads `render.yaml`, asks for the OpenRouter/Groq keys, and generates a separate `AI_PROXY_ACCESS_TOKEN`.
2. After deployment, copy the service's HTTPS URL from Render. In SalaryWise → Profile → Settings → AI privileges, set that URL and enter the generated proxy token. Provider credentials remain only in Render's environment.
3. The Blueprint allows Cordova Android's `https://localhost` origin and the app's local web-development origins. If the web app is hosted at a different domain, add that exact origin to `AI_PROXY_ALLOWED_ORIGINS` in Render.

The Blueprint uses Render's free plan, which may sleep while idle; choose an always-on plan if cold starts are not acceptable. A deployment is not active until the repository is connected and the required provider secrets are entered in Render.

## Build Android release

```bash
cordova build android --release
```

## Notes

- The app intentionally stores all data in local IndexedDB / localStorage only.
- **Browser testing — fixed port required.** Browser storage is tied to the exact origin (protocol + host + port). Always use a fixed port: `cordova run browser --port=8000`. Changing the port or opening a different tab at a different port will appear as a fresh install. Private/incognito windows do not retain data between sessions.
- **Seed-once guarantee.** Demo products are seeded only on the very first launch (when no user record and no products exist anywhere). Every subsequent launch loads persisted data. The seeded flag is stored in the `meta` IndexedDB store and in localStorage.
- **No accidental resets.** The only way to wipe all data is the "Reset all data" button in Profile → Settings, which requires typing `RESET` to confirm.
- Android data is stored in the Cordova WebView app storage and receipts are additionally written to the device Downloads/app storage when available.
- The receipt uses a local jsPDF-compatible utility bundled in `www/js/lib/` so there is no CDN dependency.
- Camera access, storage permissions, and scoped storage handling are included in `config.xml` for Android.
- The OCR price field is a stub and manual entry is always available.
- Photos are stored as compressed base64 inside product and transaction records so they survive app restarts. Temporary camera cache paths are never stored.
