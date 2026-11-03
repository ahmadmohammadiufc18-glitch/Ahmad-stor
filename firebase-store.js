/*
 * Ahmad Stor Firebase adapter (compat SDK).
 * Load Firebase app/auth/firestore compat SDK scripts, then firebase-config.js,
 * then this file. This adapter is intentionally separate until the project
 * owner configures Firebase and connects the existing UI handlers.
 */
(function () {
  'use strict';
  const config = window.AHMAD_STORE_FIREBASE_CONFIG;
  const required = ['apiKey','authDomain','projectId','appId'];
  const readyConfig = config && required.every(k =>
    typeof config[k] === 'string' && config[k].trim() &&
    !config[k].includes('PASTE_') && !config[k].includes('YOUR_PROJECT_ID')
  );
  const sdkReady = window.firebase && firebase.auth && firebase.firestore;
  const state = { ready: false, error: null };

  function requireReady() {
    if (!state.ready) throw new Error('Firebase تنظیم نشده است. راهنمای FIREBASE_SETUP_FA.md را دنبال کن.');
  }

  const api = {
    state,
    init() {
      if (!sdkReady) { state.error = 'Firebase SDK بارگذاری نشده است.'; return false; }
      if (!readyConfig) { state.error = 'تنظیمات Firebase هنوز وارد نشده است.'; return false; }
      try {
        if (!firebase.apps.length) firebase.initializeApp(config);
        api.auth = firebase.auth();
        api.db = firebase.firestore();
        state.ready = true; state.error = null;
        return true;
      } catch (e) { state.error = e.message || String(e); return false; }
    },
    onAuthChanged(callback) { requireReady(); return api.auth.onAuthStateChanged(callback); },
    register(email, password, displayName) {
      requireReady();
      return api.auth.createUserWithEmailAndPassword(email, password).then(async result => {
        const user = result.user;
        if (displayName) await user.updateProfile({ displayName });
        await api.db.collection('profiles').doc(user.uid).set({
          uid: user.uid, displayName: displayName || '', email: user.email || '',
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        return user;
      });
    },
    login(email, password) { requireReady(); return api.auth.signInWithEmailAndPassword(email, password); },
    logout() { requireReady(); return api.auth.signOut(); },
    currentUser() { requireReady(); return api.auth.currentUser; },
    async saveProfile(data) {
      requireReady(); const u = api.auth.currentUser;
      if (!u) throw new Error('ابتدا وارد حساب شو.');
      const safe = { uid:u.uid, displayName:String(data.displayName || u.displayName || ''),
        email:u.email || '', updatedAt:firebase.firestore.FieldValue.serverTimestamp() };
      await api.db.collection('profiles').doc(u.uid).set(safe,{merge:true});
    },
    async listProducts() {
      requireReady();
      const snap = await api.db.collection('products').where('active','==',true).get();
      return snap.docs.map(d => ({ id:d.id, ...d.data() }));
    },
    async createOrder(data) {
      requireReady(); const u = api.auth.currentUser;
      if (!u) throw new Error('برای ثبت سفارش ابتدا وارد حساب شو.');
      const ref = api.db.collection('orders').doc();
      await ref.set({ ...data, uid:u.uid, status:'pending',
        createdAt:firebase.firestore.FieldValue.serverTimestamp() });
      return ref.id;
    },
    async myOrders() {
      requireReady(); const u = api.auth.currentUser;
      if (!u) throw new Error('ابتدا وارد حساب شو.');
      const snap = await api.db.collection('orders').where('uid','==',u.uid).get();
      return snap.docs.map(d => ({ id:d.id, ...d.data() }));
    },
    async addReview(data) {
      requireReady(); const u = api.auth.currentUser;
      if (!u) throw new Error('برای ثبت نظر ابتدا وارد حساب شو.');
      const ref = await api.db.collection('reviews').add({
        uid:u.uid, name:u.displayName || 'کاربر', message:String(data.message || '').slice(0,2000),
        rating:Math.max(1,Math.min(5,Math.trunc(Number(data.rating)||5))),
        topic:String(data.topic || 'نظر').slice(0,100),
        createdAt:firebase.firestore.FieldValue.serverTimestamp()
      });
      return ref.id;
    },
    async listReviews() {
      requireReady();
      const snap = await api.db.collection('reviews').get();
      return snap.docs.map(d => ({ id:d.id, ...d.data() }));
    },
    async sendMessage(data) {
      requireReady();
      const ref = await api.db.collection('messages').add({
        name:String(data.name || '').slice(0,100),
        email:String(data.email || '').slice(0,200),
        subject:String(data.subject || '').slice(0,200),
        message:String(data.message || '').slice(0,5000),
        uid:api.auth.currentUser ? api.auth.currentUser.uid : null,
        createdAt:firebase.firestore.FieldValue.serverTimestamp()
      });
      return ref.id;
    }
  };
  window.AhmadStoreCloud = api;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => api.init());
  else api.init();
})();
