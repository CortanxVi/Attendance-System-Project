import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../supabaseClient';
import api from '../api';

const Dashboard = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [hasFaceRegistered, setHasFaceRegistered] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkFaceRegistration = async () => {
      try {
        // ให้หน้าเว็บถามผ่านหลังบ้านแทน เพื่อหลบข้อจำกัด RLS ของฐานข้อมูล
        const res = await api.get('/attendance/status');
        if (res.data && res.data.hasFaceRegistered) {
          setHasFaceRegistered(true);
        }
      } catch (err) {
        console.error('Error checking face registration:', err);
      } finally {
        setLoading(false);
      }
    };
    
    if (user) {
      checkFaceRegistration();
    }
  }, [user]);

  return (
    <div className="container" style={{ padding: 'var(--space-6) 0' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-8)' }}>
        <div>
          <h1 style={{ fontSize: '1.25rem', color: 'var(--color-primary)' }}>Smart Attend</h1>
          <p style={{ color: 'var(--color-ink-secondary)', fontSize: '0.875rem' }}>
            สวัสดี, {user?.user_metadata?.full_name}
          </p>
        </div>
        <button className="btn btn-outline" style={{ width: 'auto', padding: 'var(--space-2) var(--space-4)' }} onClick={signOut}>
          ออกจากระบบ
        </button>
      </header>

      {loading ? (
        <div className="flex-center" style={{ minHeight: '200px' }}>
          <p style={{ color: 'var(--color-ink-tertiary)' }}>กำลังตรวจสอบข้อมูลส่วนบุคคล...</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <h2 style={{ fontSize: '1.125rem' }}>การเช็คชื่อเข้าเรียน</h2>
            <p style={{ color: 'var(--color-ink-secondary)', fontSize: '0.875rem' }}>
              สแกน Dynamic QR Code จากหน้าจอของอาจารย์ผู้สอน พร้อมยืนยันตัวตนด้วยใบหน้าและพิกัด GPS
            </p>
            <button 
              className="btn btn-primary" 
              onClick={() => navigate('/check-in')}
              disabled={!hasFaceRegistered}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px' }}>
                <path d="M4 4h4v4H4z"></path>
                <path d="M4 16h4v4H4z"></path>
                <path d="M16 4h4v4h-4z"></path>
                <path d="M14 14h6v6h-6z"></path>
              </svg>
              {hasFaceRegistered ? 'เริ่มเช็คชื่อเข้าเรียน' : 'กรุณาลงทะเบียนใบหน้าก่อน'}
            </button>
          </div>

          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', backgroundColor: hasFaceRegistered ? 'var(--color-bg-base)' : 'var(--color-bg-surface)' }}>
            <div>
              <h2 style={{ fontSize: '1.125rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                การลงทะเบียนใบหน้า
                {hasFaceRegistered && (
                  <span style={{ fontSize: '0.75rem', backgroundColor: 'var(--color-success-bg)', color: 'var(--color-success-ink)', padding: '2px 8px', borderRadius: 'var(--radius-full)' }}>
                    ลงทะเบียนแล้ว
                  </span>
                )}
              </h2>
            </div>
            <p style={{ color: 'var(--color-ink-secondary)', fontSize: '0.875rem' }}>
              ถ่ายภาพใบหน้าของคุณเพื่อสกัดเวกเตอร์ข้อมูลไปเปรียบเทียบในขั้นตอนเช็คชื่อ ข้อมูลภาพถ่ายจะไม่ถูกเก็บบันทึกบนเซิร์ฟเวอร์
            </p>
            <button className="btn btn-outline" onClick={() => navigate('/register-face')}>
              {hasFaceRegistered ? 'อัปเดตข้อมูลใบหน้า' : 'เริ่มต้นลงทะเบียนใบหน้า'}
            </button>
          </div>

          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <h2 style={{ fontSize: '1.125rem' }}>ประวัติการเช็คชื่อ</h2>
            <p style={{ color: 'var(--color-ink-secondary)', fontSize: '0.875rem' }}>
              ตรวจสอบข้อมูลสถิติการเข้าเรียนย้อนหลังของคุณ
            </p>
            <button className="btn btn-outline" onClick={() => navigate('/history')}>
              ดูประวัติย้อนหลัง
            </button>
          </div>

          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', border: '1px solid #3B82F6' }}>
            <h2 style={{ fontSize: '1.125rem', color: '#3B82F6', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
              ทดสอบความแม่นยำ AI (Developer)
            </h2>
            <p style={{ color: 'var(--color-ink-secondary)', fontSize: '0.875rem' }}>
              ทดสอบการค้นหาใบหน้าแบบ Real-time ว่ากล้องสามารถจำแนกตัวคุณจากฐานข้อมูลได้ถูกต้องหรือไม่
            </p>
            <button className="btn btn-primary" style={{ backgroundColor: '#3B82F6' }} onClick={() => navigate('/face-tester')}>
              เปิดโหมดทดสอบ
            </button>
          </div>

        </div>
      )}
    </div>
  );
};

export default Dashboard;
