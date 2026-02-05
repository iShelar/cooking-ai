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


<!-- Features -->
## Features to be added:

1. Dietary option - when generating recipe through chat / youtube vidoe that time we will ask few questions if they wanna skip they can skip
2. They can see if they don't have those items in list - we can show alternatives
3. The dietary information about user we can ask upfront or while in any instance and then ask them to store it in setting or just tell agent, agent will take care of it through voice and store it in preference in setting
4. All of these we can move to firebase
