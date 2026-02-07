<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1q4PwPz4BX_IElsBhDK1tstYNzl75BJIm

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. **Firestore (recipes):** In [Firebase Console](https://console.firebase.google.com) → your project → **Build** → **Firestore Database**:
   - Click **Create database** if you haven’t already (start in test mode).
   - Open the **Rules** tab and paste the contents of [firestore.rules](firestore.rules), then **Publish**. This allows the app to read/write the `recipes` collection.
4. Run the app:
   `npm run dev`

### Anonymous / guest login

- **Continue as guest** on the login screen signs in with Firebase Anonymous Auth (no backend needed). Each device gets its own persistent UID; data is per device.
- **Same ID for everyone (shared guest):** The **youtube-timestamp-service** backend exposes `GET /guest-token`, which returns `{ "token": "<customToken>" }`. Run that backend, then in the app’s `.env.local` set `VITE_GUEST_TOKEN_URL=http://localhost:3001/guest-token` (or your deployed backend URL). The backend needs Firebase Admin credentials: set `GOOGLE_APPLICATION_CREDENTIALS` to the path of your Firebase service account JSON (Firebase Console → Project settings → Service accounts → Generate new private key). Firestore rules must allow read/write for `users/guest/...` when `request.auth.uid == 'guest'`.

### Create recipe from YouTube (optional)

To use **Create from YouTube** (turn a cooking video into a recipe you can follow step-by-step with the video):

1. In another terminal, run the video service:
   ```bash
   cd youtube-timestamp-service && npm install && npm run server
   ```
   It runs at `http://localhost:3001`. The app will call it when you paste a YouTube link and create a recipe.

2. Or run the CLI and paste the JSON:  
   `node src/index.js "https://www.youtube.com/watch?v=..."` then copy the generated file from `data/` and paste into the app’s **Create from YouTube** screen.

## Share recipe

From a recipe’s detail screen, tap **Share** (icon in the header). The app creates a link and copies it to the clipboard. Anyone with the link can open the recipe (read-only) and, if signed in, tap **Save to my recipes** to add a copy to their collection. Shared data is stored in the `sharedRecipes` Firestore collection (see [firestore.rules](firestore.rules)). When deploying, ensure your host serves the app’s `index.html` for paths under `/share/*` (SPA fallback) so share links work.

## PWA (Progressive Web App)

The app is set up as a PWA so users can install it on their phone or desktop (Add to Home Screen / Install app).

- **Icons:** PWA icons are generated from `public/favicon.svg`. To regenerate after changing the favicon, run:
  ```bash
  yarn run generate-pwa-icons
  ```
- **Install:** Deploy over **HTTPS**; then users can install via the browser’s install prompt or menu.
- **Offline:** The app shell and static assets are cached. Auth and live data (Firebase, Gemini) still require a connection.

<!-- Features -->
## Features to be added:

<!-- 1. ~~Dietary option~~ **Done** – At start, a one-time optional survey asks for dietary preferences and allergies (skippable). You can update them anytime in **Settings → Dietary & preferences**. When creating a recipe from **chat** or **YouTube**, you can choose to use saved preferences or skip for that recipe, and add extra alternatives (e.g. oat milk, gluten-free pasta) for that recipe only. -->
<!-- 5. Fix performance issue and also UI bugs - Not hearing the voice when noise is there 
+ Should respond quickly. -->
<!-- 6. Search functionality -->
<!-- 7. Instagram - Feature scope -->
8. Voice command - fully automate
<!-- 9. Voice icon - sticky on corner. -->
<!-- 10. Once done - we will use inventory items and save it at end. -->
11. Bugs - on mobile device - not able to start the video using voice.
<!-- 12. Generate recipes using prompt. -->
<!-- 13. Fix youtube recipe generation flow. -->
<!-- 14. Prompt user if they wanna change the laguage or not. -->
<!-- 15. Image is not properly set (thumbnail or gen ai)~~ — When a recipe has no image 
(or only a placeholder), the app generates a realistic image with Gemini, stores it 
in Firebase Storage, and links it to the recipe in the DB. -->
16. Share recipes
<!-- 17. Whenever recipe start or if important it should ask for timer and heat level. so 
user will know -> every time show the heat level. -->
18. Few curated recipes - we will standardize
19. Feature - when we change the ingredients or use something else in a step, we will talk with agent if and that memory for that step we will store. Next time agent see that memory it will tell user you used something in last recipe. Also, same option will be in instruction option before prepare recipe screen. we should be able to add the preference or changes (like memory) for that specific step.