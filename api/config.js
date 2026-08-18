/* Serves the Firebase web config from server-side environment variables.

   Firebase web config is not a secret — the SDK hands it to every browser that
   loads the app, and the API key is a project identifier rather than a
   credential. What this endpoint buys is that nothing is baked into the source
   or committed to the repository: the values live only in the deployment's
   environment, and can be rotated or pointed at a different project without a
   code change. Actual access control is enforced by the database rules. */
module.exports = (req, res) => {
  const cfg = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    databaseURL: process.env.FIREBASE_DATABASE_URL,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
  };

  for (const k of Object.keys(cfg)) if (!cfg[k]) delete cfg[k];

  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (!cfg.apiKey || !cfg.databaseURL) {
    res.statusCode = 200;
    res.end(JSON.stringify({ configured: false }));
    return;
  }
  res.statusCode = 200;
  res.end(JSON.stringify({ configured: true, config: cfg }));
};
