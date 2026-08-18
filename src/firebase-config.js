/* Firebase web config.

   These values are public by design — Firebase ships them to every browser that
   loads the app, and the API key is a project identifier, not a credential. All
   access control lives in firebase.rules.json (published to the Realtime
   Database), which is what actually keeps rooms friends-only.

   On Vercel, `npm run build` regenerates this file from FIREBASE_* environment
   variables when they are set, so the config can be managed there instead. */
window.FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCwfPTLcnRpiRGWmRNCZErb0HbA9cTPdio',
  authDomain: 'mickeyd-s.firebaseapp.com',
  databaseURL: 'https://mickeyd-s-default-rtdb.firebaseio.com',
  projectId: 'mickeyd-s',
  storageBucket: 'mickeyd-s.firebasestorage.app',
  messagingSenderId: '1016257013322',
  appId: '1:1016257013322:web:e91919cb0fdb50e5b168b3',
};
