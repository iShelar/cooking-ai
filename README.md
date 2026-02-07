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

### Create recipe from YouTube (optional)

To use **Create from YouTube** (turn a cooking video into a recipe with step timestamps):

1. In another terminal, run the timestamp service:
   ```bash
   cd youtube-timestamp-service && npm install && npm run server
   ```
   It runs at `http://localhost:3001`. The app will call it when you click **Fetch** with a YouTube URL.

2. Or run the CLI and paste the JSON:  
   `node src/index.js "https://www.youtube.com/watch?v=..."` then copy the generated file from `data/` and paste into the app’s **Create from YouTube** screen.

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