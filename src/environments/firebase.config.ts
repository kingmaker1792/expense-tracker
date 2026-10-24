import { FirebaseOptions } from 'firebase/app';

// Paste the public Firebase web-app configuration from Firebase Console here.
// Until it is provided, production hosting can fall back to /__/firebase/init.json.
export const firebaseConfig: FirebaseOptions = {
  apiKey: 'AIzaSyBZ72ROvmCYUvkOm55SbQpajaoYRtQ9hJU',
  authDomain: 'cognylync.firebaseapp.com',
  projectId: 'cognylync',
  storageBucket: 'cognylync.firebasestorage.app',
  messagingSenderId: '116939904432',
  appId: '1:116939904432:web:12c2ed9a8ba57820253275',
  measurementId: 'G-W4D0K74C3W',
};

export const hasFirebaseConfig = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);
