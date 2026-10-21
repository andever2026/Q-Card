// Firebase web config for the q-card-project. These values identify the project and are public by design:
// access is controlled by the Firestore rules in firestore.rules (each signed-in person reads and writes only users/<their uid>/…).
export default {
  apiKey: "AIzaSyCroNT9SNXYs-8pGYYd6QqHUtRQUjDH11o",
  authDomain: "q-card-project.firebaseapp.com",
  projectId: "q-card-project",
  storageBucket: "q-card-project.firebasestorage.app",
  messagingSenderId: "273476523262",
  appId: "1:273476523262:web:d74960f0608d0b3ed4c1af",
};
// Firebase account ids of the site's owner (Firebase console → Authentication → Users → User UID). They get Owner tools
// in Settings. An id isn't a secret: knowing it doesn't open anyone's data.
export const owners = [];
