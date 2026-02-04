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
