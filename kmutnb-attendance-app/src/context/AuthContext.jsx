import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

const AuthContext = createContext({});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check active sessions and sets the user
    supabase.auth.getSession().then(({ data: { session } }) => {
      validateAndSetSession(session);
    }).catch((err) => {
      console.error("Supabase connection error:", err);
      setLoading(false);
    });

    // Listen for changes on auth state (in, out, etc.)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      validateAndSetSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  const validateAndSetSession = async (currentSession) => {
    if (!currentSession) {
      setSession(null);
      setUser(null);
      setLoading(false);
      return;
    }

    const email = currentSession.user?.email || '';
    
    // Check KMUTNB Domain if they are not an admin/lecturer
    // We do a basic check here. In a real app, role is fetched from DB.
    // For safety, we enforce KMUTNB domain for everyone on the client-side as well
    // unless explicitly stated.
    const isKmutnbEmail = email.endsWith('@kmutnb.ac.th') || email.endsWith('@email.kmutnb.ac.th');
    
    if (!isKmutnbEmail) {
      await supabase.auth.signOut();
      alert('ไม่อนุญาตให้เข้าสู่ระบบ: กรุณาใช้อีเมลโดเมนของ มจพ. (@kmutnb.ac.th หรือ @email.kmutnb.ac.th) เท่านั้น');
      setSession(null);
      setUser(null);
      setLoading(false);
      return;
    }

    setSession(currentSession);
    setUser(currentSession.user);
    setLoading(false);
  };

  const signInWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin
      }
    });
    if (error) console.error('Error signing in:', error.message);
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) console.error('Error signing out:', error.message);
  };

  const value = {
    session,
    user,
    loading,
    signInWithGoogle,
    signOut
  };

  return (
    <AuthContext.Provider value={value}>
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', backgroundColor: '#F8FAFC', color: '#0F172A', flexDirection: 'column', fontFamily: 'sans-serif' }}>
          <h2 style={{ color: '#F45025' }}>Smart Attend</h2>
          <p>กำลังเชื่อมต่อระบบยืนยันตัวตน...</p>
          <p style={{ fontSize: '12px', color: '#94A3B8', marginTop: '8px' }}>หากหน้านี้ค้าง ให้ตรวจสอบค่าในไฟล์ .env ของคุณ</p>
        </div>
      ) : (
        children
      )}
    </AuthContext.Provider>
  );
};
